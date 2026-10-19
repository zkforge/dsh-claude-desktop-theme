import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsIntroduce, recordsTouch } from './mutation-scope.ts';

/** Marks the sidebar column whose field is currently parked above New Session. */
export const SIDEBAR_SEARCH_PLACED_ATTRIBUTE = 'data-ccd-sidebar-search-placed';

/**
 * Park the browsing region's search field above New Session.
 *
 * The field belongs to `ui-workspace`'s `WorkspaceBrowser`, and React removes
 * it from the section header whenever the sidebar collapses to its rail.
 * Moving the React-owned node would make that removal target the wrong parent,
 * so the node stays where React put it and is positioned over the gap that New
 * Session opens above itself. That gap sits after the brand row when the brand
 * is visible and directly below the window strip when it is not.
 *
 * The section header keeps its own row. With the search slot out of flow, its
 * label takes the leading edge and the native View options trigger stays on the
 * trailing edge.
 */
export function mountSidebarSearch(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const win = document.defaultView;
  let slot: HTMLElement | null = null;
  let root: HTMLElement | null = null;
  let marked: HTMLElement | null = null;
  let scheduled = false;
  let disposed = false;
  let resize: ResizeObserver | undefined;
  const observed = new WeakSet<Element>();

  const clearMark = () => {
    marked?.removeAttribute(SIDEBAR_SEARCH_PLACED_ATTRIBUTE);
    marked = null;
  };

  const clearSlot = () => {
    if (slot === null) return;
    slot.style.removeProperty('--ccd-sidebar-search-top');
    slot.style.removeProperty('--ccd-sidebar-search-left');
    slot.style.removeProperty('--ccd-sidebar-search-width');
    slot = null;
  };

  const place = () => {
    scheduled = false;
    if (disposed) return;
    const nextRoot = document.querySelector<HTMLElement>(host.sidebarRoot);
    const newSession = nextRoot?.querySelector<HTMLElement>(host.sidebarNewSession) ?? null;
    const nextSlot = nextRoot?.querySelector<HTMLElement>(host.browserSearchSlot) ?? null;
    const collapsed = nextRoot?.classList.contains(host.sidebarCollapsed.slice(1)) ?? true;

    if (nextRoot !== root) {
      clearSlot();
      clearMark();
      root = nextRoot;
    }
    if (nextRoot === null || newSession === null || nextSlot === null || collapsed) {
      clearSlot();
      clearMark();
      return;
    }

    if (marked !== nextRoot) {
      clearMark();
      nextRoot.setAttribute(SIDEBAR_SEARCH_PLACED_ATTRIBUTE, '');
      marked = nextRoot;
    }
    if (slot !== nextSlot) {
      clearSlot();
      slot = nextSlot;
    }
    for (const element of [nextRoot, newSession, nextSlot]) {
      if (observed.has(element) || resize === undefined) continue;
      observed.add(element);
      resize.observe(element);
    }
    const box = newSession.getBoundingClientRect();
    const styles = win?.getComputedStyle(newSession);
    const marginTop = Number.parseFloat(styles?.marginTop ?? '0') || 0;
    const next = {
      /* `getBoundingClientRect()` reports the border box, so the margin this
         module opened above New Session is already included. Subtract it
         regardless of the host's `position`; the host uses `relative` here. */
      '--ccd-sidebar-search-top': `${box.top - marginTop}px`,
      '--ccd-sidebar-search-left': `${box.left}px`,
      '--ccd-sidebar-search-width': `${box.width}px`,
    };
    for (const [property, value] of Object.entries(next)) {
      if (slot.style.getPropertyValue(property) !== value) slot.style.setProperty(property, value);
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    try {
      place();
    } finally {
      scheduled = false;
    }
  };

  let observer: MutationObserver | undefined;
  try {
    observer = new MutationObserver(records => {
      if (recordsTouch(records, root) || recordsIntroduce(records, host.sidebarRoot)) schedule();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
    resize = new ResizeObserver(schedule);
    win?.addEventListener('resize', schedule);
    schedule();
  } catch (error) {
    observer?.disconnect();
    resize?.disconnect();
    win?.removeEventListener('resize', schedule);
    clearSlot();
    clearMark();
    report(error);
    return () => {};
  }

  return () => {
    disposed = true;
    observer?.disconnect();
    resize?.disconnect();
    win?.removeEventListener('resize', schedule);
    clearSlot();
    clearMark();
    root = null;
  };
}
