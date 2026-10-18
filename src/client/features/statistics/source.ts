/**
 * The card's data source: one host route, polled on a scope-owned timer.
 *
 * The host serves `/api/ccd-stats` on its authenticated channel, so the read
 * is an ordinary same-origin fetch — the session cookie the page already holds
 * is what authorizes it, and the host applies its own trust fence before the
 * handler runs. Nothing here holds a socket or a second copy of the data.
 *
 * The poll cadence follows the host's progress counters: while cold sessions
 * are still being folded (`pending > 0`) the card is genuinely incomplete, so
 * it refreshes every couple of seconds; once the snapshot is complete it drops
 * to a slow poll. A missing route (the host half is off) hides the card rather
 * than failing the mount. Hidden documents pause reads and resume immediately
 * when visible, keeping background windows from repeatedly aggregating history.
 */
import { STATS_PATH, readStatsSnapshot, type StatsSnapshot } from '../../../shared/stats.ts';
import type { Logger } from '../../contracts/ports.ts';

/** Poll interval while the host still has sessions to fold. */
const ACTIVE_INTERVAL_MS = 2_000;

/** Poll interval once the snapshot is complete. */
const IDLE_INTERVAL_MS = 30_000;

/** Retry interval after a failure the card cannot fix by waiting. */
const RETRY_INTERVAL_MS = 30_000;

/** Poll interval while the host folds the first snapshot the card can draw. */
const WAITING_INTERVAL_MS = 600;

/** One snapshot reader the card subscribes to. */
export interface StatsSource {
  /** The last accepted snapshot, or null while there is none. */
  readonly current: StatsSnapshot | null;
  /** Observe snapshots; returns the unsubscribe function. */
  subscribe(listener: (snapshot: StatsSnapshot | null) => void): () => void;
  /** Stop polling and abort any read in flight. */
  dispose(): void;
}

/**
 * Whether a snapshot is worth showing.
 *
 * The host answers its very first request in milliseconds, with the session
 * count already known but every cold log still queued for folding. Painting
 * that would flash a card of zeros, so a snapshot whose folding has not
 * finished *and* which knows of no work yet counts as "no data" — the next
 * poll (2 s later, because `pending > 0`) carries the real numbers. A
 * genuinely empty corpus reports `pending === 0` and is shown as zeros.
 *
 * @param snapshot - the parsed host snapshot.
 * @returns true when the card should draw it.
 */
function isUsable(snapshot: StatsSnapshot): boolean {
  if (snapshot.pending === 0) return true;
  const totals = snapshot.ranges.all;
  return totals.sessions > 0 || totals.messages > 0 || totals.tokens > 0;
}

/**
 * Start polling the host's statistics route.
 *
 * @param options - logger and an optional route override (tests).
 * @returns the live source.
 */
export function createStatsSource(options: { logger: Logger; url?: string }): StatsSource {
  const url = options.url ?? STATS_PATH;
  const page = globalThis.document;
  const listeners = new Set<(snapshot: StatsSnapshot | null) => void>();
  let snapshot: StatsSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let disposed = false;
  let reported = false;

  const publish = (next: StatsSnapshot | null) => {
    if (disposed) return;
    snapshot = next;
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch (error) {
        options.logger.error('statistics: subscriber failed', error);
      }
    }
  };

  const schedule = (delay: number) => {
    if (disposed || page?.hidden) return;
    timer = setTimeout(() => { timer = undefined; void poll(); }, delay);
  };

  const poll = async () => {
    if (disposed || page?.hidden || controller !== undefined) return;
    const read = new AbortController();
    controller = read;
    let delay = IDLE_INTERVAL_MS;
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        signal: read.signal,
      });
      if (disposed || controller !== read) return;
      if (!response.ok) {
        /* The route is absent (host half off) or the session is not
           authorized: there is nothing to show, so the card stays hidden. */
        if (!reported) {
          reported = true;
          options.logger.debug(`statistics: ${url} answered ${String(response.status)}`);
        }
        publish(null);
        delay = RETRY_INTERVAL_MS;
      } else {
        const body: unknown = await response.json();
        if (disposed || controller !== read) return;
        const parsed = readStatsSnapshot(body);
        if (parsed === null) {
          if (!reported) {
            reported = true;
            options.logger.error('statistics: host snapshot is not readable', body);
          }
          publish(null);
          delay = RETRY_INTERVAL_MS;
        } else {
          reported = false;
          const usable = isUsable(parsed);
          publish(usable ? parsed : null);
          /* Nothing folded yet: look again quickly rather than showing zeros. */
          delay = !usable ? WAITING_INTERVAL_MS : parsed.pending > 0 ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;
        }
      }
    } catch (error) {
      if (disposed || controller !== read || read.signal.aborted) return;
      /* A transport failure is transient: keep the last snapshot on screen and
         try again, rather than blinking the card away. */
      options.logger.debug(`statistics: snapshot read failed (${String(error)})`);
      delay = RETRY_INTERVAL_MS;
    } finally {
      // A cancelled read may settle after visibility has started a new one.
      // Only its current owner can clear the controller and arm the next poll.
      if (controller === read) {
        controller = undefined;
        schedule(delay);
      }
    }
  };

  const pause = () => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    const pending = controller;
    controller = undefined;
    pending?.abort();
  };
  const visibility = () => {
    if (page.hidden) pause();
    else {
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      void poll();
    }
  };
  page?.addEventListener('visibilitychange', visibility);
  void poll();

  return {
    get current() {
      return snapshot;
    },
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      page?.removeEventListener('visibilitychange', visibility);
      listeners.clear();
      pause();
    },
  };
}
