import type { Disposer } from '../contracts/ports.ts';
import { HOST, hostSelectors } from './host-dom.ts';

/**
 * The Session header's own ⋮ menu, extended with one row.
 *
 * `session-log-export` owns that menu: a `ui-primitives` `Menu` whose rows are
 * data (`下载 Session 日志`, `反馈`) and whose list is rendered in place, as the
 * second child of the menu's own root span beside its trigger. There is no slot
 * a third-party row could register into, so this module adds one to the list the
 * host drew — its first row, ahead of the host's own — cloned from a native row,
 * which is what makes the addition look native without pinning a single menu
 * class: the clone carries the host's own classes, so whatever draws that menu
 * draws this row too (today `theme/menus.css`), and the primitive's keyboard
 * walk (`Menu` walks `button:not(:disabled)` inside the list) and its
 * post-selection focus return reach it without any shared state.
 *
 * The row exists only while it is wanted: `wanted()` answers from the document,
 * and the plugin retires the shipped re-entry control this row replaces
 * (`ui-sidebar-right`'s `ExpandButton`, shadowed in the header's corner cell by
 * an entry that renders nothing), so the two never stand side by side.
 *
 * Closing the menu stays the owner's decision, exactly as it is for the host's
 * own data rows: the trigger is clicked again, which is what its own
 * `setOpen(value => !value)` handler does for a second click. Nothing is
 * dispatched at the document — a synthetic Escape or outside pointerdown would
 * be a gesture the reader never made.
 */

/** Marker the added row carries, so a later pass finds its own node. */
export const MENU_ROW_ATTRIBUTE = 'data-ccd-menu-row';

/** One row this module adds to the Session header's menu. */
export interface SessionMenuRow {
  /** Localised row label, written over the cloned row's own copy. */
  readonly label: string;
  /** Whether the row belongs in the open menu right now. */
  readonly wanted: () => boolean;
  /** Runs when the row is chosen, before the menu is dismissed. */
  readonly act: () => void;
}

/** The open Session menu — its list and its trigger — or null while it is closed. */
function openSessionMenu(document: Document): { list: HTMLElement; trigger: HTMLElement } | null {
  const host = hostSelectors(document);
  /* The menu's own trigger is the only control in this header that reports an
     expanded popup from the utilities seat; the pinned class keeps the query
     off any other header entry a later build might add there. */
  const trigger = document.querySelector<HTMLElement>(
    `${host.conversationHeader} ${host.sessionMoreButton}[aria-expanded="true"]`,
  );
  if (trigger === null) return null;
  /* `Menu` renders `<span class=root>{anchor}{list}</span>`, so the list is a
     sibling of the trigger inside the menu's own wrapper. */
  const list = trigger.parentElement?.querySelector<HTMLElement>(HOST.menu) ?? null;
  return list === null ? null : { list, trigger };
}

/** The list's row container: the primitive's own scrolling viewport. */
function viewportOf(list: HTMLElement): HTMLElement | null {
  for (const child of list.children) {
    if (child.getAttribute('role') === 'presentation') return child as HTMLElement;
  }
  return null;
}

/** The row's label seat: the row's first leaf span, which the host fills with text. */
function labelSeat(row: HTMLElement): HTMLElement | null {
  for (const span of row.querySelectorAll<HTMLElement>('span')) {
    if (span.children.length === 0 && (span.textContent ?? '').trim() !== '') return span;
  }
  return null;
}

/**
 * Copy one native row for this module's own action.
 *
 * The row is taken from the open menu itself rather than rebuilt from markup:
 * a data row is an `.itemWrap` around `button[role="menuitem"]` with an
 * optional icon seat, the label and an optional trailing shortcut, and every
 * one of those classes is a per-build hash this plugin does not pin. Copying
 * the node keeps the row's own geometry and states, and only four edits are
 * made: the label takes the caller's copy, the artwork goes with its seat (the
 * reference draws no leading glyph in a popup row, which the menu sheet already
 * hides for the host's own rows), the copied row's `disabled` attribute is dropped
 * — the source row is whichever one the host drew first, and a log export
 * running in the background must not disable the panel's re-entry control — and
 * the marker is written so `sync` can find what it added.
 *
 * @param list - the open menu's surface.
 * @param trigger - the control that opened it; a second click closes it again.
 * @param row - the copy and the callbacks for the added row.
 * @param report - receives a failure thrown by the caller's action.
 * @returns the added node, or null when this menu carries no row to copy.
 */
function insertRow(
  list: HTMLElement,
  trigger: HTMLElement,
  row: SessionMenuRow,
  report: (error: unknown) => void,
): HTMLElement | null {
  const viewport = viewportOf(list);
  const source = viewport?.querySelector<HTMLElement>(HOST.menuItem) ?? null;
  const wrapper = source?.parentElement ?? null;
  if (viewport === null || wrapper === null) return null;
  const clone = wrapper.cloneNode(true) as HTMLElement;
  const label = labelSeat(clone);
  const button = clone.querySelector<HTMLElement>(HOST.menuItem);
  if (label === null || button === null) return null;
  label.textContent = row.label;
  for (const artwork of [...clone.querySelectorAll('svg')]) artwork.remove();
  for (const seat of [...clone.querySelectorAll<HTMLElement>('span')]) {
    if (seat.children.length === 0 && (seat.textContent ?? '').trim() === '') seat.remove();
  }
  button.removeAttribute('disabled');
  clone.setAttribute(MENU_ROW_ATTRIBUTE, '');
  button.setAttribute(MENU_ROW_ATTRIBUTE, '');
  button.addEventListener('click', () => {
    /* The state that wanted the row is re-read rather than remembered: the
       panel can be shown by another path while this menu stays open. */
    if (row.wanted()) {
      try {
        row.act();
      } catch (error) {
        report(error);
      }
    }
    /* Closing stays the owner's decision, exactly as it is for a data row: its
       own handler toggles the state this trigger reports. */
    if (trigger.isConnected && trigger.getAttribute('aria-expanded') === 'true') trigger.click();
  });
  /* First row of the card: the primitive's walk (`button:not(:disabled)` in DOM
     order) and the reader's eye both start here, which is where the reference
     draws the panel's own action. */
  viewport.prepend(clone);
  return clone;
}

/**
 * Keep one row in the Session header's menu for as long as it is wanted.
 *
 * @param document - the renderer document whose header menu is extended.
 * @param row - the label, the predicate that decides whether the row exists,
 *   and the action it runs.
 * @param report - receives a failure from the action or from one observer pass.
 * @returns disposer that removes the row and stops the observer.
 */
export function mountSessionMenuRow(
  document: Document,
  row: SessionMenuRow,
  report: (error: unknown) => void,
): Disposer {
  /** The row this module added, with the list it was added to. */
  let injected: { list: HTMLElement; node: HTMLElement } | null = null;

  const withdraw = (): void => {
    injected?.node.remove();
    injected = null;
  };

  const sync = (): void => {
    const open = openSessionMenu(document);
    if (open === null || !row.wanted()) {
      withdraw();
      return;
    }
    /* A menu that is still the one this row was built for keeps it: rebuilding
       on every pass would drop the node the reader's pointer is about to use. */
    if (injected !== null && injected.list === open.list) return;
    withdraw();
    const node = insertRow(open.list, open.trigger, row, report);
    if (node !== null) injected = { list: open.list, node };
  };

  let observer: MutationObserver | undefined;
  try {
    /* The list appears and disappears with the menu and the trigger's
       `aria-expanded` is the host's own statement of which state it is in, so
       both halves of the row's lifetime ride one observer. */
    observer = new MutationObserver(() => {
      try {
        sync();
      } catch (error) {
        report(error);
      }
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded'],
    });
    sync();
  } catch (error) {
    observer?.disconnect();
    withdraw();
    report(error);
    return () => {};
  }

  return () => {
    observer?.disconnect();
    withdraw();
  };
}
