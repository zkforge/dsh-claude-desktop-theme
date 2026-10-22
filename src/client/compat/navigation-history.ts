import type { Disposer } from '../contracts/ports.ts';

export type NavigationTarget = { kind: 'session' | 'panel'; id: string };

export interface NavigationHistoryPort {
  current(): NavigationTarget | null;
  available(target: NavigationTarget): boolean;
  open(target: NavigationTarget): void;
  subscribe(listener: () => void): Disposer;
}

const same = (a: NavigationTarget | undefined | null, b: NavigationTarget | null) =>
  a?.kind === b?.kind && a?.id === b?.id;

/** Window-local visits, independent of browser history and the host's MRU list. */
export function createNavigationHistory(port: NavigationHistoryPort, changed: () => void, report: (error: unknown) => void) {
  let entries: (NavigationTarget | null)[] = [];
  let cursor = -1;
  let last: NavigationTarget | null = null;
  let disposed = false;
  let queued = false;

  const sync = () => {
    const selected = port.current();
    const current = selected && port.available(selected) ? selected : null;
    // Count surviving entries before the cursor so deletion cannot move the
    // cursor onto an unrelated visit (including repeated visits to a session).
    let position = -1;
    entries = entries.filter((entry, index) => {
      const keep = entry === null || port.available(entry);
      if (keep && index <= cursor) position += 1;
      return keep;
    });
    cursor = position;
    if (!same(current, last) || entries.length === 0) {
      if (!same(entries[cursor], current)) {
        entries.splice(cursor + 1);
        entries.push(current);
        if (entries.length > 100) entries.shift();
        cursor = entries.length - 1;
      }
    }
    last = current;
    changed();
  };
  const schedule = () => {
    if (queued || disposed) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (!disposed) sync();
    });
  };
  const off = port.subscribe(schedule);
  sync();
  const destination = (direction: -1 | 1) => {
    let index = cursor + direction;
    while (index >= 0 && index < entries.length && entries[index] === null) index += direction;
    return index;
  };
  return {
    canGo(direction: -1 | 1) {
      return !disposed && entries[destination(direction)] != null;
    },
    go(direction: -1 | 1) {
      if (disposed) return;
      // Flush a host navigation that happened earlier in the same turn.
      sync();
      const index = destination(direction);
      const target = entries[index];
      if (!target) return;
      const previous = cursor;
      cursor = index;
      try {
        port.open(target);
        // openSession/selectPanel commit synchronously; subscriptions may fire
        // several times while old/new mainView references are exchanged.
        last = port.current();
        if (!same(last, target)) cursor = previous;
      } catch (error) {
        cursor = previous;
        // A global panel may have been unregistered since its visit.
        entries.splice(index, 1);
        if (index <= cursor) cursor -= 1;
        report(error);
      }
      sync();
    },
    dispose() { disposed = true; off(); entries = []; },
  };
}
