import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountComposerStats, STATS_ATTRIBUTE, TRAILING_WIDTH_PROPERTY, MODEL_MAX_WIDTH_PROPERTY, STAT_VALUE_PROPERTY, CLUSTER_GAP_PROPERTY } from '../src/client/compat/stats-values.ts';
import { HOST } from '../src/client/compat/host-dom.ts';

/** DOM double for frame-style invalidation, not a browser geometry assertion. */
function fixture(readouts = true) {
  let width = 96;
  let writes = 0;
  let rowWidth = 500;
  const model = { getBoundingClientRect: () => ({ width: width - 8 }) };
  const leading = { getBoundingClientRect: () => ({ width: 80 }) };
  const dock = { getBoundingClientRect: () => ({ width: 96 }) };
  const properties = new Map<string, string>();
  const root = {
    querySelector: () => dock,
    style: {
      getPropertyValue: (key: string) => properties.get(key) ?? '',
      setProperty: (key: string, value: string) => { properties.set(key, value); writes++; },
      removeProperty: (key: string) => properties.delete(key),
    },
  };
  const trailing = { isConnected: true, getBoundingClientRect: () => ({ width }), querySelector: () => model };
  const row = { children: [leading, trailing], getBoundingClientRect: () => ({ width: rowWidth }) };
  const listeners = new Map<string, () => void>();
  let callback: () => void = () => {};
  let options: MutationObserverInit | undefined;
  let disconnected = false;
  const Observer = class {
    constructor(fn: () => void) { callback = fn; }
    observe(_node: unknown, init: MutationObserverInit) { options = init; }
    disconnect() { disconnected = true; }
  };
  const statProperties = new Map<string, string>();
  const statAttributes = new Map<string, string>();
  let statText = '6 轮 498 步 · 210 tok/s';
  const pill = {
    querySelector: () => ({ textContent: statText }),
    style: {
      getPropertyValue: (key: string) => statProperties.get(key) ?? '',
      setProperty: (key: string, value: string) => { statProperties.set(key, value); writes++; },
      removeProperty: (key: string) => statProperties.delete(key),
    },
  };
  const doc = {
    body: {},
    querySelectorAll: () => [pill],
    querySelector: (selector: string) => selector === HOST.composerRoot ? root : selector === HOST.composerRow ? row : trailing,
    documentElement: {
      getAttribute: (key: string) => statAttributes.get(key) ?? null,
      setAttribute: (key: string, value: string) => { statAttributes.set(key, value); },
      removeAttribute: (key: string) => { statAttributes.delete(key); },
    },
  };
  Object.defineProperty(globalThis, 'MutationObserver', { value: Observer, configurable: true });
  Object.defineProperty(globalThis, 'window', {
    value: {
      addEventListener: (key: string, fn: () => void) => listeners.set(key, fn),
      removeEventListener: (key: string) => listeners.delete(key),
    }, configurable: true,
  });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    value: () => ({ paddingLeft: '4px', paddingRight: '4px', columnGap: '12px', getPropertyValue: (key: string) => key === CLUSTER_GAP_PROPERTY ? '6px' : '' }),
    configurable: true,
  });
  const errors: unknown[] = [];
  const dispose = mountComposerStats(doc as unknown as Document, error => errors.push(error), readouts);
  return {
    properties, statProperties, statAttributes, errors, listeners, dispose,
    changeStat: (next: string) => { statText = next; callback(); },
    resizePanel: (next: number) => { width = next; callback(); },
    resizeRow: (next: number) => { rowWidth = next; callback(); },
    syncOwnStyle: () => callback(),
    get writes() { return writes; },
    get options() { return options; },
    get disconnected() { return disconnected; },
  };
}

test('panel track and native model changes refresh the offset without a window resize', () => {
  const f = fixture();
  assert.deepEqual(f.options?.attributeFilter, ['style', 'class', 'data-model-compact']);
  assert.equal(f.options?.attributes, true);
  assert.equal(f.properties.get(TRAILING_WIDTH_PROPERTY), '96px');
  f.resizePanel(206);
  assert.equal(f.properties.get(TRAILING_WIDTH_PROPERTY), '206px');
  assert.equal(f.properties.get(MODEL_MAX_WIDTH_PROPERTY), '290px');
  f.resizeRow(360);
  assert.equal(f.properties.get(MODEL_MAX_WIDTH_PROPERTY), '150px');
  assert.deepEqual(f.errors, []);
  f.dispose();
});

test('own property notifications settle without repeated writes and teardown releases resources', () => {
  const f = fixture();
  f.syncOwnStyle();
  f.syncOwnStyle();
  assert.equal(f.writes, 3, 'unchanged geometry must not feed the attribute observer');
  f.dispose();
  assert.equal(f.disconnected, true);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.properties.has(TRAILING_WIDTH_PROPERTY), false);
  assert.equal(f.properties.has(MODEL_MAX_WIDTH_PROPERTY), false);
  assert.equal(f.statProperties.has(STAT_VALUE_PROPERTY), false);
});

test('wide readouts mirror the current rate or cache-hit share without changing native text', () => {
  const f = fixture();
  assert.equal(f.statProperties.get(STAT_VALUE_PROPERTY), '"210 tok/s"');
  f.changeStat('117M tok · 缓存命中 95%');
  assert.equal(f.statProperties.get(STAT_VALUE_PROPERTY), '"缓存命中 95%"');
  f.changeStat('117M tok');
  assert.equal(f.statProperties.get(STAT_VALUE_PROPERTY), '"117M tok"');
  f.changeStat('');
  assert.equal(f.statProperties.has(STAT_VALUE_PROPERTY), false);
  f.dispose();
});

test('the configured state is published on the root for the stylesheet, and taken back on teardown', () => {
  const on = fixture(true);
  assert.equal(on.statAttributes.get(STATS_ATTRIBUTE), 'on');
  on.dispose();
  assert.equal(on.statAttributes.has(STATS_ATTRIBUTE), false);
  const off = fixture(false);
  assert.equal(off.statAttributes.get(STATS_ATTRIBUTE), 'off');
  off.dispose();
  assert.equal(off.statAttributes.has(STATS_ATTRIBUTE), false);
});

test('readouts switched off mirror nothing and still budget the row', () => {
  const f = fixture(false);
  assert.equal(f.statProperties.has(STAT_VALUE_PROPERTY), false);
  f.changeStat('117M tok · 缓存命中 95%');
  assert.equal(f.statProperties.has(STAT_VALUE_PROPERTY), false);
  assert.equal(f.properties.get(MODEL_MAX_WIDTH_PROPERTY), '290px', 'a hidden cluster still hands its width to the model');
  f.dispose();
});

test('teardown leaves a root state another owner has since written alone', () => {
  const f = fixture(true);
  f.statAttributes.set(STATS_ATTRIBUTE, 'external');
  f.dispose();
  assert.equal(f.statAttributes.get(STATS_ATTRIBUTE), 'external');
});
