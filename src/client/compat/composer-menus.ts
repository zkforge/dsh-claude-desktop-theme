import type { Disposer } from '../contracts/ports.ts';
import { HOST, hostSelectors } from './host-dom.ts';

/** Marks a menu this module has already placed above its anchor. */
export const FLIPPED_MENU_ATTRIBUTE = 'data-ccd-menu-flipped';

/** Gap between the flipped menu and the anchor's top edge, in logical px. */
const GAP = 4;

/** Viewport fit the `Menu` primitive keeps on every side, from its own MARGIN. */
const MARGIN = 12;

/** Room the primitive keeps above a card: the frame clearance plus this gap. */
const OVERLAY_GAP = 20;

/** Frame property carrying the macOS traffic-light clearance, set by `ui-layout`. */
const FRAME_TOP_CLEARANCE = '--dsh-frame-top-clearance';

/** A row that opens a side card; the primitive never clips those menus. */
const SUBMENU_ROW = `${HOST.menuItem}[aria-haspopup="menu"]`;

/** Height the menu asks for while no cap of ours is applied. */
interface Measurement {
  readonly height: number;
  readonly viewport: number;
  readonly width: number;
}

/** What this module wrote on one menu, so release can put the node back. */
interface Placement {
  /** The menu's own inline `max-height`, before this module touched it. */
  readonly previous: string;
  /** The value currently written; equal to `previous` when the card is not capped. */
  readonly cap: string;
}

/**
 * Place bottom-edge Composer and hero-chip menus above their anchors, using
 * the Menu primitive's side=top geometry. The side is decided from the two free
 * spaces alone — the room above wins whenever it is the larger one — so a card
 * short enough to fit below does not stay under a control the reference opens
 * upwards from. Cap only cards taller than the free space above the anchor so
 * later content growth keeps its natural height. MutationObserver and resize
 * reapply placement when the host updates it.
 * @returns disposer that restores each menu and releases the observers.
 */
export function mountComposerMenuPlacement(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const placed = new Map<HTMLElement, Placement>();
  const measured = new Map<HTMLElement, Measurement>();
  let scheduled = 0;

  /**
   * The control that owns the open menu: the blank-session chips row (workspace
   * picker and agent-preset picker), a Composer control, or the sidebar's
   * account row — the three anchors that sit on the window's bottom edge.
   */
  const anchorOf = (): HTMLElement | null => {
    const expanded = '[aria-expanded="true"]';
    return document.querySelector<HTMLElement>(`${host.heroWorkspaceRow} ${expanded}`)
      ?? document.querySelector<HTMLElement>(`${host.heroWorkspaceChip}${expanded}`)
      ?? document.querySelector<HTMLElement>(`${host.composerCard} ${expanded}`)
      ?? document.querySelector<HTMLElement>(`${host.accountTrigger}${expanded}`);
  };

  /**
   * The primitive's own top fit (`overlayTopMargin` in `ui-primitives`): the
   * frame clearance plus 20px, floored at its MARGIN; fullscreen keeps only the
   * 20px gap.
   */
  const topMargin = (): number => {
    const root = document.documentElement;
    const clearance = Number.parseFloat(getComputedStyle(root).getPropertyValue(FRAME_TOP_CLEARANCE));
    if (Number.isNaN(clearance)) return MARGIN;
    return Math.max(MARGIN, (root.hasAttribute('data-fullscreen') ? 0 : clearance) + OVERLAY_GAP);
  };

  /**
   * The height the menu asks for, whatever cap this module has applied: a
   * placement decided from the capped height would flip-flop between passes, so
   * the cap comes off for the measurement and goes straight back on.
   *
   * The answer is refreshed from the live box on every pass. While this module's
   * ceiling is not what clips the card, that box *is* the card's own height, so a
   * card that grew since it was measured — the account menu's header, a picker's
   * late rows — re-places itself flush against its anchor. A live height equal to
   * the ceiling means the card is taller than the free space, and the cached
   * uncapped height is the answer. The cache exists for that case: measuring
   * lifts and restores the cap, and repeating those writes on every observer
   * pass would make the observer's own records feed it forever.
   */
  const naturalHeight = (menu: HTMLElement): number => {
    const cached = measured.get(menu);
    const placement = placed.get(menu);
    if (cached !== undefined && cached.viewport === window.innerHeight && cached.width === window.innerWidth) {
      const live = menu.getBoundingClientRect().height;
      if (placement === undefined || placement.cap === placement.previous || live < Number.parseFloat(placement.cap)) {
        if (live > 0 && live !== cached.height) {
          measured.set(menu, { height: live, viewport: cached.viewport, width: cached.width });
        }
        return live;
      }
      return cached.height;
    }
    if (placement !== undefined) menu.style.maxHeight = placement.previous;
    const height = menu.getBoundingClientRect().height;
    if (placement !== undefined) menu.style.maxHeight = placement.cap;
    measured.set(menu, { height, viewport: window.innerHeight, width: window.innerWidth });
    return height;
  };

  /** Undo everything this module wrote on one menu. */
  const restore = (menu: HTMLElement): void => {
    const placement = placed.get(menu);
    if (placement === undefined) return;
    placed.delete(menu);
    menu.style.maxHeight = placement.previous;
    menu.removeAttribute(FLIPPED_MENU_ATTRIBUTE);
  };

  /**
   * Decide from the anchor and the viewport, never from where the menu currently
   * is: the host rewrites `top` on every frame, so a decision that depends on the
   * menu's own rect would flip-flop between the two placements.
   */
  const place = (menu: HTMLElement, anchor: DOMRect, viewport: number): void => {
    const height = naturalHeight(menu);
    if (height === 0) return;
    /* Below the anchor is the primitive's own placement, and that space is not
       free here: under the hero chips row it is the Composer itself, and for a
       Composer control it is the rest of the tool row. A card that fits down
       there still covers the surface it belongs to — and the picker is the case
       that shows why "it fits below" cannot decide the side: with one workspace
       the card is a row shorter than that space and stays down, with two it is
       tall enough to be lifted, so the picker would appear to change sides as
       workspaces are added. The reference opens both families upwards, so only a
       window where the room below is genuinely the larger one keeps the native
       side. */
    const below = viewport - MARGIN - (anchor.bottom + GAP);
    const above = anchor.top - GAP - topMargin();
    if (above <= below) {
      restore(menu);
      return;
    }
    const fitsAbove = height <= above;
    /* A menu with side cards is never clipped by the primitive, and this module
       will not add a ceiling those cards would be cropped by. */
    if (!fitsAbove && menu.querySelector(SUBMENU_ROW) !== null) {
      restore(menu);
      return;
    }
    const previous = placed.get(menu)?.previous ?? menu.style.maxHeight;
    /* Only the card that cannot fit above its anchor gets a ceiling, and that
       ceiling is the free space itself; every other card keeps its own height. */
    const cap = fitsAbove ? previous : `${Math.round(above)}px`;
    placed.set(menu, { previous, cap });
    menu.setAttribute(FLIPPED_MENU_ATTRIBUTE, '');
    const top = `${Math.round(anchor.top - GAP - Math.min(height, fitsAbove ? height : above))}px`;
    if (menu.style.top !== top) menu.style.top = top;
    if (menu.style.maxHeight !== cap) menu.style.maxHeight = cap;
  };

  const sync = () => {
    scheduled = 0;
    const anchor = anchorOf();
    const visited = new Set<HTMLElement>();
    if (anchor !== null) {
      const anchorRect = anchor.getBoundingClientRect();
      for (const menu of document.querySelectorAll<HTMLElement>(host.menu)) {
        if (getComputedStyle(menu).position !== 'fixed') continue;
        visited.add(menu);
        place(menu, anchorRect, window.innerHeight);
      }
    }
    /* A menu that closed, or that stopped being a fixed menu surface — the model
       picker swaps its role between panes — must not keep a correction written
       for the surface it was. */
    for (const menu of [...placed.keys()]) if (!visited.has(menu)) restore(menu);
    for (const menu of [...measured.keys()]) if (!visited.has(menu)) measured.delete(menu);
  };

  /**
   * The correction runs straight from the observer (or the resize listener)
   * instead of on the next animation frame: Chromium throttles
   * `requestAnimationFrame` in an occluded window, and a menu placed while the
   * window is in the background must still land correctly. Observer callbacks are
   * already batched into one microtask, so this stays a single pass per batch, and
   * the pass stops writing as soon as the value matches.
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

  /**
   * The window resizes under the open menu, so the anchor moves even when the
   * primitive writes nothing: its own tracker is a `requestAnimationFrame` loop,
   * which Chromium throttles while the window is occluded. Re-measure rather
   * than reuse the cached height, because wrapping changes with the width.
   */
  const onResize = () => {
    for (const menu of [...measured.keys()]) measured.delete(menu);
    schedule();
  };

  let observer: MutationObserver | undefined;
  try {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'aria-expanded'],
    });
    window.addEventListener('resize', onResize);
    sync();
  } catch (error) {
    observer?.disconnect();
    window.removeEventListener('resize', onResize);
    report(error);
    return () => {};
  }

  return () => {
    scheduled = 0;
    observer?.disconnect();
    window.removeEventListener('resize', onResize);
    for (const menu of [...placed.keys()]) restore(menu);
    measured.clear();
  };
}
