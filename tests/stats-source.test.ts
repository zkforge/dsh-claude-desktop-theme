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
function fixture(t: TestContext, hidden = false) {
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
  const source = createStatsSource({ logger: { debug: message => messages.push(message), error: message => messages.push(message) } });
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
