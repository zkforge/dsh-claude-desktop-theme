import type { Disposer } from '../contracts/ports.ts';
import { hostAnchors, hostSelectors } from './host-dom.ts';

/**
 * The browsing region's header line, and the word that names it.
 *
 * The reference draws this region as ONE line: the group's name at the inline
 * start and, at the trailing edge, the plus that starts a Session, Search and
 * the view options. DSH renders those controls on a section header of its own,
 * above a tree whose first row is the first Workspace's, so `sidebar.css` parks
 * the header on that row's line — and this module is what tells it when. The
 * merge holds only while the tree actually leads with a Workspace row: flat
 * mode renders no group at all, and `compat/empty-groups.ts` takes every group
 * off screen when there is nothing to show, so in both the header stays in the
 * flow and is the region's own title line.
 *
 * That title is a word the host serves (`section.workspaces` when the tree is
 * grouped, `section.sessions` when it is a flat list) and the reference's is
 * 最近会话 / Recents. The word is rewritten the way the sidebar's navigation
 * labels are: only a string the host itself rendered is replaced — a locale
 * this module does not know keeps the host's own word — and every write is
 * undone on release. The grouped word takes the reference's name only while the
 * plugin's no-history prompt is up, which `empty-groups.ts` marks
 * `data-ccd-empty-state="new"`; a region that still has groups to show keeps
 * the host's own heading.
 *
 * The state is one marker attribute on the browsing region rather than a style
 * per element, so a single answer covers every re-render the host makes and
 * dropping the attribute restores the host's own two-row layout.
 *
 * The parked band is locked to the tree's content, not to the region's top
 * edge: the header sits on the first Workspace row's line, so it has to leave
 * with that row when the tree scrolls. No attribute reports a scroll, and the
 * scroller is a sibling of the header rather than an ancestor, so CSS cannot
 * see it (a scroll-driven animation timeline resolves against an ancestor);
 * this module therefore listens to the scroller and publishes its distance as
 * `--ccd-header-scroll` for the band's `top`. That is one deliberate listener
 * beside the observers — the same exception `view-switch.ts` records for the
 * column's width — and it writes only when the value changes.
 */

/** Marker on the browsing region while its header shares the first row's line. */
export const BROWSER_HEADER_ATTRIBUTE = 'data-ccd-header-merged';

/** Custom property carrying the tree's scrolled distance, in px. */
export const HEADER_SCROLL_PROPERTY = '--ccd-header-scroll';

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
 * Publish the browsing region's merged-header state, and name its title line.
 *
 * @param document - renderer document carrying the sidebar.
 * @param report - sink for observer failures; the host's two-row layout stays.
 * @returns disposer that drops the marker and restores every label.
 */
export function mountBrowserHeader(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const anchors = hostAnchors(document);
  const rewritten = new Map<Text, Rewritten>();
  let scheduled = 0;
  let observer: MutationObserver | undefined;
  let disposed = false;
  let marked: HTMLElement | null = null;
  let scroller: HTMLElement | null = null;

  /** Publish the tree's scrolled distance; the parked band's `top` reads it. */
  const publish = () => {
    if (marked === null) return;
    const value = `${scroller?.scrollTop ?? 0}px`;
    if (marked.style.getPropertyValue(HEADER_SCROLL_PROPERTY) !== value) {
      marked.style.setProperty(HEADER_SCROLL_PROPERTY, value);
    }
  };

  /** Whether the tree leads with a Workspace row rather than a flat Session list. */
  const leadsWithWorkspace = (): boolean => {
    for (const group of document.querySelectorAll<HTMLElement>(host.workspaceGroup)) {
      /* A group `empty-groups.ts` has taken off screen cannot lead the tree. */
      if (group.hasAttribute('data-ccd-empty-group')) continue;
      return group.querySelector(anchors.workspaceRows) !== null;
    }
    return false;
  };

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
    const root = document.querySelector<HTMLElement>(host.browserRoot);
    if (root !== marked) {
      marked?.removeAttribute(BROWSER_HEADER_ATTRIBUTE);
      marked?.style.removeProperty(HEADER_SCROLL_PROPERTY);
      marked = root;
    }
    if (root !== null) {
      const merged = leadsWithWorkspace();
      /* Only the difference is written: this pass runs on every mutation
         batch, and its own write is one of them. */
      if (merged !== root.hasAttribute(BROWSER_HEADER_ATTRIBUTE)) {
        if (merged) root.setAttribute(BROWSER_HEADER_ATTRIBUTE, '');
        else root.removeAttribute(BROWSER_HEADER_ATTRIBUTE);
      }
    }
    /* The tree's scroller is replaced with the tree: the listener follows the
       element, and a fresh scroller starts a scroll away from the top. */
    const next = document.querySelector<HTMLElement>(host.browserList);
    if (next !== scroller) {
      scroller?.removeEventListener('scroll', publish);
      scroller = next;
      scroller?.addEventListener('scroll', publish, { passive: true });
    }
    publish();
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

  const clear = () => {
    marked?.removeAttribute(BROWSER_HEADER_ATTRIBUTE);
    marked?.style.removeProperty(HEADER_SCROLL_PROPERTY);
    marked = null;
    scroller?.removeEventListener('scroll', publish);
    scroller = null;
    restore();
  };

  try {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      /* A group's fate, and the plugin's own empty-state marker, are the two
         facts the merge and the word both turn on. */
      attributeFilter: ['data-row-key', 'data-ccd-empty-group', 'data-ccd-empty-state'],
    });
    sync();
  } catch (error) {
    observer?.disconnect();
    clear();
    report(error);
    return () => {};
  }

  return () => {
    disposed = true;
    scheduled = 0;
    observer?.disconnect();
    clear();
  };
}
