import type { Disposer } from '../contracts/ports.ts';
import { hostAnchors, hostSelectors } from './host-dom.ts';

/** Custom property carrying the active View segment's offset inside the tablist. */
export const VIEW_OFFSET_PROPERTY = '--ccd-view-x';

/** Custom property carrying the active View segment's width. */
export const VIEW_WIDTH_PROPERTY = '--ccd-view-w';

/** Animate selection changes; layout corrections must be immediate. */
export const VIEW_DURATION_PROPERTY = '--ccd-view-duration';

/**
 * Marker on the tablist while it is parked in the sidebar's window-control row.
 * `conversation.css` draws the fixed-position state from it; its absence means
 * the host's own row (the header, or whatever the platform still offers) keeps
 * the switcher.
 */
export const VIEW_DOCK_ATTRIBUTE = 'data-ccd-view-dock';

/** Custom property carrying the parked tablist's inset from the window's right edge. */
export const VIEW_DOCK_RIGHT_PROPERTY = '--ccd-view-dock-right';

/** Marker on a tab whose label is drawn as artwork, naming the View it selects. */
export const VIEW_TAB_ATTRIBUTE = 'data-ccd-view';

/** Marker on the artwork seat injected into a decorated tab. */
export const VIEW_GLYPH_ATTRIBUTE = 'data-ccd-view-glyph';

/**
 * The parked pill's inset from the sidebar column's right edge, in px. Measured
 * at @2x on the reference: the column's divider sits 16 device px right of the
 * pill's right edge (DESIGN.md §6.5).
 */
export const VIEW_DOCK_INSET = 8;

/** Bundled artwork, one per shipped View; see features/conversation/view-switch-icons.ts. */
export interface ViewSwitchIcons {
  readonly chat: string;
  readonly trajectory: string;
}

type ViewKind = keyof ViewSwitchIcons;

/**
 * The two shipped Views' labels — `ui-chat`'s `view.chat` (对话 / Chat) and
 * `ui-trajectory`'s `view.trajectory` (轨迹 / Trajectory). A tablist is built
 * from whatever views are registered, so the label is the only identity a tab
 * carries: a third-party View keeps its text and is left alone.
 */
function viewKind(label: string): ViewKind | null {
  if (label === '对话' || label === 'Chat') return 'chat';
  if (label === '轨迹' || label === 'Trajectory') return 'trajectory';
  return null;
}

/**
 * Shape the host's View switcher, and park it where the reference has it.
 *
 * Three jobs, one observer:
 * - Publish the selected segment's geometry for the sliding thumb
 *   (`--ccd-view-x` / `-w` / `-duration`), measured against the tablist.
 * - Replace each shipped tab's text label with bundled artwork (the host draws
 *   the labels itself; a tab has no icon of its own), reversibly.
 * - Park the tablist in the sidebar column's top-right corner — the reference
 *   keeps the View switcher on the window-control row — by measuring the
 *   column and publishing its inset (`data-ccd-view-dock` +
 *   `--ccd-view-dock-right`). The node stays where React put it: only CSS moves
 *   it, exactly as the macOS sidebar toggle is parked.
 *
 * The mutation observer covers tablist replacement, selection, frame drags
 * (inline grid tracks) and the collapse flag, synchronously, including occluded
 * windows where animation frames are throttled. A ResizeObserver on the sidebar
 * column covers what no attribute says: the column's own width while the grid
 * track animates between 0 and its settled value.
 *
 * @returns disposer that clears the observers, every injected node, every
 *     written attribute and every published property.
 */
export function mountViewSwitch(
  document: Document, icons: ViewSwitchIcons, report: (error: unknown) => void,
): Disposer {
  const selectors = hostSelectors(document);
  const anchors = hostAnchors(document);
  let scheduled = 0;
  let tabs: HTMLElement | null = null;
  let selected: HTMLElement | null = null;
  let column: HTMLElement | null = null;
  let observer: MutationObserver | undefined;
  let size: ResizeObserver | undefined;
  /* Glyphs are collected on release/prune by node identity, so the set only
     needs what `remove()` and `isConnected` require of an element. */
  const glyphs = new Set<Element>();
  const attributes = new Map<Element, Map<string, { original: string | null; drawn: string }>>();

  /** Write one attribute, recording the host's original value the first time. */
  const attribute = (element: Element, name: string, value: string) => {
    const current = element.getAttribute(name);
    if (current === value) return;
    let entries = attributes.get(element);
    if (!entries) {
      entries = new Map();
      attributes.set(element, entries);
    }
    const previous = entries.get(name);
    const original = previous?.drawn === current ? previous.original : current;
    entries.set(name, { original, drawn: value });
    element.setAttribute(name, value);
  };

  /**
   * Hand back one replaced tab and forget it.
   *
   * The map keys on the node, so a tablist React swapped out would otherwise
   * stay reachable — with the rest of its detached subtree — for the rest of
   * this mount. Restoring only the values this module still owns keeps a later
   * host write intact, the same rule `restore` applies at teardown.
   */
  const release = (element: Element) => {
    const entries = attributes.get(element);
    if (entries !== undefined) {
      for (const [name, record] of entries) {
        if (element.getAttribute(name) !== record.drawn) continue;
        if (record.original === null) element.removeAttribute(name);
        else element.setAttribute(name, record.original);
      }
      attributes.delete(element);
    }
    for (const glyph of element.querySelectorAll(`[${VIEW_GLYPH_ATTRIBUTE}]`)) glyphs.delete(glyph);
  };

  /** Release every record whose node the host has replaced or removed. */
  const prune = () => {
    for (const glyph of glyphs) if (!glyph.isConnected) glyphs.delete(glyph);
    for (const element of [...attributes.keys()]) {
      if (!element.isConnected) release(element);
    }
  };

  /** Prepend the bundled glyph to each shipped tab, once per React node. */
  const decorate = (tablist: HTMLElement) => {
    for (const tab of tablist.querySelectorAll<HTMLElement>(selectors.conversationTab)) {
      const label = tab.textContent?.trim() ?? '';
      const kind = viewKind(label);
      if (kind === null) continue;
      attribute(tab, VIEW_TAB_ATTRIBUTE, kind);
      /* The label leaves the paint (`conversation.css`), so the button's
         accessible name is written down instead of being inferred. */
      attribute(tab, 'aria-label', label);
      if (tab.querySelector(`:scope > [${VIEW_GLYPH_ATTRIBUTE}]`) !== null) continue;
      const glyph = document.createElement('span');
      glyph.className = 'ccd-view-glyph';
      glyph.setAttribute(VIEW_GLYPH_ATTRIBUTE, '');
      glyph.setAttribute('aria-hidden', 'true');
      // Trusted, bundled SVG constants; no host/user HTML is interpolated.
      glyph.innerHTML = icons[kind];
      tab.prepend(glyph);
      glyphs.add(glyph);
    }
    prune();
  };

  /** Park the tablist in the sidebar's top-right corner, or hand it back. */
  const dock = (tablist: HTMLElement) => {
    const next = document.querySelector<HTMLElement>(selectors.sidebarColumn);
    if (next !== column) {
      if (column !== null) size?.disconnect();
      column = next;
      if (column !== null) size?.observe(column);
    }
    let right: number | null = null;
    /* macOS only: that window's top row (traffic lights, the collapse toggle)
       is the reference's row, and the plugin already parks the toggle there in
       window coordinates. A collapsed column (0px on the desktop builds) or one
       too narrow to hold the pill plus its own insets keeps it in the header. */
    if (column !== null
      && document.documentElement?.dataset?.platform === 'darwin'
      && document.querySelector(anchors.sidebarCollapsed) === null) {
      const box = column.getBoundingClientRect();
      if (box.width >= tablist.getBoundingClientRect().width + 2 * VIEW_DOCK_INSET) {
        /* Viewport coordinates: neither the frame nor either column creates a
           transform or layout-containment context in the pinned build, so a
           fixed box resolves against the window (the plugin's conversation
           root carries `container-type: inline-size`, which does not trap
           fixed positioning). A right panel taking its own column is measured
           off the sidebar's edge and changes none of this. */
        right = round(window.innerWidth - box.right) + VIEW_DOCK_INSET;
      }
    }
    if (right === null) {
      if (tablist.hasAttribute(VIEW_DOCK_ATTRIBUTE)) tablist.removeAttribute(VIEW_DOCK_ATTRIBUTE);
      if (tablist.style.getPropertyValue(VIEW_DOCK_RIGHT_PROPERTY) !== '') {
        tablist.style.removeProperty(VIEW_DOCK_RIGHT_PROPERTY);
      }
      return;
    }
    if (tablist.getAttribute(VIEW_DOCK_ATTRIBUTE) !== 'sidebar') {
      tablist.setAttribute(VIEW_DOCK_ATTRIBUTE, 'sidebar');
    }
    const inset = `${right}px`;
    if (tablist.style.getPropertyValue(VIEW_DOCK_RIGHT_PROPERTY) !== inset) {
      tablist.style.setProperty(VIEW_DOCK_RIGHT_PROPERTY, inset);
    }
  };

  const sync = () => {
    scheduled = 0;
    const next = document.querySelector<HTMLElement>(selectors.conversationTabs);
    if (next !== tabs) {
      /* A replaced tablist is a fresh React node: its decoration and every
         published property are written again from nothing. The old node is
         released here rather than at teardown, so a long run does not keep one
         detached tablist per Session switch. */
      if (tabs !== null) release(tabs);
      tabs = next;
      selected = null;
    }
    prune();
    if (tabs === null || !tabs.isConnected) return;
    decorate(tabs);
    dock(tabs);
    const active = tabs.querySelector<HTMLElement>(selectors.conversationTabActive);
    if (active === null) return;
    /* Measured against the tablist rather than `offsetLeft`, so the value stays
       right whatever the buttons' offset parent turns out to be. */
    const track = tabs.getBoundingClientRect();
    const segment = active.getBoundingClientRect();
    const offset = `${round(segment.left - track.left)}px`;
    const width = `${round(segment.width)}px`;
    const moved = tabs.style.getPropertyValue(VIEW_OFFSET_PROPERTY) !== offset
      || tabs.style.getPropertyValue(VIEW_WIDTH_PROPERTY) !== width;
    if (moved) {
      /* A column resize changes the same button's geometry. Animating that
         correction would make the thumb lag behind the pointer. Own style
         notifications must not cancel a selection animation already running. */
      tabs.style.setProperty(VIEW_DURATION_PROPERTY, selected !== null && selected !== active ? '180ms' : '0ms');
      tabs.style.setProperty(VIEW_OFFSET_PROPERTY, offset);
      tabs.style.setProperty(VIEW_WIDTH_PROPERTY, width);
    }
    selected = active;
  };

  const schedule = () => {
    if (scheduled !== 0) return;
    scheduled = 1;
    try {
      sync();
    } finally {
      scheduled = 0;
    }
  };

  const restore = () => {
    for (const glyph of glyphs) glyph.remove();
    for (const [element, entries] of attributes) for (const [name, record] of entries) {
      if (element.getAttribute(name) !== record.drawn) continue;
      if (record.original === null) element.removeAttribute(name);
      else element.setAttribute(name, record.original);
    }
    glyphs.clear();
    attributes.clear();
  };

  try {
    observer = new MutationObserver(schedule);
    /* Selection changes classes/attributes; frame drag changes inline grid
       tracks; labels are text nodes; collapse flips the frame's flag. Observe
       all four geometry signals. */
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true,
      attributeFilter: ['class', 'aria-selected', 'style', 'data-sidebar-collapsed'],
    });
    /* The column's width is the one input no attribute reports while it
       animates — the collapse transition moves the grid track 0 ↔ 264px — so
       the sidebar column is observed directly. (The one deliberate exception to
       the "observers only" rule in ARCHITECTURE.md: it only refines an
       already-published position.) */
    if (typeof ResizeObserver === 'function') size = new ResizeObserver(schedule);
    window.addEventListener('resize', schedule);
    sync();
  } catch (error) {
    observer?.disconnect();
    size?.disconnect();
    size = undefined;
    window.removeEventListener('resize', schedule);
    restore();
    report(error);
    return () => {};
  }

  return () => {
    scheduled = 0;
    observer?.disconnect();
    size?.disconnect();
    size = undefined;
    window.removeEventListener('resize', schedule);
    restore();
    tabs?.removeAttribute(VIEW_DOCK_ATTRIBUTE);
    tabs?.style.removeProperty(VIEW_DOCK_RIGHT_PROPERTY);
    tabs?.style.removeProperty(VIEW_OFFSET_PROPERTY);
    tabs?.style.removeProperty(VIEW_WIDTH_PROPERTY);
    tabs?.style.removeProperty(VIEW_DURATION_PROPERTY);
    tabs = null;
    selected = null;
    column = null;
  };
}

/** Half-pixel precision: sub-pixel segment edges must not smear the thumb. */
function round(value: number): number {
  return Math.round(value * 2) / 2;
}
