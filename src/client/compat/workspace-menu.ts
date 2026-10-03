import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

/**
 * The workspace picker's add row, printed the way the reference prints it.
 *
 * The label DSH renders there is the host's own localised string
 * (`ui-workspace`'s `menu.addWorkspace`: "添加工作区…" / "Add workspace…"), so
 * this plugin owns neither the words nor the glyph: only a label that already
 * ends in the typographic ellipsis takes the reference's spaced dots, in
 * whatever language the host served, and a dictionary that ends any other way
 * is left exactly as it is. No string is written from here.
 *
 * The row is found structurally. The picker's card is the open chip's portalled
 * `Menu` — the document's fixed-position `[role="menu"]`, the same fact
 * `compat/account-menu.ts` reads for its own card — and the add row is the one
 * the primitive pins in the card's footer group, the second
 * `role="presentation"` block of the surface, below the `.viewport` the
 * workspace rows scroll in. Nothing is added, removed or reordered: the text is
 * changed on the node the host rendered, so the button's accessible name, which
 * the browser computes from its own contents, follows the visible label instead
 * of being restated by hand.
 *
 * A card without that footer group is left alone rather than guessed at. React
 * does not rewrite an unchanged label, and the rewrite is idempotent — a label
 * that no longer ends in the ellipsis is skipped — so a card the host leaves
 * open is never written twice.
 */

/** The ellipsis glyph the host's own dictionaries end the label with. */
const ELLIPSIS = '\u2026';

/** The spaced dots the reference prints in its place. */
const SPACED_DOTS = '. . .';

/** One text node this module rewrote, and the host's value to put back. */
interface Rewritten {
  readonly node: Text;
  readonly original: string;
}

/**
 * The label with its trailing ellipsis spaced out.
 * @param text - one label run, as the host rendered it.
 * @returns the rewritten run, or null when it carries no trailing ellipsis.
 */
function spacedDots(text: string): string | null {
  if (!text.endsWith(ELLIPSIS)) return null;
  return `${text.slice(0, -ELLIPSIS.length)}${SPACED_DOTS}`;
}

/**
 * Print the workspace picker's "add workspace" row with spaced dots.
 *
 * The card is watched only while the picker is open, and every write is undone
 * on release, so a disabled plugin leaves the host's own label on screen. The
 * observer runs synchronously from the mutation batch (never on an animation
 * frame, which an occluded window throttles), so the row is rewritten in the
 * commit that mounts it and never shows the host's glyph first.
 *
 * @param document - renderer document carrying the hero chip and the portal.
 * @param report - sink for observer failures; the native label stays untouched.
 * @returns disposer that disconnects every observer and restores each label.
 */
export function mountWorkspaceMenu(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const rewritten: Rewritten[] = [];
  let trigger: HTMLElement | null = null;
  let watched: HTMLElement | null = null;
  let scheduled = 0;

  /** Every text node under one element, in document order. */
  const textNodes = (root: Element): readonly Text[] => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) nodes.push(node as Text);
    return nodes;
  };

  /** Put the host's own label back on every node this module still owns. */
  const restore = () => {
    for (const { node, original } of rewritten) {
      /* Only a node still carrying what was written is restored: the host may
         have re-rendered it, and its text then belongs to React again. */
      if (node.isConnected && node.data === spacedDots(original)) node.data = original;
    }
    rewritten.length = 0;
  };

  /**
   * The card the open chip owns: a portalled `Menu` surface is the document's
   * fixed-position `[role="menu"]`.
   */
  const openMenu = (): HTMLElement | null => {
    let target: HTMLElement | null = null;
    for (const candidate of document.querySelectorAll<HTMLElement>(host.menu)) {
      if (getComputedStyle(candidate).position === 'fixed') target = candidate;
    }
    return target;
  };

  /** Rewrite the ellipsis of the one row the card pins below its item list. */
  const spaceOut = (menu: HTMLElement) => {
    const groups = menu.querySelectorAll(':scope > [role="presentation"]');
    /* One group is the scrolling item list; the picker opens this card only
       while at least one workspace exists, so the add row is always in the
       second one. */
    const pinned = groups.length > 1 ? groups[groups.length - 1] : undefined;
    if (pinned === undefined) return;
    for (const row of pinned.querySelectorAll(host.menuItem)) {
      for (const node of textNodes(row)) {
        const next = spacedDots(node.data);
        if (next === null) continue;
        rewritten.push({ node, original: node.data });
        node.data = next;
      }
    }
  };

  const sync = () => {
    scheduled = 0;
    const open = trigger?.getAttribute('aria-expanded') === 'true';
    const menu = open ? openMenu() : null;
    if (menu === watched) {
      if (menu !== null) spaceOut(menu);
      return;
    }
    /* The watched card closed, or the host replaced it: the contents observer
       goes first, so restoring the host's text cannot feed the next pass, and
       the nodes this module still owns are handed back before the watch moves. */
    contents?.disconnect();
    contents = undefined;
    restore();
    watched = menu;
    if (menu === null) return;
    spaceOut(menu);
    contents = new MutationObserver(schedule);
    contents.observe(menu, { childList: true, subtree: true, characterData: true });
  };

  /**
   * Observer callbacks are batched into one microtask, and the rewrite has to
   * land in the commit that renders the row even while the window is occluded
   * and animation frames are throttled.
   */
  const schedule = () => {
    if (scheduled !== 0) return;
    scheduled = 1;
    try {
      sync();
    } finally {
      scheduled = 0;
    }
  };

  let tree: MutationObserver | undefined;
  let attributes: MutationObserver | undefined;
  let contents: MutationObserver | undefined;
  let attached: HTMLElement | null = null;
  try {
    tree = new MutationObserver(() => {
      const found = document.querySelector<HTMLElement>(host.heroWorkspaceChip);
      if (found !== attached) {
        attributes?.disconnect();
        attached = found;
        trigger = found;
        if (found !== null) {
          attributes = new MutationObserver(schedule);
          attributes.observe(found, { attributes: true, attributeFilter: ['aria-expanded'] });
        }
      }
      schedule();
    });
    tree.observe(document.body, { childList: true, subtree: true });
    const initial = document.querySelector<HTMLElement>(host.heroWorkspaceChip);
    if (initial !== null) {
      attached = initial;
      trigger = initial;
      attributes = new MutationObserver(schedule);
      attributes.observe(initial, { attributes: true, attributeFilter: ['aria-expanded'] });
    }
    sync();
  } catch (error) {
    tree?.disconnect();
    attributes?.disconnect();
    contents?.disconnect();
    restore();
    report(error);
    return () => {};
  }

  return () => {
    scheduled = 0;
    tree?.disconnect();
    attributes?.disconnect();
    contents?.disconnect();
    restore();
  };
}
