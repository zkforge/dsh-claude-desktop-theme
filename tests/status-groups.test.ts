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

test('status grouping is opt-in and survives the settings transport', () => {
  assert.equal(resolveConfig().view.groupByStatus, false);
  assert.equal(adoptConfig({ view: { groupByStatus: true } }).view.groupByStatus, true);
  assert.equal(adoptConfig({ view: { groupByStatus: 'true' } }).view.groupByStatus, false);
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
  querySelectorAll() {
    const result: Element[] = [];
    const walk = (node: Element) => { for (const child of node.children) {
      if (child.dataset.rowKey?.startsWith('session:')) result.push(child);
      walk(child);
    } };
    walk(this); return result;
  }
  getBoundingClientRect() { return { top: 0, left: 0, height: 28 }; }
}

test('status moves preserve native row ownership, menus and styles; disposal restores the flat list', async () => {
  const original = globalThis.MutationObserver;
  globalThis.MutationObserver = class { observe() {} disconnect() {} } as unknown as typeof MutationObserver;
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
  const ctx = { uiSession: { sessionStatus: store(statuses, 0) }, sessions: { list: store({ byId: {
    a: { id: 'a', running: true }, b: { id: 'b', running: false },
  } }, 1) } } as unknown as Context;
  const errors: unknown[] = [];
  const events = new Set<string>();
  const doc = {
    documentElement: { lang: 'zh-CN' }, hidden: false,
    defaultView: { matchMedia: () => ({ matches: true }) },
    querySelector: (selector: string) => selector.includes('flatList') ? list : null,
    createElement: () => new Element(),
    addEventListener: (key: string) => events.add(key), removeEventListener: (key: string) => events.delete(key),
  } as unknown as Document;
  try {
    const dispose = mountStatusGroups(doc, ctx, false, error => errors.push(error));
    assert.deepEqual(errors, []);
    assert.equal(a.dataset.ccdStatusGroup, 'working');
    assert.equal(b.dataset.ccdStatusGroup, 'ended');
    assert.equal(a.parentElement, wrapper);
    assert.equal(wrapper.parentElement, list);
    statuses.set('b', { running: true, pendingInteraction: { kind: 'approval' } });
    for (const notify of callbacks[0]!) notify();
    await Promise.resolve();
    assert.equal(b.dataset.ccdStatusGroup, 'input');
    assert.ok(Number(b.dataset.ccdStatusOrder) < Number(a.dataset.ccdStatusOrder));
    assert.equal(list.children.filter(node => node.className === 'ccd-status-heading').length, 2);
    dispose();
    assert.deepEqual(list.children, [wrapper, b]);
    assert.equal(a.getAttribute('tabindex'), '-1');
    assert.equal(b.getAttribute('tabindex'), null);
    assert.equal(a.style.getPropertyValue('--ccd-status-order'), '17');
    assert.equal(b.style.getPropertyValue('--ccd-status-order'), '');
    assert.equal(wrapper.hasAttribute('data-ccd-status-wrapper'), false);
    assert.deepEqual(callbacks.map(source => source.size), [0, 0]);
    assert.equal(events.size, 0);
    assert.deepEqual(errors, []);
  } finally { globalThis.MutationObserver = original; }
});
