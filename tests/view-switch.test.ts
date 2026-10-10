import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mountViewSwitch, VIEW_DOCK_ATTRIBUTE, VIEW_DOCK_RIGHT_PROPERTY, VIEW_GLYPH_ATTRIBUTE,
  VIEW_OFFSET_PROPERTY, VIEW_TAB_ATTRIBUTE, VIEW_WIDTH_PROPERTY, VIEW_DURATION_PROPERTY,
} from '../src/client/compat/view-switch.ts';

const ICONS = Object.freeze({
  chat: '<svg data-icon="chat"></svg>',
  trajectory: '<svg data-icon="trajectory"></svg>',
});

interface Rect { left: number; right: number; width: number; top: number; bottom: number; height: number }

function box(left: number, width: number): Rect {
  return { left, right: left + width, width, top: 0, bottom: 26, height: 26 };
}

interface FakeElement {
  isConnected: boolean;
  textContent: string;
  innerHTML: string;
  className: string;
  parent: FakeElement | null;
  children: FakeElement[];
  style: {
    getPropertyValue(key: string): string;
    setProperty(key: string, value: string): void;
    removeProperty(key: string): void;
  };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  prepend(child: FakeElement): void;
  remove(): void;
  getBoundingClientRect(): Rect;
  querySelector(selector: string): FakeElement | null;
  querySelectorAll(selector: string): FakeElement[];
}

function element(rect: Rect, text: string): FakeElement {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  const el: FakeElement = {
    isConnected: true,
    textContent: text,
    innerHTML: '',
    className: '',
    parent: null,
    children: [],
    style: {
      getPropertyValue: key => properties.get(key) ?? '',
      setProperty: (key, value) => { properties.set(key, value); },
      removeProperty: key => { properties.delete(key); },
    },
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => { attributes.set(name, value); },
    removeAttribute: name => { attributes.delete(name); },
    hasAttribute: name => attributes.has(name),
    prepend(child) {
      this.children.unshift(child);
      child.parent = this;
    },
    remove() {
      this.isConnected = false;
      if (this.parent !== null) this.parent.children = this.parent.children.filter(child => child !== this);
    },
    getBoundingClientRect: () => rect,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return el;
}

interface FixtureOptions {
  platform?: string;
  collapsed?: boolean;
  columnWidth?: number;
  narrowTabs?: number;
}

function fixture(options: FixtureOptions = {}) {
  const chat = element(box(100, 33), '对话');
  const trajectory = element(box(133, 33), '轨迹');
  trajectory.setAttribute('aria-selected', 'false');
  const third = element(box(166, 33), 'Timeline');
  for (const tab of [chat, trajectory, third]) {
    tab.querySelector = selector => selector.includes(VIEW_GLYPH_ATTRIBUTE)
      ? tab.children.find(child => child.getAttribute(VIEW_GLYPH_ATTRIBUTE) !== null) ?? null
      : null;
  }
  const column = element(box(0, options.columnWidth ?? 264), '');
  const tabs = element(box(100, options.narrowTabs ?? 66), '');
  tabs.querySelectorAll = () => [chat, trajectory, third];
  tabs.querySelector = selector => (selector.includes('tabActive') ? chat : null);

  const lookups = new Map<string, FakeElement | null>([
    ['.ST7X_W_tabs', tabs],
    ['._6Qf49G_sidebarCol', column],
  ]);
  const document = {
    documentElement: { dataset: { platform: options.platform ?? 'darwin' } } as { dataset: Record<string, string> },
    body: {},
    createElement: () => element(box(0, 0), ''),
    querySelector: (selector: string) => {
      if (selector.includes('data-sidebar-collapsed')) return options.collapsed === true ? column : null;
      return lookups.get(selector) ?? null;
    },
  };

  let callback = () => {};
  let disconnected = false;
  let filter: string[] | undefined;
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true, value: class {
      constructor(fn: () => void) { callback = fn; }
      observe(_node: unknown, init: MutationObserverInit) { filter = init.attributeFilter as string[]; }
      disconnect() { disconnected = true; }
    },
  });
  const listeners = new Map<string, () => void>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    innerWidth: 1000,
    addEventListener: (key: string, fn: () => void) => listeners.set(key, fn),
    removeEventListener: (key: string) => listeners.delete(key),
  } });
  let observed: FakeElement | null = null;
  let sizeDisconnected = false;
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true, value: class {
      observe(node: FakeElement) { observed = node; }
      disconnect() { sizeDisconnected = true; }
    },
  });
  const errors: unknown[] = [];
  const dispose = mountViewSwitch(
    document as unknown as Document, ICONS, error => errors.push(error),
  );
  return {
    chat, trajectory, third, tabs, column, dispose, errors, listeners,
    get observed() { return observed; },
    get sizeDisconnected() { return sizeDisconnected; },
    get filter() { return filter; },
    get disconnected() { return disconnected; },
    select: (next: FakeElement) => {
      tabs.querySelector = selector => (selector.includes('tabActive') ? next : null);
      callback();
    },
    redock: () => callback(),
    rects: (offset: number, width: number) => {
      chat.getBoundingClientRect = () => box(offset, width);
      tabs.querySelector = selector => (selector.includes('tabActive') ? chat : null);
      callback();
    },
  };
}

test('a frame style change refreshes the selected thumb immediately while the window stays fixed', () => {
  const f = fixture();
  assert.ok(f.filter?.includes('style'));
  assert.equal(f.tabs.style.getPropertyValue(VIEW_OFFSET_PROPERTY), '0px');
  assert.equal(f.tabs.style.getPropertyValue(VIEW_WIDTH_PROPERTY), '33px');
  f.rects(300, 38);
  assert.equal(f.tabs.style.getPropertyValue(VIEW_OFFSET_PROPERTY), '200px');
  assert.equal(f.tabs.style.getPropertyValue(VIEW_WIDTH_PROPERTY), '38px');
  assert.equal(f.tabs.style.getPropertyValue(VIEW_DURATION_PROPERTY), '0ms');
  assert.deepEqual(f.errors, []);
  f.dispose();
});

test('selection animates, its own style notification settles, and teardown clears geometry and listeners', () => {
  const f = fixture();
  f.select(f.trajectory);
  assert.equal(f.tabs.style.getPropertyValue(VIEW_OFFSET_PROPERTY), '33px');
  assert.equal(f.tabs.style.getPropertyValue(VIEW_DURATION_PROPERTY), '180ms');
  f.redock();
  assert.equal(f.tabs.style.getPropertyValue(VIEW_DURATION_PROPERTY), '180ms');
  f.dispose();
  assert.equal(f.disconnected, true);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.sizeDisconnected, true);
  assert.equal(f.tabs.style.getPropertyValue(VIEW_OFFSET_PROPERTY), '');
  assert.equal(f.tabs.style.getPropertyValue(VIEW_WIDTH_PROPERTY), '');
  assert.equal(f.tabs.style.getPropertyValue(VIEW_DURATION_PROPERTY), '');
});

test('the shipped tabs are redrawn as icons, reversibly, and unknown views keep their label', () => {
  const f = fixture();
  assert.equal(f.chat.getAttribute(VIEW_TAB_ATTRIBUTE), 'chat');
  assert.equal(f.chat.getAttribute('aria-label'), '对话');
  assert.equal(f.chat.children[0]?.innerHTML, ICONS.chat);
  assert.equal(f.chat.children[0]?.getAttribute('aria-hidden'), 'true');
  assert.equal(f.trajectory.getAttribute(VIEW_TAB_ATTRIBUTE), 'trajectory');
  assert.equal(f.third.getAttribute(VIEW_TAB_ATTRIBUTE), null);
  assert.equal(f.third.children.length, 0);
  f.dispose();
  assert.equal(f.chat.getAttribute(VIEW_TAB_ATTRIBUTE), null);
  assert.equal(f.chat.getAttribute('aria-label'), null);
  assert.equal(f.chat.children.length, 0);
  assert.equal(f.trajectory.children.length, 0);
});

test('the switcher parks on the sidebar column while that column has the corner to hold it', () => {
  const f = fixture();
  assert.equal(f.tabs.getAttribute(VIEW_DOCK_ATTRIBUTE), 'sidebar');
  /* 1000px window, 264px column: 1000 - 264 + the reference's 8px inset. */
  assert.equal(f.tabs.style.getPropertyValue(VIEW_DOCK_RIGHT_PROPERTY), '744px');
  assert.equal(f.observed, f.column);
  f.dispose();
  assert.equal(f.tabs.getAttribute(VIEW_DOCK_ATTRIBUTE), null);
  assert.equal(f.tabs.style.getPropertyValue(VIEW_DOCK_RIGHT_PROPERTY), '');
});

test('other platforms, a collapsed sidebar and a rail-sized column all leave the switcher in the header', () => {
  for (const options of [
    { platform: 'win32' },
    { collapsed: true, tag: 'collapsed' },
    { columnWidth: 56 },
  ] as FixtureOptions[]) {
    const f = fixture(options);
    assert.equal(f.tabs.getAttribute(VIEW_DOCK_ATTRIBUTE), null, JSON.stringify(options));
    assert.equal(f.tabs.style.getPropertyValue(VIEW_DOCK_RIGHT_PROPERTY), '', JSON.stringify(options));
    f.dispose();
  }
});
