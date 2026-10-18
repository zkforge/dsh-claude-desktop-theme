import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import type { StatsSessionUsage, StatsSnapshot } from '../src/shared/stats.ts';
import { mountStatistics } from '../src/host/stats/service.ts';
import { USAGE_KEY } from '../src/host/stats/unit.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

/** Exercise the registered route with controlled persistence reads, without a host. */
function fixture(count: number) {
  let ids = Array.from({ length: count }, (_, index) => String(index));
  const reads = new Map(ids.map(id => [id, deferred<{ events: unknown[] }>()]));
  const cached = new Map<string, StatsSessionUsage>();
  const opened: string[] = [], closed: string[] = [], folded: string[] = [], read: string[] = [];
  let aggregateReads = 0;
  let listing: Promise<void> | undefined;
  let fetchRoute!: (request: Request) => Promise<Response>;
  const cleanups: (() => unknown)[] = [];
  const usage = (): StatsSessionUsage => ({
    get prompts() { aggregateReads++; return 1; },
    tokens: 10, days: [['2026-10-18', 1]], hours: [[12, 1]],
    models: [['provider/model', 10, 7, 3]], modelDays: [['2026-10-18', 0, 10]],
  });
  const services: Record<string, unknown> = {
    sessionProjections: { register() {} },
    connection: { fetch: { register(route: { fetch: typeof fetchRoute }) {
      fetchRoute = route.fetch; return async () => {};
    } } },
    sessionQuery: { async listSessions() {
      await listing;
      return ids.map(id => ({ header: { id, cwd: '/project' }, live: false }));
    } },
    sessionProjectionCache: {
      cachedSnapshot(header: { id: string }) {
        const value = cached.get(header.id);
        return value === undefined ? undefined : { values: { [USAGE_KEY]: value } };
      },
      coldSnapshot(header: { id: string }) {
        folded.push(header.id);
        const value = usage(); cached.set(header.id, value);
        return { values: { [USAGE_KEY]: value } };
      },
    },
    sessionPersistence: { async open(id: string) {
      opened.push(id);
      return {
        header: { id }, inheritedEventCount: 0,
        read: () => { read.push(id); return reads.get(id)!.promise; },
        close: async () => { closed.push(id); },
      };
    } },
  };
  const ctx = {
    get: (key: string) => services[key],
    inject: (_keys: string[], callback: (context: unknown) => void) => callback(ctx),
    effect: (factory: () => () => unknown) => cleanups.push(factory()),
  };
  mountStatistics(ctx as unknown as Context, () => true);
  return {
    opened, closed, folded, read, cached,
    get aggregateReads() { return aggregateReads; },
    remove(id: string) { ids = ids.filter(candidate => candidate !== id); },
    cache(id: string) { cached.set(id, usage()); },
    blockListing(promise: Promise<void>) { listing = promise; },
    finish(id: string) { reads.get(id)!.resolve({ events: [] }); },
    async request(): Promise<StatsSnapshot> {
      return (await fetchRoute(new Request('http://localhost/api/ccd-stats'))).json();
    },
    dispose() { for (const cleanup of cleanups.reverse()) cleanup(); },
  };
}

test('cold fold completions aggregate only when requested and keep four reads in flight', async () => {
  const f = fixture(12);
  try {
    const initial = await f.request();
    assert.equal(initial.pending, 12);
    assert.equal(f.opened.length, 4);
    for (let index = 0; index < 12; index++) {
      assert.ok(f.opened.includes(String(index)), 'FIFO work starts as a read slot is freed');
      f.finish(String(index));
      await settle();
      assert.ok(f.opened.length - f.closed.length <= 4);
    }
    assert.equal(f.folded.length, 12);
    assert.equal(f.aggregateReads, 0, 'background completions do not walk all previous results');
    const complete = await f.request();
    assert.equal(complete.pending, 0);
    assert.equal(complete.ranges.all.sessions, 12);
    assert.equal(complete.ranges.all.tokens, 120);
    assert.ok(f.aggregateReads > 0);
    assert.equal(f.opened.length, 12, 'polling uses cached projections without re-reading logs');
  } finally { f.dispose(); }
});

test('repeated polls do not duplicate queued folds and remove work now cached or deleted', async () => {
  const f = fixture(8);
  try {
    await f.request(); await f.request();
    f.cache('4'); f.remove('5'); f.remove('0');
    const progress = await f.request();
    assert.equal(progress.pending, 6, 'four running and two still queued');
    for (const id of ['0', '1', '2', '3']) f.finish(id);
    await settle();
    assert.equal(f.folded.includes('0'), false, 'a deleted in-flight session is not folded or reintroduced');
    assert.deepEqual(f.opened, ['0', '1', '2', '3', '6', '7']);
    f.finish('6'); f.finish('7'); await settle();
    const complete = await f.request();
    assert.equal(complete.ranges.all.sessions, 6);
    assert.equal(complete.pending, 0);
    assert.equal(new Set(f.opened).size, f.opened.length);
  } finally { f.dispose(); }
});

test('unloading during a read closes handles without folding or starting queued work', async () => {
  const f = fixture(10);
  await f.request();
  f.dispose();
  for (const id of ['0', '1', '2', '3']) f.finish(id);
  await settle();
  assert.equal(f.opened.length, 4);
  assert.equal(f.closed.length, 4);
  assert.equal(f.folded.length, 0);
});

test('unloading while a session listing is pending does not start persistence work', async () => {
  const f = fixture(10);
  const gate = deferred<void>();
  f.blockListing(gate.promise);
  const request = f.request();
  f.dispose(); gate.resolve();
  await request;
  assert.deepEqual(f.opened, []);
});
