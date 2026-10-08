import type {
  ViewOptionsGroup, ViewOptionsGroupRead, ViewOptionsPort, ViewOptionsRead, ViewOptionsSnapshot, ViewOptionsSettingsPort,
} from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

/**
 * The sidebar's view-options menu, driven instead of replaced.
 *
 * DSH's card is a `ui-primitives` `Menu` holding three labelled option groups —
 * grouping mode, ordering, archived visibility — with the current option marked
 * by the primitive's trailing check. The three values live in the workspace
 * browser's own browser-local store, and nothing on the public face writes them:
 * `UiWorkspace` (`dsh-client-ui-workspace/client` `navigation.d.ts`) publishes
 * navigation, archive and directory operations only, and the store it keeps
 * (`stores.d.ts`) exports its factory alone, so a second instance would hold a
 * copy rather than the browser's state. The one handle that *does* write them is
 * the host's own row: `WorkspaceBrowser`'s `onSelect` calls `setOpen(false)`
 * after it applies the choice.
 *
 * So this module treats that card as the state API it effectively is. Opening
 * the card reads it — the host's own menu is opened through the trigger's click
 * with `DRIVING_ATTRIBUTE` keeping the sheet from drawing it — and choosing an
 * option clicks the host's own row. Nothing is shown, nothing is synthesised
 * beyond the clicks the host's control already answers, and the card the reader
 * sees is the one `features/view-options` draws.
 *
 * Three details decide how the drive is written:
 *
 * - **The trigger's click is intercepted.** The host opens its card from the
 *   trigger's `onClick`; a listener on the button that stops propagation keeps
 *   React's delegated handler from running, so the card opens only when this
 *   module drives it. The one flag `driving` is what lets our own clicks
 *   through.
 * - **React flushes a discrete event synchronously**, so the card is in the
 *   document by the time the driving click returns; `settle` still waits a
 *   microtask and then polls, because a build that mounts the card later must
 *   not turn into a failed read — the card is off screen either way.
 * - **A card that is not the pinned shape hands the click back.** `readCard`
 *   refuses anything that is not three groups of at least two rows with exactly
 *   one check each, and the click that opened it is then passed to DSH so its
 *   own menu opens. A later build keeps its own interface instead of a card
 *   with nothing in it.
 */

/** Marks the host popup this module is driving; the sheet keeps it off screen. */
export const DRIVING_ATTRIBUTE = 'data-ccd-view-options-driving';

/** Marks the trigger while this plugin's card is the one on screen. */
export const OPEN_ATTRIBUTE = 'data-ccd-view-options-open';

/** One open host card, and whether this module opened it. */
interface Driven {
  readonly list: HTMLElement;
  readonly opened: boolean;
}

/** The scrolling row group inside one host card, or null when it is not there. */
function viewportOf(list: HTMLElement): HTMLElement | null {
  /* `Menu` renders `<span class=root>{anchor}{list}</span>`, and the list's first
     `role="presentation"` child is the scrolling viewport the rows live in. */
  for (const child of list.children) {
    if (child.getAttribute('role') === 'presentation') return child as HTMLElement;
  }
  return null;
}

/** One row's own label, as the host localised it. */
function labelOf(document: Document, row: HTMLElement): string {
  const host = hostSelectors(document);
  const seat = row.querySelector<HTMLElement>(host.menuItemLabel);
  return (seat?.textContent ?? row.textContent ?? '').trim();
}

/** The check the primitive draws on the selected row. */
function isChecked(document: Document, row: HTMLElement): boolean {
  return row.querySelector(hostSelectors(document).menuItemCheck) !== null;
}

/**
 * The host card's three groups, read the way the primitive drew them.
 *
 * A heading (`role="presentation"`) opens a group and the rows after it belong
 * to it. The shape is refused whole — not three groups, a group with fewer than
 * two rows, or a group without exactly one check — so a later build keeps its
 * own card instead of being read as something it is not.
 */
function readCard(
  document: Document,
  list: HTMLElement,
): { groups: readonly ViewOptionsGroupRead[]; rows: readonly (readonly HTMLElement[])[] } | null {
  const host = hostSelectors(document);
  const viewport = viewportOf(list);
  if (viewport === null) return null;
  const groups: { label: string; rows: HTMLElement[] }[] = [];
  for (const child of viewport.children) {
    const element = child as HTMLElement;
    if (element.getAttribute('role') === 'presentation') {
      groups.push({ label: (element.textContent ?? '').trim(), rows: [] });
      continue;
    }
    const row = element.matches(host.menuItem)
      ? element
      : element.querySelector<HTMLElement>(host.menuItem);
    if (row === null) continue;
    /* A row above the first heading is not this card's shape. */
    if (groups.length === 0) return null;
    groups[groups.length - 1]!.rows.push(row);
  }
  if (groups.length !== 3) return null;
  for (const group of groups) {
    if (group.rows.length < 2) return null;
    if (group.rows.filter(row => isChecked(document, row)).length !== 1) return null;
  }
  return {
    groups: groups.map(group => ({
      label: group.label,
      labels: group.rows.map(row => labelOf(document, row)),
      selected: group.rows.findIndex(row => isChecked(document, row)),
    })),
    rows: groups.map(group => group.rows),
  };
}

/** The driver's own face, plus the release the mounting scope holds. */
export interface ViewOptionsDriver {
  readonly port: ViewOptionsPort;
  readonly settings: ViewOptionsSettingsPort;
  /** Read persisted native preferences without showing either menu. */
  inspect(): Promise<void>;
  dispose(): void;
}

/**
 * Watch the sidebar's view-options trigger and drive the host's card for it.
 * @param document - renderer document carrying the sidebar and the portal.
 * @param report - sink for observer failures; the native menu stays in charge.
 * @returns the port the card reads through, and the release of every observer.
 */
export function createViewOptionsDriver(
  document: Document,
  report: (error: unknown) => void,
): ViewOptionsDriver {
  const host = hostSelectors(document);
  let trigger: HTMLElement | null = null;
  let attached: HTMLElement | null = null;
  let open = false;
  let values: ViewOptionsRead | null = null;
  let snapshot: ViewOptionsSnapshot = { open: false, anchor: null, values: null };
  let listener: (() => void) | null = null;
  let scheduled = 0;
  let driving = false;
  let tree: MutationObserver | undefined;
  let attributes: MutationObserver | undefined;
  let preferences: ViewOptionsRead | null = null;
  const preferenceListeners = new Set<() => void>();
  let reading: Promise<ViewOptionsRead | null> | null = null;
  let disposed = false;
  let inspectWhenAttached = false;

  const publishPreferences = (next: ViewOptionsRead) => {
    if (disposed || JSON.stringify(next) === JSON.stringify(preferences)) return;
    preferences = next;
    for (const notify of preferenceListeners) notify();
  };

  /** The host's open card, if one is in the document. */
  const card = (): HTMLElement | null => document.querySelector<HTMLElement>(host.viewOptionsMenu);

  /** Reflect this plugin's own state on the host's trigger. */
  const mark = () => {
    const node = trigger;
    if (node === null) return;
    if (open) {
      if (!node.hasAttribute(OPEN_ATTRIBUTE)) node.setAttribute(OPEN_ATTRIBUTE, '');
      if (node.getAttribute('aria-haspopup') !== 'menu') node.setAttribute('aria-haspopup', 'menu');
    } else {
      node.removeAttribute(OPEN_ATTRIBUTE);
      node.removeAttribute('aria-haspopup');
    }
    // setAttribute notifies observers even when the value is unchanged. This
    // attribute is itself observed, so repeated writes starve the event loop
    // during startup, before the reader can open any menu.
    const expanded = open ? 'true' : 'false';
    if (node.getAttribute('aria-expanded') !== expanded) node.setAttribute('aria-expanded', expanded);
  };

  /**
   * Rebuild the published snapshot and wake the card.
   *
   * `useSyncExternalStore` compares snapshots by identity, so the object is
   * replaced here — on every state change — and nowhere else.
   */
  const refresh = () => {
    snapshot = { open, anchor: trigger, values };
    if (card() === null) mark();
    listener?.();
  };

  /** Wait for the driven card to reach the document. */
  const settle = async (): Promise<void> => {
    await Promise.resolve();
    for (let attempt = 0; attempt < 20 && card() === null; attempt += 1) {
      await new Promise<void>(resolve => { setTimeout(resolve, 10); });
    }
  };

  /** Open the host's card with the sheet keeping it off screen. */
  const drive = async (): Promise<Driven | null> => {
    const node = trigger;
    if (node === null) return null;
    const opened = card() === null;
    document.documentElement.setAttribute(DRIVING_ATTRIBUTE, '');
    if (opened) {
      driving = true;
      try {
        node.click();
      } finally {
        driving = false;
      }
      await settle();
    }
    const list = card();
    if (list === null) {
      document.documentElement.removeAttribute(DRIVING_ATTRIBUTE);
      return null;
    }
    return { list, opened };
  };

  /** Close a card this module opened, and lift the off-screen marker. */
  const settleClosed = async () => {
    for (let attempt = 0; attempt < 20 && card() !== null; attempt += 1) {
      await new Promise<void>(resolve => { setTimeout(resolve, 10); });
    }
  };

  const endDrive = async (driven: Driven) => {
    if (driven.opened && trigger !== null && card() !== null) {
      driving = true;
      try {
        trigger.click();
      } finally {
        driving = false;
      }
      await settleClosed();
    }
    document.documentElement.removeAttribute(DRIVING_ATTRIBUTE);
  };

  /** Read the host's three groups out of its own card. */
  const readHostOnce = async (): Promise<ViewOptionsRead | null> => {
    const driven = await drive();
    if (driven === null) return null;
    try {
      const card = readCard(document, driven.list);
      return card === null ? null : { groups: card.groups };
    } finally {
      await endDrive(driven);
    }
  };

  const readHost = (): Promise<ViewOptionsRead | null> => {
    if (reading !== null) return reading;
    reading = readHostOnce().then(next => {
      if (next !== null) publishPreferences(next);
      return next;
    }).finally(() => { reading = null; });
    return reading;
  };

  const inspect = async () => {
    inspectWhenAttached = true;
    if (trigger === null || disposed) return;
    const focus = document.activeElement;
    await readHost();
    // A native menu can autofocus while it is being read. Startup inspection
    // must return focus to the page rather than leaving it on a hidden item.
    if (!open && typeof HTMLElement !== 'undefined' && focus instanceof HTMLElement && focus.isConnected) focus.focus();
    mark();
  };

  /**
   * Open this plugin's card: read the host's values first, and hand the click
   * back to DSH when the host's card is not the shape this plugin knows.
   */
  const openWithValues = async () => {
    const read = await readHost();
    if (read === null) {
      driving = true;
      try {
        trigger?.click();
      } finally {
        driving = false;
      }
      return;
    }
    values = read;
    open = true;
    refresh();
  };

  const onClick = (event: MouseEvent) => {
    if (driving) return;
    /* React delegates at the root, so stopping the bubble here keeps the host's
       own `setOpen(v => !v)` from running: the card below is ours, not theirs. */
    event.stopPropagation();
    if (open) {
      open = false;
      values = null;
      refresh();
      return;
    }
    void openWithValues();
  };

  const sync = () => {
    scheduled = 0;
    const found = document.querySelector<HTMLElement>(host.viewOptionsTrigger);
    if (found === attached) {
      if (card() === null) mark();
      return;
    }
    attributes?.disconnect();
    attributes = undefined;
    attached?.removeEventListener('click', onClick);
    attached = found;
    trigger = found;
    if (found !== null) {
      found.addEventListener('click', onClick);
      /* The host's own primitive writes `aria-expanded` on the anchor while it
         opens the card we drive; this module owns the state the reader sees, so
         the attribute is put back once the card is out of the way. */
      attributes = new MutationObserver(schedule);
      attributes.observe(found, { attributes: true, attributeFilter: ['aria-expanded'] });
    }
    open = false;
    values = null;
    refresh();
    if (found !== null && inspectWhenAttached) {
      void Promise.resolve().then(inspect).catch(report);
    }
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

  try {
    tree = new MutationObserver(schedule);
    tree.observe(document.body, { childList: true, subtree: true });
    sync();
  } catch (error) {
    tree?.disconnect();
    attributes?.disconnect();
    report(error);
  }

  const port: ViewOptionsPort = {
    getSnapshot: () => snapshot,
    subscribe(next) {
      listener = next;
      return () => { if (listener === next) listener = null; };
    },
    close() {
      open = false;
      values = null;
      /* A drive that left the host's own card open is put away with it. */
      if (card() !== null && trigger !== null) {
        driving = true;
        try {
          trigger.click();
        } finally {
          driving = false;
        }
      }
      document.documentElement.removeAttribute(DRIVING_ATTRIBUTE);
      refresh();
    },
    async choose(group: ViewOptionsGroup, index: number): Promise<boolean> {
      await reading;
      const driven = await drive();
      if (driven === null) return false;
      try {
        const card = readCard(document, driven.list);
        const row = card?.rows[group]?.[index];
        if (row === undefined) return false;
        /* The host applies the choice and closes its own card in the same
           handler, so `endDrive` finds nothing left to close. */
        row.click();
        // Programmatic clicks are batched by React. Until that commit lands,
        // the old menu DOM still exists even though onSelect already closed it.
        // Toggling its trigger during that interval reopens the native menu.
        await settleClosed();
        publishPreferences({ groups: card!.groups.map((value, position) =>
          position === group ? { ...value, selected: index } : value) });
        return true;
      } finally {
        await endDrive(driven);
      }
    },
  };

  return {
    port,
    settings: {
      getSnapshot: () => preferences,
      subscribe(notify) {
        preferenceListeners.add(notify);
        return () => { preferenceListeners.delete(notify); };
      },
    },
    inspect,
    dispose() {
      disposed = true;
      preferenceListeners.clear();
      scheduled = 0;
      tree?.disconnect();
      attributes?.disconnect();
      attached?.removeEventListener('click', onClick);
      /* The trigger is handed back as the host drew it: the open marker and the
         two ARIA attributes are this module's own, and a released plugin must
         not leave a lit control behind. */
      attached?.removeAttribute(OPEN_ATTRIBUTE);
      attached?.removeAttribute('aria-haspopup');
      attached?.removeAttribute('aria-expanded');
      document.documentElement.removeAttribute(DRIVING_ATTRIBUTE);
      listener = null;
      trigger = null;
      attached = null;
      open = false;
      values = null;
    },
  };
}
