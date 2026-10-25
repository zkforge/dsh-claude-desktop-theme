import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsIntroduce, recordsTouch } from './mutation-scope.ts';
import type { SidebarPanelsPort } from './sidebar-panels.ts';

/** The panel id this module read off a row's position in the list. */
export const SIDEBAR_PANEL_ATTRIBUTE = 'data-ccd-panel';
/** Marks the list child the Edit sidebar dialog took out of the column. */
export const SIDEBAR_PANEL_HIDDEN_ATTRIBUTE = 'data-ccd-panel-hidden';

/** The ids the Edit sidebar dialog keeps out of the column. */
export interface HiddenPanels {
  has(id: string): boolean;
  subscribe(listener: () => void): Disposer;
}

export interface SidebarPanelRows {
  /** A copy of the glyph a panel's row draws, for the dialog's list. */
  glyph(id: string): Element | null;
  dispose: Disposer;
}

/**
 * Name the panel rows by id and keep the hidden ones out of the column.
 *
 * `PanelRow` exposes no id, but `SidebarRoot` renders exactly one row per
 * `sidebar.panellist` entry, in the order the port reads — the host's own pin
 * filter is never written (its only setter reaches the More card's rows, which
 * leave it alone) — so a row's position is its identity. When the counts
 * disagree for a frame (an entry registering while the column has not caught
 * up), the marks are withdrawn rather than guessed: nothing is hidden until the
 * two agree again.
 *
 * A hidden row stays where React rendered it: the mark goes on the list child
 * that holds it, and `sidebar-editor.css` takes that child out of the flow, so
 * the list's gap closes and DSH keeps every node and handler.
 */
export function mountSidebarPanelRows(
  document: Document,
  port: SidebarPanelsPort,
  hidden: HiddenPanels,
  report: (error: unknown) => void,
): SidebarPanelRows {
  const host = hostSelectors(document);
  const marked = new Set<Element>();
  let list: Element | null = null;

  const unmark = (element: Element) => {
    element.removeAttribute(SIDEBAR_PANEL_ATTRIBUTE);
    element.removeAttribute(SIDEBAR_PANEL_HIDDEN_ATTRIBUTE);
  };
  const write = (element: Element, name: string, value: string | null) => {
    if (element.getAttribute(name) === value) return;
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  };

  const sync = () => {
    list = document.querySelector(`${host.sidebarRoot} ${host.sidebarPanelList}`);
    const rows = list === null ? [] : Array.from(list.querySelectorAll<HTMLElement>(host.sidebarPanelRow))
      .filter(row => row.getAttribute('aria-haspopup') !== 'menu');
    const panels = port.panels();
    const next = new Set<Element>();
    if (list !== null && rows.length === panels.length) {
      rows.forEach((row, index) => {
        const id = panels[index]!.id;
        /* The list's own child: the row, or a wrapper a later build gives it. */
        let seat: Element = row;
        while (seat.parentElement !== null && seat.parentElement !== list) seat = seat.parentElement;
        write(row, SIDEBAR_PANEL_ATTRIBUTE, id);
        write(seat, SIDEBAR_PANEL_HIDDEN_ATTRIBUTE, hidden.has(id) ? '' : null);
        next.add(row).add(seat);
      });
    }
    for (const element of marked) if (!next.has(element)) unmark(element);
    marked.clear();
    for (const element of next) marked.add(element);
  };
  const run = () => { try { sync(); } catch (error) { report(error); } };

  const observer = new MutationObserver(records => {
    if (list !== null && list.isConnected ? recordsTouch(records, list)
      : recordsIntroduce(records, host.sidebarPanelList)) run();
  });
  let offPanels: Disposer = () => {};
  let offHidden: Disposer = () => {};
  const release = () => {
    observer.disconnect();
    offPanels();
    offHidden();
    for (const element of marked) unmark(element);
    marked.clear();
  };
  try {
    observer.observe(document.body, { childList: true, subtree: true });
    offPanels = port.subscribe(run);
    offHidden = hidden.subscribe(run);
    sync();
  } catch (error) {
    release();
    report(error);
  }

  return {
    glyph(id) {
      const row = Array.from(list?.querySelectorAll(`[${SIDEBAR_PANEL_ATTRIBUTE}]`) ?? [])
        .find(candidate => candidate.getAttribute(SIDEBAR_PANEL_ATTRIBUTE) === id);
      const art = row?.querySelector('[data-ccd-nav-glyph] svg') ?? row?.querySelector(`${host.sidebarPanelGlyph} svg`);
      return art ? art.cloneNode(true) as Element : null;
    },
    dispose: release,
  };
}
