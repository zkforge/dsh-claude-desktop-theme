import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KNOWN_SESSION_EVENT_TYPES, Session, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session';
import { SessionFormatEventCollector } from '@deepseek-ai/dsh-session-format';
import type { SessionFormatEvent } from '@deepseek-ai/dsh-session-format';
import { releasedV4SessionFormatCodec, restoreReleasedV4Artifact } from '@deepseek-ai/dsh-session-format-v3-to-v4';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { CommandInvocation } from '@deepseek-ai/dsh-commands';
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import type { MessageId } from '@deepseek-ai/dsh-llm';
import { applyClearEvent, clearConversation } from '../src/host/clear.ts';
import { CLEAR_MARKER, CLEAR_TEXT, readClearBoundary, type ClearBoundary } from '../src/shared/clear.ts';

function fixture() {
  const session = Session.create(SessionId('persistent-chat'));
  session.append('turn/start', { turn: 1 });
  session.append('step/start', { turn: 1, step: 1 });
  session.append('system/message', { turn: 1, step: 1, message: {
    id: 'system' as MessageId, role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'system settings' }],
  } }, { surfaceOp: 'append' });
  const prompt = (id: string, text: string, source: object = { kind: 'user' }) => session.append('user/message', {
    id: id as MessageId, role: 'user', source, content: [{ type: 'text', text }],
  } as never, { surfaceOp: 'append' });
  prompt('instructions', 'project instructions', { kind: 'agent-instructions' });
  prompt('human', 'old secret');
  session.append('assistant/message', { turn: 1, step: 1, stream: [], message: {
    id: 'reply' as MessageId, role: 'assistant', source: { kind: 'model', provider: 'test', model: 'test' },
    content: [{ type: 'text', text: 'old answer' }],
  } }, { surfaceOp: 'append' });
  prompt('summary', 'old compacted summary', { kind: 'user' });
  session.append('step/end', { turn: 1, step: 1 });
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } } as never);
  let maintained = false;
  let flushed = false;
  const invocation = {
    commandId: 'clear-1', rawInput: '', signal: new AbortController().signal, attachments: [],
    agent: {
      id: session.id, session, status: 'idle', inbox: { nextTurn: [], nextStep: [] },
      async runMaintenance(task: (signal: AbortSignal) => Promise<unknown>) {
        assert.equal(maintained, false);
        maintained = true;
        try { return await task(new AbortController().signal); } finally { maintained = false; }
      },
    },
  } as unknown as CommandInvocation;
  const query = { async readSurface() {
    assert.equal(maintained, true);
    return { session: session.header, inheritedEventCount: session.inheritedEventCount,
      capturedThroughSeq: session.seq - 1,
      events: session.surface.nodes.map(seq => session.eventAt(seq)),
    };
  } } as unknown as Pick<SessionQueryEngine, 'readSurface'>;
  const flush = async (target: Session) => { assert.equal(target, session); assert.equal(maintained, true); flushed = true; };
  return { session, invocation, query, prompt, flush, flushed: () => flushed };
}

test('clear retains the identity and original log, excludes old model history, and survives replay', async () => {
  const f = fixture();
  const before = f.session.snapshotEvents();
  const result = await clearConversation(f.query, f.invocation, f.flush);
  assert.equal(result.kind, 'success');
  assert.equal(f.flushed(), true);
  assert.equal(f.session.id, 'persistent-chat');
  assert.deepEqual(f.session.snapshotEvents(SessionLogOffset(0), SessionLogOffset(before.length)), before);
  assert.deepEqual(f.session.deriveMessages().filter(message => message.source.kind !== 'ccd-clear').map(message => message.content), [
    [{ type: 'text', text: 'system settings' }], [{ type: 'text', text: 'project instructions' }],
  ]);
  const events = f.session.snapshotEvents();
  const restored = Session.create(f.session.id, events);
  assert.deepEqual(restored.deriveMessages(), f.session.deriveMessages());
  const boundary = events.reduce(applyClearEvent, { seq: null, turn: 0, lastTurn: 0 } as ClearBoundary);
  assert.equal(boundary.seq, events.at(-1)!.seq);
  assert.equal(boundary.turn, 1);
  const prune = events.find(event => event.type === 'compaction/prune');
  assert.ok(prune && prune.type === 'compaction/prune' && prune.data.shadowedTokenCount > 0);
  assert.equal(restored.deriveMessages().some(message => JSON.stringify(message).includes('old secret')), false);
});

test('new messages work after clear and a second clear removes the new segment', async () => {
  const f = fixture();
  await clearConversation(f.query, f.invocation, f.flush);
  f.prompt('second', 'new question');
  assert.ok(JSON.stringify(f.session.deriveMessages()).includes('new question'));
  await clearConversation(f.query, { ...f.invocation, commandId: 'clear-2' } as CommandInvocation, f.flush);
  assert.equal(JSON.stringify(f.session.deriveMessages()).includes('new question'), false);
  assert.equal(f.session.snapshotEvents().filter(event => event.type === 'user/message' && event.data.source.kind === 'user').length, 3);
});

test('running, queued, invalid and cancelled commands leave history intact', async () => {
  for (const kind of ['running', 'queued', 'args', 'cancelled']) {
    const f = fixture();
    const before = f.session.seq;
    const invocation = {
      ...f.invocation,
      ...(kind === 'args' ? { rawInput: 'delete-everything' } : {}),
      ...(kind === 'cancelled' ? { signal: AbortSignal.abort() } : {}),
      agent: { ...f.invocation.agent,
        ...(kind === 'running' ? { status: 'running' } : {}),
        ...(kind === 'queued' ? { inbox: { nextTurn: [{}], nextStep: [] } } : {}),
      },
    } as CommandInvocation;
    if (kind === 'cancelled') await assert.rejects(clearConversation(f.query, invocation, f.flush));
    else assert.equal((await clearConversation(f.query, invocation, f.flush)).kind, 'error');
    assert.equal(f.session.seq, before, kind);
  }
});

test('only the producer-owned append marker sets a persisted clear boundary', () => {
  const initial: ClearBoundary = { seq: null, turn: 0, lastTurn: 0 };
  const marker = { type: 'user/message', seq: 9, surfaceOp: 'append', data: {
    id: `${CLEAR_MARKER}command`, source: { kind: 'ccd-clear' }, content: [{ type: 'text', text: CLEAR_TEXT }],
  } } as unknown as SessionEvent;
  assert.equal(applyClearEvent(initial, { ...marker, surfaceOp: { op: 'replace', startSeq: 0, endSeq: 1 } } as unknown as SessionEvent), initial);
  assert.equal(applyClearEvent(initial, { ...marker, data: { ...marker.data, source: { kind: 'user' } } } as unknown as SessionEvent), initial);
  assert.deepEqual(readClearBoundary(applyClearEvent(initial, marker)), { seq: 9, turn: 0, lastTurn: 0 });
  assert.throws(() => readClearBoundary({ seq: -1, turn: 0, lastTurn: 0 }));
});

test('clear passes the real V4 disk encoder, decoder, and turn/step relationship validation', async () => {
  const f = fixture();
  const flush = async () => {
    const codec = releasedV4SessionFormatCodec;
    const header = { ...f.session.header, delegationDepth: 0 };
    const decoder = codec.createDecoder(codec.encodeHeader(header, 0), 'strict');
    const collector = new SessionFormatEventCollector();
    for (const event of f.session.snapshotEvents()) {
      const row = codec.encodeEvent(event as unknown as SessionFormatEvent);
      decoder.decodeRow(JSON.parse(JSON.stringify(row)), collector);
    }
    const inheritedEventCount = decoder.finish(collector);
    restoreReleasedV4Artifact({ header: decoder.header, inheritedEventCount, events: collector.values }, KNOWN_SESSION_EVENT_TYPES);
    const restored = Session.create(f.session.id, collector.values as unknown as SessionEvent[]);
    assert.deepEqual(restored.deriveMessages(), f.session.deriveMessages());
    assert.equal(JSON.stringify(restored.deriveMessages()).includes('old secret'), false);
  };
  await clearConversation(f.query, f.invocation, flush);
  // A subsequent real turn still uses the next number; clear adds no synthetic turns.
  f.session.append('turn/start', { turn: 2 });
  f.session.append('step/start', { turn: 2, step: 1 });
  f.prompt('after-clear', 'new question');
  f.session.append('step/end', { turn: 2, step: 1 });
  f.session.append('turn/end', { turn: 2, reason: { kind: 'completed' } });
  await flush();
  await clearConversation(f.query, { ...f.invocation, commandId: 'clear-2' } as CommandInvocation, flush);
});
