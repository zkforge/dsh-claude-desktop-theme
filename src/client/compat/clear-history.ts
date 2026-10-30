import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { Disposer } from '../contracts/ports.ts';
import { CLEAR_MARKER, readClearBoundary } from '../../shared/clear.ts';
import { frameScheduler } from './frame.ts';

const HIDDEN = 'data-ccd-clear-hidden';

/** Display the current segment; old React-owned rows remain available as history. */
export function mountClearHistory(ctx: Context, document: Document, report: (error: unknown) => void): Disposer {
  const marked = new Set<Element>();
  const panels = new Map<Element, { id: string; seq: number; expanded: boolean; notice: HTMLElement; button: HTMLButtonElement }>();
  const sync = () => {
    try {
      const hidden = new Set<Element>();
      const mark = (element: Element, hide: boolean) => { if (hide) hidden.add(element); };
      for (const element of marked) if (!element.isConnected) marked.delete(element);
      for (const [flow, panel] of panels) {
        if (!flow.isConnected) { panel.notice.remove(); panels.delete(flow); }
      }
      const list = ctx.sessions.list.getSnapshot();
      for (const flow of document.querySelectorAll<HTMLElement>('[data-chat-flow]')) {
        const id = flow.closest('[data-conversation-session]')?.getAttribute('data-conversation-session') as SessionId | undefined;
        const raw = id ? (list.projectionsBySession[id]?.values as Record<string, unknown> | undefined)?.['ccdClear'] : undefined;
        const boundary = raw === undefined ? null : readClearBoundary(raw);
        if (!id || boundary?.seq === null || boundary === null) {
          panels.get(flow)?.notice.remove(); panels.delete(flow);
          continue;
        }
        let panel = panels.get(flow);
        if (!panel) {
          const notice = document.createElement('div');
          notice.setAttribute('data-ccd-clear-notice', '');
          const label = document.createElement('span');
          label.textContent = '上下文已清空';
          const button = document.createElement('button');
          button.type = 'button';
          button.title = '历史记录仅用于查看，不会重新发送给模型。';
          notice.append(label, button);
          panel = { id, seq: boundary.seq, expanded: false, notice, button };
          panels.set(flow, panel);
          button.addEventListener('click', () => {
            const current = panels.get(flow);
            if (current) { current.expanded = !current.expanded; sync(); }
          });
        }
        if (panel.id !== id || panel.seq !== boundary.seq) { panel.id = id; panel.seq = boundary.seq; panel.expanded = false; }
        if (panel.notice.parentElement !== flow) flow.prepend(panel.notice);
        const label = panel.expanded ? '收起历史记录' : '查看历史记录';
        if (panel.button.textContent !== label) panel.button.textContent = label;
        panel.button.setAttribute('aria-expanded', String(panel.expanded));
        const binding = ctx.uiConversation.binding(id);
        // Chat is a dynamic host target, absent from this plugin's static SDK face.
        const views = binding.snapshot.getSnapshot().views as unknown as { get(target: string): {
          nodes: { get(key: string): { id: string; anchorSeq: number } | undefined };
        } | undefined };
        const chat = views.get('chat');
        for (const row of flow.querySelectorAll('[data-chat-flow-key]')) {
          const key = row.getAttribute('data-chat-node-key');
          const node = key ? chat?.nodes.get(key) : undefined;
          const turn = Number(row.getAttribute('data-chat-turn'));
          const archived = node ? node.anchorSeq <= boundary.seq
            : row.hasAttribute('data-chat-turn') && turn <= boundary.turn;
          const internal = node?.id.startsWith(CLEAR_MARKER) || node?.id.startsWith('ccd-cleared:');
          mark(row, internal === true || (!panel.expanded && archived));
        }
        // The host's paging control precedes its flow slot. It returns with history.
        for (const child of flow.children) {
          if (child !== panel.notice && child.querySelector(':scope > button')) mark(child, !panel.expanded);
        }
        // The native turn rail includes archived turns; keep it with the history view.
        const frame = flow.parentElement?.parentElement?.parentElement;
        for (const nav of frame?.querySelectorAll(':scope > div > nav') ?? []) mark(nav.parentElement!, !panel.expanded);
      }
      for (const element of marked) if (!hidden.has(element)) { element.removeAttribute(HIDDEN); marked.delete(element); }
      for (const element of hidden) {
        if (!element.hasAttribute(HIDDEN)) element.setAttribute(HIDDEN, '');
        marked.add(element);
      }
    } catch (error) { report(error); }
  };
  const frames = frameScheduler(sync, document.defaultView);
  const observer = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => node.nodeType === 1
      && ((node as Element).matches('[data-chat-flow], [data-chat-flow-key], [data-conversation-session]')
        || (node as Element).querySelector('[data-chat-flow], [data-chat-flow-key]'))))) frames.schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const stop = ctx.sessions.list.subscribe(() => frames.schedule());
  sync();
  return () => {
    stop(); observer.disconnect(); frames.cancel();
    for (const element of marked) element.removeAttribute(HIDDEN);
    for (const panel of panels.values()) panel.notice.remove();
    marked.clear(); panels.clear();
  };
}
