import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsInTranscript } from './mutation-scope.ts';
import type { WorkspacePickerPort } from './workspace-picker-port.ts';
import { mountWorktreeToggle } from './workspace-worktree.ts';
import {
  createMenuSearch, FILTERED_ATTRIBUTE, menuCopy, mountWorkspaceBranch, WORKSPACE_EXTRA_ATTRIBUTE, type BranchCache,
} from './workspace-branch.ts';

/**
 * The workspace picker card, dressed as the reference's folder picker: a search
 * line on top, a「最近」heading over the workspace rows, the add row printed as
 * 「打开文件夹 . . .」, and a branch row below it (`compat/workspace-branch.ts`).
 *
 * The add row's label is the host's own localised string
 * (`ui-workspace`'s `menu.addWorkspace`: "添加工作区…" / "Add workspace…"). Only
 * a label that ends in the typographic ellipsis is rewritten — to the
 * reference's words with spaced dots, in Chinese or English after `<html lang>`
 * — so a dictionary that ends any other way is left exactly as it is.
 *
 * The row is found structurally. The picker's card is the open chip's portalled
 * `Menu` — the document's fixed-position `[role="menu"]`, the same fact
 * `compat/account-menu.ts` reads for its own card — and the add row is the one
 * the primitive pins in the card's footer group, the second
 * `role="presentation"` block of the surface, below the `.viewport` the
 * workspace rows scroll in. A heading is added above the workspace rows; the footer text is
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
  readonly written: string;
}

/**
 * The add row's label in the reference's words.
 * @param text - one label run, as the host rendered it.
 * @param zh - whether the interface is Chinese.
 * @returns the rewritten run, or null when it carries no trailing ellipsis.
 */
export function openFolderLabel(text: string, zh: boolean): string | null {
  if (!text.trim().endsWith(ELLIPSIS)) return null;
  return `${zh ? '打开文件夹' : 'Open folder'} ${SPACED_DOTS}`;
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
 * @param port - Workspace order and new-worktree choices.
 * @param report - sink for observer failures; the native label stays untouched.
 * @returns disposer that disconnects every observer and restores each label.
 */
export function mountWorkspaceMenu(document: Document, port: WorkspacePickerPort,
  report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const rewritten: Rewritten[] = [];
  const branches: BranchCache = new Map();
  let trigger: HTMLElement | null = null;
  let watched: HTMLElement | null = null;
  let heading: HTMLElement | null = null;
  let search: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;
  let empty: HTMLElement | null = null;
  let branch: { readonly workspaceId: string; readonly dispose: Disposer } | null = null;
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
    branch?.dispose();
    branch = null;
    heading?.remove();
    heading = null;
    search?.remove();
    search = null;
    input = null;
    empty?.remove();
    empty = null;
    for (const row of document.querySelectorAll(`[${FILTERED_ATTRIBUTE}]`)) row.removeAttribute(FILTERED_ATTRIBUTE);
    for (const { node, original, written } of rewritten) {
      /* Only a node still carrying what was written is restored: the host may
         have re-rendered it, and its text then belongs to React again. */
      if (node.isConnected && node.data === written) node.data = original;
    }
    rewritten.length = 0;
  };

  /** The host's workspace rows, in the order of the Workspace snapshot. */
  const workspaceRows = (menu: HTMLElement): HTMLElement[] => {
    const viewport = menu.querySelector<HTMLElement>(host.menuViewport);
    return viewport === null ? [] : [...viewport.querySelectorAll<HTMLElement>(host.menuItem)];
  };

  /** Hide the rows the query does not name; the wrapper is the row's own cell. */
  const filter = (menu: HTMLElement) => {
    const query = input?.value.trim().toLowerCase() ?? '';
    let shown = 0;
    for (const row of workspaceRows(menu)) {
      const match = query === '' || (row.textContent ?? '').toLowerCase().includes(query);
      const cell = row.parentElement;
      if (cell !== null && cell.hasAttribute(FILTERED_ATTRIBUTE) === match) cell.toggleAttribute(FILTERED_ATTRIBUTE, !match);
      if (match) shown++;
    }
    if (heading !== null) heading.hidden = shown === 0;
    if (empty !== null) empty.hidden = shown > 0;
  };

  /** Arrow keys walk the visible rows only, the search line first. */
  const walk = (event: KeyboardEvent) => {
    const menu = watched;
    if (menu === null || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[popover]') != null) return;
    const items = [...menu.querySelectorAll<HTMLElement>(`input, button${host.menuItem}, button[role="menuitemcheckbox"]`)].filter(item =>
      item.closest('[popover]') === null && item.closest(`[${FILTERED_ATTRIBUTE}]`) === null
      && !(item instanceof HTMLButtonElement && item.disabled));
    if (items.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[index < 0 ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length]?.focus();
  };

  /**
   * The card the open chip owns: a portalled `Menu` surface is the document's
   * fixed-position `[role="menu"]`.
   */
  const openMenu = (): HTMLElement | null => {
    let target: HTMLElement | null = null;
    for (const candidate of document.querySelectorAll<HTMLElement>(host.menu)) {
      // A side card nested in a card is never the card itself.
      if (candidate.parentElement?.closest(host.menu) != null) continue;
      if (getComputedStyle(candidate).position === 'fixed') target = candidate;
    }
    return target;
  };

  /** Dress one card: search line, heading, add row label, branch row. */
  const spaceOut = (menu: HTMLElement) => {
    const groups = [...menu.querySelectorAll(':scope > [role="presentation"]')]
      .filter(group => !group.hasAttribute(WORKSPACE_EXTRA_ATTRIBUTE));
    /* One group is the scrolling item list; the picker opens this card only
       while at least one workspace exists, so the add row is always in the
       second one. */
    const pinned = groups.length > 1 ? groups[groups.length - 1] : undefined;
    if (pinned === undefined) return;
    const { zh } = menuCopy(document);
    const viewport = menu.querySelector<HTMLElement>(host.menuViewport);
    if (viewport !== null && (heading === null || heading.parentElement !== viewport)) {
      heading?.remove();
      heading = document.createElement('div');
      heading.setAttribute('role', 'presentation');
      heading.textContent = zh ? '最近' : 'Recent';
      viewport.prepend(heading);
    }
    if (viewport !== null && (empty === null || empty.parentElement !== viewport)) {
      empty?.remove();
      empty = document.createElement('div');
      empty.setAttribute('role', 'presentation');
      empty.setAttribute('data-ccd-menu-note', '');
      empty.textContent = zh ? '无匹配的文件夹' : 'No matching folders';
      empty.hidden = true;
      viewport.append(empty);
    }
    if (search === null || search.parentElement !== menu) {
      search?.remove();
      search = document.createElement('div');
      search.setAttribute('role', 'presentation');
      search.setAttribute(WORKSPACE_EXTRA_ATTRIBUTE, 'search');
      const field = createMenuSearch(document, zh ? '搜索文件夹…' : 'Search folders…');
      field.addEventListener('input', () => { if (watched !== null) filter(watched); });
      field.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || watched === null) return;
        event.preventDefault();
        workspaceRows(watched).find(row => row.parentElement?.hasAttribute(FILTERED_ATTRIBUTE) !== true)?.click();
      });
      search.append(field);
      const viewportGroup = groups[0];
      if (viewportGroup !== undefined) menu.insertBefore(search, viewportGroup);
      else menu.prepend(search);
      input = field;
    }
    filter(menu);
    for (const row of pinned.querySelectorAll(host.menuItem)) {
      for (const node of textNodes(row)) {
        const next = openFolderLabel(node.data, zh);
        if (next === null) continue;
        rewritten.push({ node, original: node.data, written: next });
        node.data = next;
      }
    }
    /* The selected row carries the primitive's check; its index is the
       Workspace's index in the snapshot the picker renders from. */
    const rows = workspaceRows(menu);
    const selected = rows.findIndex(row => row.querySelector(host.menuItemCheck) !== null);
    const workspaceId = selected < 0 ? undefined : port.workspaceIds()[selected];
    const placed = menu.querySelector(`:scope > [${WORKSPACE_EXTRA_ATTRIBUTE}="branch"]`);
    if (branch !== null && (branch.workspaceId !== workspaceId || placed === null)) {
      branch.dispose();
      branch = null;
    } else if (placed !== null && placed !== menu.lastElementChild) {
      // A group the host mounted later goes above the branch row, as in the reference.
      menu.append(placed);
    }
    if (branch === null && workspaceId !== undefined && rows.length === port.workspaceIds().length) {
      const worktrees = port.worktrees;
      const releaseBranch = mountWorkspaceBranch(menu, workspaceId, branches, report,
        worktrees === undefined ? undefined : {
          enabled: () => { const session = worktrees.session(); return session !== undefined && worktrees.selected(session); },
          selected: () => { const session = worktrees.session(); return session === undefined ? undefined : worktrees.base(session); },
          select: name => { const session = worktrees.session(); if (session !== undefined) worktrees.setBase(session, name); },
          subscribe: listener => worktrees.subscribe(listener),
        });
      const releaseWorktree = port.worktrees === undefined ? () => {} : mountWorktreeToggle(menu, workspaceId, port.worktrees);
      branch = { workspaceId, dispose: () => { releaseWorktree(); releaseBranch(); } };
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
    watched?.removeEventListener('keydown', walk);
    restore();
    watched = menu;
    if (menu === null) return;
    spaceOut(menu);
    menu.addEventListener('keydown', walk);
    input?.focus({ preventScroll: true });
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
  // The host passes only getAnchorRect to this portalled Menu, so its outside
  // pointer handler considers the chip outside, closes on pointerdown, then the
  // chip's click toggles it open again. Let the existing click perform one toggle.
  const keepTriggerToggle = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (trigger?.getAttribute('aria-expanded') === 'true' && target !== null && trigger.contains(target)) {
      event.stopImmediatePropagation();
    }
  };
  try {
    document.addEventListener('pointerdown', keepTriggerToggle, true);
    tree = new MutationObserver(records => {
      if (recordsInTranscript(records)) return;
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
    document.removeEventListener('pointerdown', keepTriggerToggle, true);
    tree?.disconnect();
    attributes?.disconnect();
    contents?.disconnect();
    restore();
    report(error);
    return () => {};
  }

  return () => {
    document.removeEventListener('pointerdown', keepTriggerToggle, true);
    scheduled = 0;
    tree?.disconnect();
    attributes?.disconnect();
    contents?.disconnect();
    watched?.removeEventListener('keydown', walk);
    watched = null;
    restore();
  };
}
