import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { mountStatusGroups, sessionGroup } from '../src/client/compat/status-groups.ts';
import type { SessionStatus } from '../src/client/compat/status-groups.ts';
import { adoptConfig, resolveConfig } from '../src/shared/config.ts';

test('pending input outranks live work; a stopped session remains ended after its unread reminder clears', () => {
  for (const kind of ['approval', 'plan-review', 'question']) {
    assert.equal(sessionGroup({ running: true, pendingInteraction: { kind } }, true), 'input');
  }
  assert.equal(sessionGroup(undefined, true), 'working');
  assert.equal(sessionGroup({ running: true }, false), 'working');
  assert.equal(sessionGroup({ running: false }, true), 'ended');
  assert.equal(sessionGroup(undefined, false), 'ended');
});

test('status grouping defaults on and survives the settings transport', () => {
  assert.equal(resolveConfig().view.groupByStatus, true);
  assert.equal(adoptConfig({ view: { groupByStatus: true } }).view.groupByStatus, true);
  assert.equal(adoptConfig({ view: { groupByStatus: false } }).view.groupByStatus, false);
  assert.equal(adoptConfig({ view: { groupByStatus: 'true' } }).view.groupByStatus, true);
  assert.throws(() => resolveConfig({ view: { groupByStatus: 'true' } }), /view.groupByStatus/);
});

class Element {
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  children: Element[] = [];
  parentElement: Element | null = null;
  className = '';
  textContent = '';
  isConnected = true;
  style = {
    values: new Map<string, string>(), order: '',
    setProperty(key: string, value: string) { this.values.set(key, value); },
    getPropertyValue(key: string) { return this.values.get(key) ?? ''; },
    getPropertyPriority() { return ''; },
    removeProperty(key: string) { this.values.delete(key); },
  };
  setAttribute(key: string, value: string) {
    this.attributes.set(key, value);
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  hasAttribute(key: string) { return this.attributes.has(key); }
  removeAttribute(key: string) {
    this.attributes.delete(key);
    if (key.startsWith('data-')) delete this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())];
  }
  append(...nodes: Element[]) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(node => node !== this);
    this.parentElement = null; this.isConnected = false;
  }
  querySelector(selector: string): Element | null {
    for (const child of this.children) {
      if (child.getAttribute('aria-hidden') === 'true'
        && selector.includes(`data-state="${child.getAttribute('data-state')}"`)) return child;
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }
  querySelectorAll(selector?: string) {
    const result: Element[] = [];
    const sessionRows = selector === undefined || selector.includes('data-row-key');
    const walk = (node: Element) => { for (const child of node.children) {
      if ((sessionRows && child.dataset.rowKey?.startsWith('session:'))
        || (selector?.includes('flatList') && child.className.includes('flatList'))) result.push(child);
      walk(child);
    } };
    walk(this); return result;
  }
  matches(selector: string) {
    return selector.startsWith('[') && selector.endsWith(']')
      ? this.hasAttribute(selector.slice(1, -1)) : false;
  }
  contains(node: object): boolean {
    if (node === this) return true;
    return this.children.some(child => child.contains(node));
  }
  getBoundingClientRect() { return { top: 0, left: 0, height: 28 }; }
}

/** One mount over two Session rows: `a` working, `b` ended. */
function fixture(rootStatus: boolean) {
  let notifyMutation = (records?: MutationRecord[]) => { void records; };
  const list = new Element();
  const wrapper = new Element();
  const a = new Element(), b = new Element();
  a.setAttribute('data-row-key', 'session:a'); b.setAttribute('data-row-key', 'session:b');
  a.setAttribute('tabindex', '-1'); a.style.setProperty('--ccd-status-order', '17');
  wrapper.append(a); list.append(wrapper, b);
  const callbacks = [new Set<() => void>(), new Set<() => void>()];
  const statuses = new Map<string, SessionStatus>([['a', { running: true }], ['b', {}]]);
  const store = <T>(value: T, index: number) => ({ getSnapshot: () => value,
    subscribe(listener: () => void) { callbacks[index]!.add(listener); return () => { callbacks[index]!.delete(listener); }; } });
  const working = new Element();
  working.setAttribute('aria-hidden', 'true'); working.setAttribute('data-state', 'ongoing');
  a.append(working);
  const ctx = { uiSession: rootStatus ? { sessionStatus: store(statuses, 0) } : {}, sessions: { list: store({ byId: {
    a: { id: 'a', running: true }, b: { id: 'b', running: false },
  } }, 1) } } as unknown as Context;
  const events = new Set<string>();
  const doc = {
    documentElement: { lang: 'zh-CN', dataset: { platform: 'darwin' } }, hidden: false,
    defaultView: { matchMedia: () => ({ matches: true }) },
    querySelector: (selector: string) => selector.includes('flatList') ? list : null,
    createElement: () => new Element(),
    addEventListener: (key: string) => events.add(key), removeEventListener: (key: string) => events.delete(key),
  } as unknown as Document;
  return { list, wrapper, a, b, callbacks, statuses, pending: new Element(), ctx, doc, events,
    /** Deliver a batch the way the browser would, through the observer. */
    mutation: (records: MutationRecord[] = []) => notifyMutation(records),
    setNotify: (callback: (records?: MutationRecord[]) => void) => { notifyMutation = callback; } };
}

/** A batch that names one target, as one observer delivery does. */
function batch(type: MutationRecord['type'], target: object): MutationRecord[] {
  return [{ type, target, addedNodes: [], removedNodes: [] } as unknown as MutationRecord];
}

for (const platform of ['darwin', 'win32']) for (const rootStatus of [true, false]) {
  test(`status grouping preserves rows and restores the list (${platform}, root source: ${rootStatus})`, async () => {
    const original = globalThis.MutationObserver;
    const f = fixture(rootStatus);
    const { list, wrapper, a, b, callbacks, statuses, pending } = f;
    globalThis.MutationObserver = class {
      constructor(callback: (records?: MutationRecord[]) => void) { f.setNotify(callback); }
      observe(_target: unknown, options: MutationObserverInit) {
        assert.ok(options.attributeFilter?.includes('data-state'));
      }
      disconnect() {}
    } as unknown as typeof MutationObserver;
    f.doc.documentElement.dataset.platform = platform;
    const errors: unknown[] = [];
    try {
      const dispose = mountStatusGroups(f.doc, f.ctx, false, error => errors.push(error));
      assert.deepEqual(errors, []);
      assert.equal(a.dataset.ccdStatusGroup, 'working');
      assert.equal(b.dataset.ccdStatusGroup, 'ended');
      assert.equal(a.parentElement, wrapper);
      assert.equal(wrapper.parentElement, list);
      statuses.set('b', { running: true, pendingInteraction: { kind: 'approval' } });
      pending.setAttribute('aria-hidden', 'true'); pending.setAttribute('data-state', 'warning');
      b.append(pending);
      const arrive = () => rootStatus
        ? callbacks[0]!.forEach(notify => notify())
        : f.mutation(batch('attributes', pending));
      arrive();
      await Promise.resolve();
      assert.equal(b.dataset.ccdStatusGroup, 'input');
      assert.ok(Number(b.dataset.ccdStatusOrder) < Number(a.dataset.ccdStatusOrder));
      assert.equal(list.children.filter(node => node.className === 'ccd-status-heading').length, 2);
      statuses.set('b', {});
      pending.setAttribute('data-state', 'done');
      arrive();
      await Promise.resolve();
      assert.equal(b.dataset.ccdStatusGroup, 'ended', 'clearing input and completion reminders restores the ended group');
      dispose();
      assert.deepEqual(list.children, [wrapper, b]);
      assert.equal(a.getAttribute('tabindex'), '-1');
      assert.equal(b.getAttribute('tabindex'), null);
      assert.equal(a.style.getPropertyValue('--ccd-status-order'), '17');
      assert.equal(b.style.getPropertyValue('--ccd-status-order'), '');
      assert.equal(wrapper.hasAttribute('data-ccd-status-wrapper'), false);
      assert.deepEqual(callbacks.map(source => source.size), [0, 0]);
      assert.equal(f.events.size, 0);
      assert.deepEqual(errors, []);
    } finally { globalThis.MutationObserver = original; }
  });
}

test('a batch from another pane does not touch the flat list', async () => {
  const original = globalThis.MutationObserver;
  const f = fixture(true);
  globalThis.MutationObserver = class {
    constructor(callback: (records?: MutationRecord[]) => void) { f.setNotify(callback); }
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;
  const errors: unknown[] = [];
  try {
    const dispose = mountStatusGroups(f.doc, f.ctx, false, error => errors.push(error));
    /* A write that lands nowhere near the list cannot change a row's group; a
       pass would walk every row and write every marker again. */
    const before = JSON.stringify([f.a.dataset, f.b.dataset, f.a.style.values, f.b.style.values]);
    f.mutation(batch('attributes', { nodeType: 1, isConnected: true }));
    await Promise.resolve();
    assert.equal(JSON.stringify([f.a.dataset, f.b.dataset, f.a.style.values, f.b.style.values]), before);
    /* A row inside the list still reaches the pass. */
    f.statuses.set('b', { running: true });
    f.mutation(batch('attributes', f.b));
    await Promise.resolve();
    assert.equal(f.b.dataset.ccdStatusGroup, 'working');
    assert.deepEqual(errors, []);
    dispose();
  } finally { globalThis.MutationObserver = original; }
});

test('an unchanged pass writes nothing and reads no layout', async () => {
  const original = globalThis.MutationObserver;
  const f = fixture(true);
  globalThis.MutationObserver = class {
    constructor(callback: (records?: MutationRecord[]) => void) { f.setNotify(callback); }
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;
  try {
    const dispose = mountStatusGroups(f.doc, f.ctx, false, error => { throw error; });
    /* Native churn inside the list that changes no status: the wrapper's
       classes are rewritten, the row is touched. The plan is identical, so the
       pass must stop before it reads a rect or writes a marker. */
    let reads = 0;
    for (const row of [f.a, f.b]) {
      const original = row.getBoundingClientRect.bind(row);
      row.getBoundingClientRect = () => { reads += 1; return original(); };
    }
    const order = f.b.style.getPropertyValue('--ccd-status-order');
    for (let index = 0; index < 10; index += 1) f.mutation(batch('attributes', f.wrapper));
    await Promise.resolve();
    assert.equal(reads, 0, 'an unchanged plan never asks the engine to flush layout');
    assert.equal(f.b.style.getPropertyValue('--ccd-status-order'), order);
    dispose();
  } finally { globalThis.MutationObserver = original; }
});

for (const mode of ['reduced motion', 'hidden window']) test(`changed status skips animation geometry in a ${mode}`, async () => {
  const original = globalThis.MutationObserver;
  const f = fixture(true);
  globalThis.MutationObserver = class {
    constructor(callback: (records?: MutationRecord[]) => void) { f.setNotify(callback); }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  if (mode === 'hidden window') {
    Object.assign(f.doc, { hidden: true });
    Object.assign(f.doc.defaultView!, { matchMedia: () => ({ matches: false }) });
  }
  let reads = 0, unchangedWrites = 0;
  for (const row of [f.a, f.b]) row.getBoundingClientRect = () => { reads++; return { top: 0, left: 0, height: 28 }; };
  try {
    const dispose = mountStatusGroups(f.doc, f.ctx, false, error => { throw error; });
    const set = f.a.style.setProperty.bind(f.a.style);
    f.a.style.setProperty = (key, value) => { unchangedWrites++; set(key, value); };
    f.statuses.set('b', { pendingInteraction: { kind: 'approval' } });
    f.callbacks[0]!.forEach(notify => notify());
    await Promise.resolve();
    assert.equal(f.b.dataset.ccdStatusGroup, 'input');
    assert.equal(reads, 0, 'no animation will play, so neither old nor new row boxes are needed');
    assert.equal(unchangedWrites, 0, 'the other row keeps its existing order without a style mutation');
    dispose();
  } finally { globalThis.MutationObserver = original; }
});

test('unchanged groups release detached wrappers and restore removed headings', async () => {
  const original = globalThis.MutationObserver;
  const f = fixture(true);
  globalThis.MutationObserver = class {
    constructor(callback: (records?: MutationRecord[]) => void) { f.setNotify(callback); }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  try {
    const dispose = mountStatusGroups(f.doc, f.ctx, false, error => { throw error; });
    f.wrapper.children = [];
    f.wrapper.remove();
    f.list.append(f.a);
    f.mutation(batch('childList', f.list));
    await Promise.resolve();
    assert.equal(f.wrapper.hasAttribute('data-ccd-status-wrapper'), false, 'old wrapper is restored before the unchanged-plan return');
    const nextWrapper = new Element();
    f.a.remove(); f.a.isConnected = true;
    nextWrapper.append(f.a); f.list.append(nextWrapper);
    const heading = f.list.children.find(node => node.className === 'ccd-status-heading')!;
    heading.remove();
    f.mutation(batch('childList', f.list));
    await Promise.resolve();
    assert.equal(nextWrapper.hasAttribute('data-ccd-status-wrapper'), true, 'replacement wrappers receive layout markers');
    assert.equal(f.list.children.filter(node => node.className === 'ccd-status-heading').length, 2);
    dispose();
    assert.equal(nextWrapper.hasAttribute('data-ccd-status-wrapper'), false);
  } finally { globalThis.MutationObserver = original; }
});
