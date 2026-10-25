import type { Disposer } from '../../contracts/ports.ts';
import type { HiddenPanels } from '../../compat/sidebar-editor.ts';

/** Where the hidden panel ids live: a layout preference of this window's profile. */
export const HIDDEN_PANELS_KEY = 'ccd-sidebar-hidden';

export interface HiddenPanelStore extends HiddenPanels {
  /** The current set; replaced, never mutated, so it is a stable snapshot. */
  ids(): ReadonlySet<string>;
  set(id: string, hidden: boolean): void;
}

type PanelStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * The panels the Edit sidebar dialog keeps out of the column.
 *
 * Kept in `localStorage` beside `ccd-status-collapsed`: it is how this window
 * lays its sidebar out, not configuration the Host serves. A storage that
 * throws or holds something unreadable reads as "nothing hidden", so a broken
 * entry can never take a row away for good. Ids of panels that are not
 * registered right now stay in the set, so a plugin that loads late or is
 * reinstalled comes back the way it was left.
 * @param storage - the window's storage, or undefined where it is unavailable.
 */
export function createHiddenPanels(storage: PanelStorage | undefined): HiddenPanelStore {
  const read = (): ReadonlySet<string> => {
    try {
      const value: unknown = JSON.parse(storage?.getItem(HIDDEN_PANELS_KEY) ?? '[]');
      return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
    } catch {
      return new Set();
    }
  };
  let ids = read();
  const listeners = new Set<() => void>();
  return {
    has: id => ids.has(id),
    ids: () => ids,
    set(id, hidden) {
      if (ids.has(id) === hidden) return;
      const next = new Set(ids);
      if (hidden) next.add(id);
      else next.delete(id);
      ids = next;
      try {
        if (next.size === 0) storage?.removeItem(HIDDEN_PANELS_KEY);
        else storage?.setItem(HIDDEN_PANELS_KEY, JSON.stringify([...next]));
      } catch { /* The column still follows the choice for this mount. */ }
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** Whether the Edit sidebar dialog is open; the More card's row opens it. */
export interface EditorState {
  isOpen(): boolean;
  subscribe(listener: () => void): Disposer;
  open(): void;
  close(): void;
}

export function createEditorState(): EditorState {
  let open = false;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (open === next) return;
    open = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    isOpen: () => open,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    open: () => set(true),
    close: () => set(false),
  };
}
