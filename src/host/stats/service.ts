/**
 * Read live session projections first, then durable checkpoints, then cold-fold
 * missing checkpoints in the background. Failed sessions retry after cooldown.
 * Aggregates are served through the host's authenticated connection.fetch route.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Session, SessionHeader } from '@deepseek-ai/dsh-session';
import type { SessionPersistence, SessionHandle } from '@deepseek-ai/dsh-session-persistence';
import type { SessionProjectionRegistry, ProjectionSnapshot } from '@deepseek-ai/dsh-session-projection';
import type { SessionQueryEngine, SessionRecord } from '@deepseek-ai/dsh-session-query';
import { STATS_PATH, localDayKey, sameStatsUsage, type StatsSessionUsage, type StatsSnapshot } from '../../shared/stats.ts';
import { PLUGIN_ID } from '../../shared/identity.ts';
import { aggregateUsage } from './aggregate.ts';
import { USAGE_KEY, usageProjection } from './unit.ts';

/** Sessions folded at once; cold logs decompress on the host's thread pool. */
const FOLD_CONCURRENCY = 4;

/** How long a failed fold stays out of the queue, ms. */
const RETRY_COOLDOWN_MS = 60_000;

/** The durable checkpoint face of `@deepseek-ai/dsh-session-projection-cache` (not in our type baseline). */
interface ProjectionCache {
  /** Whole values viewed from the stored rows, or undefined without a usable record. */
  cachedSnapshot(meta: SessionHeader, keys?: readonly string[]): ProjectionSnapshot | undefined;
  /** Fold a complete log, refreshing the stored checkpoint. */
  coldSnapshot(meta: SessionHeader, inheritedEventCount: number, events: readonly unknown[]): ProjectionSnapshot;
}

/** The authenticated exact-route registry of `@deepseek-ai/dsh-client-connection` (not in our type baseline). */
interface AuthRouteRegistry {
  register(route: {
    readonly path: string;
    readonly methods: readonly string[];
    readonly requestBody: 'buffered' | 'streaming';
    readonly fetch: (request: Request) => Promise<Response>;
  }): () => Promise<void>;
}

/** Sink for contained failures; the card never fails loudly. */
type Warn = (message: string, error?: unknown) => void;

/** One stored session the aggregate wants a value for. */
interface Candidate {
  readonly header: SessionHeader;
  readonly live: boolean;
}

/**
 * Cross-session state: the current per-session values plus the progress
 * counters the card uses to decide how fast to poll.
 */
class UsageAggregator {
  private readonly ctx: Context;
  private readonly warn: Warn;
  private readonly values = new Map<string, StatsSessionUsage>();
  private readonly queued = new Map<string, Candidate>();
  private readonly folding = new Set<string>();
  private readonly failures = new Map<string, number>();
  private running = 0;
  private refreshRun: Promise<StatsSnapshot> | null = null;
  private snapshot: StatsSnapshot | null = null;
  private dirty = true;
  private snapshotDay: string | null = null;
  private listed = new Set<string>();
  private disposed = false;

  constructor(ctx: Context, warn: Warn) {
    this.ctx = ctx;
    this.warn = warn;
  }

  /** The most recent snapshot; an empty one before the first refresh. */
  get current(): StatsSnapshot {
    const now = Date.now(), day = localDayKey(now);
    const pending = this.queued.size + this.running, missed = this.failures.size;
    if (this.snapshot === null || this.dirty || this.snapshotDay !== day) {
      this.snapshot = aggregateUsage(this.values.values(), {
        now, pending, missed,
      });
      this.snapshotDay = day;
      this.dirty = false;
    } else if (this.snapshot.pending !== pending || this.snapshot.missed !== missed) {
      // Fold progress alone does not require collecting and sorting all usage.
      this.snapshot = { ...this.snapshot, pending, missed, computedAt: now };
    }
    return this.snapshot;
  }

  /**
   * Bring the snapshot up to date.
   *
   * The listing pass is cheap (projection reads only) and serialized, so
   * several polling browsers share one pass; cold folds continue in the
   * background and land in later snapshots.
   *
   * @returns the snapshot as of this pass.
   */
  refresh(): Promise<StatsSnapshot> {
    if (this.disposed) return Promise.resolve(this.current);
    const running = this.refreshRun;
    if (running !== null) return running;
    const run = this.pass().finally(() => {
      if (this.refreshRun === run) this.refreshRun = null;
    });
    this.refreshRun = run;
    return run;
  }

  /** Stop folding; in-flight reads settle but no longer publish. */
  dispose(): void {
    this.disposed = true;
    this.queued.clear();
    this.values.clear();
    this.failures.clear();
    this.listed.clear();
    this.snapshot = null;
  }

  private async pass(): Promise<StatsSnapshot> {
    try {
      const candidates = await this.list();
      if (this.disposed) return this.current;
      /* A session that left the listing left the library: drop its numbers (and
         its failure mark) so the totals describe what is actually stored. A
         session that merely failed this pass keeps its last value. */
      const listed = new Set<string>(candidates.map(candidate => candidate.header.id));
      this.listed = listed;
      for (const id of [...this.values.keys()]) if (!listed.has(id)) {
        this.values.delete(id);
        this.invalidate();
      }
      for (const id of [...this.failures.keys()]) if (!listed.has(id)) this.failures.delete(id);
      for (const id of this.queued.keys()) if (!listed.has(id)) this.queued.delete(id);
      for (const candidate of candidates) {
        if (this.disposed) break;
        const value = this.readSafely(candidate);
        if (value === undefined) this.enqueue(candidate);
        else {
          this.queued.delete(candidate.header.id);
          this.store(candidate.header.id, value);
          this.failures.delete(candidate.header.id);
        }
      }
    } catch (error) {
      this.warn('session listing failed; the card keeps the last snapshot', error);
    }
    return this.current;
  }

  private store(id: string, value: StatsSessionUsage): void {
    if (sameStatsUsage(this.values.get(id), value)) return;
    this.values.set(id, value);
    this.invalidate();
  }

  /** Every stored session the card counts, newest first. */
  private async list(): Promise<readonly Candidate[]> {
    const query = this.ctx.get('sessionQuery') as SessionQueryEngine | undefined;
    if (query !== undefined) {
      const records: readonly SessionRecord[] = await query.listSessions();
      return records
        .filter(record => record.header.cwd !== undefined)
        .map(record => ({ header: record.header, live: record.live }));
    }
    const persistence = this.ctx.get('sessionPersistence') as SessionPersistence | undefined;
    if (persistence === undefined) return [];
    const snapshots = await persistence.list();
    return snapshots
      .filter(snapshot => snapshot.header.cwd !== undefined)
      .map(snapshot => ({ header: snapshot.header, live: false }));
  }

  /**
   * Read one session's value without letting a single failure drop the pass.
   *
   * A live session's projection read can throw (a host-side projection bug, a
   * log the registry cannot advance across); that must cost this session's
   * numbers, not every session's.
   */
  private readSafely(candidate: Candidate): StatsSessionUsage | undefined {
    try {
      return this.read(candidate);
    } catch (error) {
      this.warn(`projection read failed for session ${candidate.header.id}`, error);
      return undefined;
    }
  }

  /** Zero-I/O read: the live registry for a live session, the durable cache for a cold one. */
  private read(candidate: Candidate): StatsSessionUsage | undefined {
    const projections = this.ctx.get('sessionProjections') as SessionProjectionRegistry | undefined;
    if (projections === undefined) return undefined;
    if (candidate.live) {
      const session = (this.ctx.get('sessions') as { get(id: string): Session | undefined } | undefined)
        ?.get(candidate.header.id);
      if (session !== undefined) {
        return projections.snapshot(session, [USAGE_KEY]).values[USAGE_KEY];
      }
    }
    const cache = this.ctx.get('sessionProjectionCache') as ProjectionCache | undefined;
    return cache?.cachedSnapshot(candidate.header, [USAGE_KEY])?.values[USAGE_KEY];
  }

  /** Queue one cold fold unless it is already queued, running, or cooling down. */
  private enqueue(candidate: Candidate): void {
    const id = candidate.header.id;
    if (this.disposed || this.folding.has(id) || this.queued.has(id)) return;
    const failedAt = this.failures.get(id);
    if (failedAt !== undefined && Date.now() - failedAt < RETRY_COOLDOWN_MS) return;
    this.queued.set(id, candidate);
    this.pump();
  }

  /** Keep at most {@link FOLD_CONCURRENCY} folds in flight. */
  private pump(): void {
    while (!this.disposed && this.running < FOLD_CONCURRENCY) {
      const candidate = this.queued.values().next().value;
      if (candidate === undefined) return;
      const id = candidate.header.id;
      this.queued.delete(id);
      this.folding.add(id);
      this.running += 1;
      void this.fold(candidate).finally(() => {
        this.folding.delete(id);
        this.running -= 1;
        this.pump();
      });
    }
  }

  /** Fold one cold session once, refreshing its durable checkpoint. */
  private async fold(candidate: Candidate): Promise<void> {
    const persistence = this.ctx.get('sessionPersistence') as SessionPersistence | undefined;
    const cache = this.ctx.get('sessionProjectionCache') as ProjectionCache | undefined;
    if (persistence === undefined || cache === undefined) return;
    let handle: SessionHandle | undefined;
    try {
      handle = await persistence.open(candidate.header.id, 'read');
      if (this.disposed || !this.listed.has(candidate.header.id)) return;
      const { events } = await handle.read(0);
      if (this.disposed || !this.listed.has(candidate.header.id)) return;
      const block = cache.coldSnapshot(handle.header, handle.inheritedEventCount, events);
      const value = block.values[USAGE_KEY];
      if (this.disposed) return;
      if (value === undefined) {
        this.failures.set(candidate.header.id, Date.now());
        return;
      }
      this.store(candidate.header.id, value);
      this.failures.delete(candidate.header.id);
    } catch (error) {
      if (this.disposed || !this.listed.has(candidate.header.id)) return;
      this.failures.set(candidate.header.id, Date.now());
      this.warn(`fold failed for session ${candidate.header.id}`, error);
    } finally {
      if (handle !== undefined) {
        try {
          await handle.close();
        } catch {
          /* a read handle that fails to close frees itself with the backend */
        }
      }
    }
  }

  /** Fold completions invalidate totals; only a route read pays for aggregation. */
  private invalidate(): void {
    if (this.disposed) return;
    this.dirty = true;
  }
}

/**
 * Mount the aggregation and its route, once the host services it needs exist.
 *
 * A plugin's `apply` runs as soon as its own fiber starts, which can be before
 * the session projection registry and the connection carrier: the optional
 * injection below waits for both, and a deployment that mounts neither simply
 * never gets the card.
 *
 * @param ctx - host plugin context.
 * @param isEnabled - current plugin switch, read at mount time.
 */
export function mountStatistics(ctx: Context, isEnabled: () => boolean): void {
  ctx.inject(['sessionProjections', 'connection'], injected => {
    if (!isEnabled()) return;
    const projections = injected.get('sessionProjections') as SessionProjectionRegistry | undefined;
    const routes = injected.get('connection') as { fetch: AuthRouteRegistry } | undefined;
    if (projections === undefined || routes === undefined) return;

    const warn: Warn = (message, error) => {
      try {
        console.warn(`[${PLUGIN_ID}] statistics: ${message}`, error);
      } catch {
        /* logging must never throw */
      }
    };

    /* The registration is an effect on this fiber: unloading the plugin
       removes the key and its cells again. */
    projections.register(usageProjection);
    const aggregator = new UsageAggregator(injected, warn);

    ctx.effect(() => routes.fetch.register({
      path: STATS_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async () => {
        const snapshot = await aggregator.refresh();
        return new Response(JSON.stringify(snapshot), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          },
        });
      },
    }), 'statistics: snapshot route');

    ctx.effect(() => () => aggregator.dispose(), 'statistics: aggregation');
  });
}
