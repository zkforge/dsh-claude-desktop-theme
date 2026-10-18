import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

/** Keep the browsing toolbar's localized title in sync with its list. */

/** The host's ungrouped word, and the name the reference gives that list. */
const SESSION_WORDS: readonly (readonly [string, string])[] = Object.freeze([
  ['会话', '最近会话'],
  ['Sessions', 'Recents'],
]);

/** The host's grouped heading, and the name the region takes once it is empty. */
const GROUP_WORDS: readonly (readonly [string, string])[] = Object.freeze([
  ['工作区', '最近会话'],
  ['Workspaces', 'Recents'],
]);

/**
 * The name the browsing region's own title line draws.
 * @param text - the host's word, exactly as it rendered it.
 * @param noHistory - whether the plugin's no-history prompt is on screen.
 * @returns the reference's name, or null to leave the host's own word.
 */
export function browserHeaderWord(text: string, noHistory: boolean): string | null {
  for (const [host, drawn] of SESSION_WORDS) if (text === host) return drawn;
  if (!noHistory) return null;
  for (const [host, drawn] of GROUP_WORDS) if (text === host) return drawn;
  return null;
}

/** One text node this module rewrote, and the host's own value to put back. */
interface Rewritten {
  readonly original: string;
  readonly drawn: string;
}

/**
 * Name the browsing region's separate toolbar.
 *
 * @param document - renderer document carrying the sidebar.
 * @param report - sink for observer failures; the host's two-row layout stays.
 * @returns disposer that restores every label.
 */
export function mountBrowserHeader(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const rewritten = new Map<Text, Rewritten>();
  let scheduled = 0;
  let observer: MutationObserver | undefined;
  let disposed = false;

  /** Write the reference's name over the host's own word, once per text node. */
  const name = (element: HTMLElement | null, noHistory: boolean) => {
    if (element === null) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let found = walker.nextNode(); found !== null; found = walker.nextNode()) {
      const node = found as Text;
      const next = browserHeaderWord(node.data.trim(), noHistory);
      if (next === null) continue;
      const previous = rewritten.get(node);
      const original = previous?.drawn === node.data ? previous.original : node.data;
      const drawn = node.data.replace(node.data.trim(), next);
      rewritten.set(node, { original, drawn });
      node.data = drawn;
      break;
    }
  };

  const sync = () => {
    scheduled = 0;
    if (disposed) return;
    // Sidebar rebuilds must not retain every prior text node and its subtree.
    for (const node of rewritten.keys()) if (!node.isConnected) rewritten.delete(node);
    name(
      document.querySelector<HTMLElement>(host.browserSectionLabel),
      document.querySelector('[data-ccd-empty-state="new"]') !== null,
    );
  };

  /** One microtask batch — before the paint the host's commit schedules. */
  const schedule = () => {
    if (scheduled !== 0) return;
    scheduled = 1;
    try {
      sync();
    } finally {
      scheduled = 0;
    }
  };

  /** Put the host's own word back on every node this module still owns. */
  const restore = () => {
    for (const [node, { original, drawn }] of rewritten) {
      /* Only a node still carrying what was written is restored: the host may
         have re-rendered it, and its text then belongs to React again. */
      if (node.isConnected && node.data === drawn) node.data = original;
    }
    rewritten.clear();
  };

  try {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-ccd-empty-state'],
    });
    sync();
  } catch (error) {
    observer?.disconnect();
    restore();
    report(error);
    return () => {};
  }

  return () => {
    disposed = true;
    scheduled = 0;
    observer?.disconnect();
    restore();
  };
}
