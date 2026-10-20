import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsInTranscript } from './mutation-scope.ts';

/* DSH 0.2.0-rc.2 ui-conversation/locales: placeholder.hero → placeholder.default.
   Match only the shipped default hero copy; workspace, blocked and command
   hints retain their host-owned text. No runtime feature import is required. */
const DEFAULT_COPY = new Map([
  ['描述你想要构建的内容, / 调用指令, @ 文件或对话', '发消息或创建任务, / 调用指令, @ 文件或对话'],
  ['Describe what you want to build, / commands, @ files or sessions', 'Message or run a task, / commands, @ files or sessions'],
]);

/** Unify the default hero hint with chat, preserving the official editor. */
export function mountComposerPlaceholder(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  let active: { input: HTMLElement; node: ChildNode | null; from: string; to: string; aria: boolean } | null = null;
  const release = () => {
    if (active === null) return;
    if (active.node?.nodeValue === active.to) active.node.nodeValue = active.from;
    if (active.aria && active.input.getAttribute('aria-label') === active.to) {
      active.input.setAttribute('aria-label', active.from);
    }
    active = null;
  };
  const sync = () => {
    const hero = `${host.conversationRoot}[data-phase="hero"]`;
    const input = document.querySelector<HTMLElement>(`${hero} ${host.composerInput}`);
    const from = input?.getAttribute('data-placeholder') ?? '';
    const to = DEFAULT_COPY.get(from);
    if (active !== null && (active.input !== input || active.from !== from)) release();
    if (input === null || to === undefined) return;
    active ??= { input, node: null, from, to, aria: false };
    /* Change an existing text node in place, never replace React's children. */
    const node = document.querySelector(`${hero} ${host.composerPlaceholder}`)?.firstChild ?? null;
    if (node?.nodeType === 3 && node.nodeValue === from) {
      node.nodeValue = to;
      active.node = node;
    }
    if (input.getAttribute('aria-label') === from) {
      input.setAttribute('aria-label', to);
      active.aria = true;
    }
  };
  const observer = new MutationObserver(records => { if (!recordsInTranscript(records)) sync(); });
  try {
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['data-phase', 'data-placeholder', 'aria-label'],
    });
    sync();
  } catch (error) {
    observer.disconnect();
    release();
    report(error);
    return () => {};
  }
  return () => { observer.disconnect(); release(); };
}
