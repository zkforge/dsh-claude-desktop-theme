import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createStatsSource } from '../src/client/features/statistics/source.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const body = (computedAt: number) => ({ version: 2, computedAt, pending: 0, missed: 0, busyHour: null });
const response = (computedAt: number) => new Response(JSON.stringify(body(computedAt)));

/** Fake transport and clock: no sleeps, network or renderer needed. */
function fixture(t: TestContext, hidden = false, active = true) {
  const listeners = new Set<() => void>();
  const page = {
    hidden,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  const timers = new Map<number, { task: () => void; delay: number }>();
  let timerId = 0;
  const requests: { result: ReturnType<typeof deferred<Response>>; signal: AbortSignal }[] = [];
  const messages: unknown[] = [];
  const globals = {
    document: page,
    fetch: (_url: unknown, init: RequestInit) => {
      const result = deferred<Response>();
      requests.push({ result, signal: init.signal! });
      return result.promise;
    },
    setTimeout: (task: () => void, delay: number) => { const id = ++timerId; timers.set(id, { task, delay }); return id; },
    clearTimeout: (id: number) => { timers.delete(id); },
  };
  const descriptors = Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const source = createStatsSource({ active, logger: { debug: message => messages.push(message), error: message => messages.push(message) } });
  t.after(() => {
    source.dispose();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  return {
    source, timers, requests, listeners, messages,
    visibility(hidden: boolean) { page.hidden = hidden; for (const listener of listeners) listener(); },
    tick() {
      assert.equal(timers.size, 1);
      const [id, timer] = [...timers][0]!;
      timers.delete(id); timer.task();
    },
  };
}

test('a hidden statistics source stays idle and refreshes immediately when visible', async t => {
  const f = fixture(t, true);
  assert.equal(f.requests.length, 0);
  assert.equal(f.timers.size, 0);
  f.visibility(false);
  assert.equal(f.requests.length, 1);
  f.requests[0]!.result.resolve(response(7)); await settle();
  assert.equal(f.source.current?.computedAt, 7);
  assert.equal([...f.timers.values()][0]?.delay, 30_000);
  f.visibility(true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.source.current?.computedAt, 7, 'pausing preserves the visible card data');
  f.visibility(false);
  assert.equal(f.requests.length, 2);
});

test('a cancelled JSON read cannot overwrite a new snapshot or arm an extra timer', async t => {
  const f = fixture(t);
  const json = deferred<unknown>();
  f.requests[0]!.result.resolve({ ok: true, json: () => json.promise } as Response);
  await settle();
  f.visibility(true);
  assert.equal(f.requests[0]!.signal.aborted, true);
  f.visibility(false);
  assert.equal(f.requests.length, 2);
  f.requests[1]!.result.resolve(response(20)); await settle();
  assert.equal(f.source.current?.computedAt, 20);
  assert.equal(f.timers.size, 1);
  json.resolve(body(10)); await settle();
  assert.equal(f.source.current?.computedAt, 20);
  assert.equal(f.timers.size, 1, 'late completion does not create a second polling chain');
  f.tick();
  assert.equal(f.requests.length, 3);
  f.visibility(false);
  assert.equal(f.requests.length, 3, 'visibility events never overlap the current request');
  assert.deepEqual(f.messages, []);
});

test('a late transport response after unload is ignored before its JSON is read', async t => {
  const f = fixture(t);
  let jsonReads = 0, updates = 0;
  f.source.subscribe(() => { updates++; });
  f.source.dispose();
  assert.equal(f.requests[0]!.signal.aborted, true);
  assert.equal(f.listeners.size, 0);
  f.requests[0]!.result.resolve({ ok: true, json: async () => { jsonReads++; return body(1); } } as Response);
  await settle();
  assert.equal(jsonReads, 0);
  assert.equal(updates, 0);
  assert.equal(f.timers.size, 0);
});

test('inactive seats never poll; leaving aborts work, retains data and returning refreshes once', async t => {
  const f = fixture(t, false, false);
  assert.equal(f.requests.length, 0);
  f.visibility(false);
  assert.equal(f.requests.length, 0, 'window visibility cannot activate an off-page card');
  f.source.setActive(true);
  f.requests[0]!.result.resolve(response(10)); await settle();
  const held = f.source.current;
  f.tick();
  assert.equal(f.requests.length, 2);
  f.source.setActive(false);
  assert.equal(f.requests[1]!.signal.aborted, true);
  assert.equal(f.timers.size, 0);
  f.visibility(false);
  assert.equal(f.requests.length, 2);
  assert.equal(f.source.current, held);
  let staleReads = 0;
  f.requests[1]!.result.resolve({ ok: true, json: async () => { staleReads++; return body(999); } } as Response);
  await settle();
  assert.equal(staleReads, 0);
  f.source.setActive(true);
  f.source.setActive(true);
  assert.equal(f.requests.length, 3);
  f.requests[2]!.result.resolve(response(30)); await settle();
  assert.equal(f.source.current, held, 'timestamp-only responses preserve snapshot identity');
  assert.equal(f.timers.size, 1);
  f.source.dispose();
  f.source.setActive(true);
  assert.equal(f.requests.length, 3);
});

test('snapshot notifications ignore timestamps but retain progress, failure and data changes', async t => {
  const f = fixture(t);
  let notifications = 0;
  f.source.subscribe(() => notifications++);
  f.requests[0]!.result.resolve(response(1)); await settle();
  const first = f.source.current;
  f.tick(); f.requests[1]!.result.resolve(response(2)); await settle();
  assert.equal(f.source.current, first);
  assert.equal(notifications, 1);
  f.tick(); f.requests[2]!.result.resolve(new Response(JSON.stringify({ ...body(3), pending: 1,
    ranges: { all: { sessions: 1, messages: 1, tokens: 10, activeDays: 1, topModel: null, models: [] } } })));
  await settle();
  assert.equal(notifications, 2);
  assert.equal([...f.timers.values()][0]!.delay, 2000);
  f.tick(); f.requests[3]!.result.resolve(new Response(JSON.stringify({ ...body(4), missed: 1 }))); await settle();
  assert.equal(notifications, 3);
  assert.equal(f.source.current?.missed, 1);
});

test('local midnight wakes a visible seat and republishes calendar-dependent data', async t => {
  const at = new Date(2026, 9, 26, 23, 59, 59, 900).getTime();
  t.mock.timers.enable({ apis: ['Date'], now: at });
  const f = fixture(t);
  let notifications = 0;
  f.source.subscribe(() => notifications++);
  f.requests[0]!.result.resolve(response(at)); await settle();
  assert.equal([...f.timers.values()][0]!.delay, 100);
  t.mock.timers.tick(100);
  f.tick(); f.requests[1]!.result.resolve(response(at + 100)); await settle();
  assert.equal(notifications, 2, 'the heatmap must advance even when usage is identical');
  assert.equal([...f.timers.values()][0]!.delay, 30_000);
});
