import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands';
import type { Session, SessionEvent, SessionStore } from '@deepseek-ai/dsh-session';
import type { MessageId } from '@deepseek-ai/dsh-llm';
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type {} from '@deepseek-ai/dsh-agent';
import type {} from '@deepseek-ai/dsh-compaction/types';
import type { ZodType } from 'zod';
import { CLEAR_MARKER, CLEAR_TEXT, readClearBoundary, type ClearBoundary } from '../shared/clear.ts';
import { derivedMessage, priceMessage, type PricedEvent } from './context/pricing.ts';

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { ccdClear: ClearBoundary }
  interface SessionProjectionMap { ccdClear: ClearBoundary }
}

declare module '@deepseek-ai/dsh-llm/message' {
  interface MessageSourceMap { 'ccd-clear': { kind: 'ccd-clear' } }
}

/** Replay the boundary even when earlier transcript pages have not been loaded. */
export function applyClearEvent(state: ClearBoundary, event: SessionEvent): ClearBoundary {
  if (event.type === 'turn/start') return { ...state, lastTurn: event.data.turn };
  if (event.type === 'user/message' && event.data.id.startsWith(CLEAR_MARKER)
    && event.data.source.kind === 'ccd-clear'
    && event.surfaceOp === 'append') {
    return { seq: event.seq, turn: state.lastTurn, lastTurn: state.lastTurn };
  }
  return state;
}

/** Keep the original log; replace conversational ranges with a fixed reset notice. */
export async function clearConversation(query: Pick<SessionQueryEngine, 'readSurface'>, invocation: CommandInvocation,
  flush: (session: Session) => Promise<void>): Promise<CommandResult> {
  const { agent, signal } = invocation;
  if (invocation.rawInput.trim()) return { kind: 'error', text: '用法：/clear（保留历史记录，清空当前对话上下文）' };
  if (agent.status !== 'idle' || agent.inbox.nextTurn.length || agent.inbox.nextStep.length) {
    return { kind: 'error', text: '请先停止当前回复并处理排队消息，再执行 /clear。' };
  }
  return agent.runMaintenance(async maintenance => {
    const snapshot = await query.readSurface(agent.id);
    signal.throwIfAborted();
    maintenance.throwIfAborted();
    const ranges: (typeof snapshot.events)[] = [];
    let range: typeof snapshot.events = [];
    for (const event of snapshot.events) {
      // Workspace instructions and the available skill catalog remain durable context,
      // like Claude's project memory. Tool schemas and system settings also survive.
      const keep = event.type === 'system/message' || event.type === 'developer/message'
        || (event.type === 'user/message' && ['agent-instructions', 'skill-catalog'].includes(event.data.source.kind));
      if (keep) {
        if (range.length) { ranges.push(range); range = []; }
      } else range.push(event);
    }
    if (range.length) ranges.push(range);
    // No awaits inside the commit: maintenance holds new turns until all ranges land.
    for (const events of ranges) {
      const start = events[0]!.seq;
      const end = events.at(-1)!.seq;
      agent.session.append('compaction/prune', {
        shadowedRange: { start, end }, shadowedSeqs: events.map(event => event.seq),
        shadowedTokenCount: events.reduce((sum, event) => sum + priceMessage(derivedMessage(event as unknown as PricedEvent)), 0),
      });
      agent.session.append('user/message', {
        id: `ccd-cleared:${randomUUID()}` as MessageId, role: 'user', source: { kind: 'ccd-clear' },
        content: [{ type: 'text', text: CLEAR_TEXT }],
      }, { surfaceOp: { op: 'replace', startSeq: start, endSeq: end }, sourceEventSeqs: events.map(event => event.seq) });
    }
    const marker = agent.session.append('user/message', {
      id: `${CLEAR_MARKER}${invocation.commandId}` as MessageId, role: 'user', source: { kind: 'ccd-clear' },
      content: [{ type: 'text', text: CLEAR_TEXT }],
    }, { surfaceOp: 'append' });
    await flush(agent.session);
    return { kind: 'success', text: '上下文已清空，历史记录已保留。', sourceEventSeq: marker.seq };
  });
}

/** Use the host's command registry and projection transport, without a model call. */
export function mountClearCommand(ctx: Context, enabled: () => boolean): void {
  ctx.inject(['commands', 'sessionQuery', 'sessionProjections', 'sessions'], injected => {
    if (!enabled()) return;
    const schema = { parse: readClearBoundary } as unknown as ZodType<ClearBoundary>;
    const projection = {
      key: 'ccdClear', stateVersion: 2, stateSchema: schema,
      init: () => ({ seq: null, turn: 0, lastTurn: 0 }), apply: applyClearEvent,
      wire: { viewSchema: schema, view: state => state },
    } satisfies ProjectionDefinition<'ccdClear'>;
    injected.sessionProjections.register(projection);
    const sessions = injected.get('sessions') as unknown as SessionStore;
    injected.commands.register({
      name: 'clear', description: '清空当前上下文，保留会话、项目与历史记录',
      handler: invocation => enabled()
        ? clearConversation(injected.sessionQuery, invocation, async session => { await sessions.flush(session); })
        : { kind: 'error', text: '请先启用 Claude 主题。' },
    });
  });
}
