import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IDLE_MS, PILL_ATTRIBUTE, PILL_LAYER_ATTRIBUTE, PILL_SURFACE_ATTRIBUTE, SCROLLING_ATTRIBUTE,
  mountScrollPills,
} from '../src/client/compat/scroll-pill.ts';

/*
 * The pill's per-surface listener.
 *
 * Each adopted surface gets one scroll listener and one pill, and both belong
 * to that adoption. A surface React replaced, or a feature scope that is
 * disposed and mounted again on a config change, must not leave the old
 * closure listening: one live handler per past mount is exactly the kind of
 * growth that makes a long session slower with every Session switch. The
 * browser suite checks the drawing; this suite counts listeners and timers,
 * which is what a stale closure shows up as.
 */

interface FakeElement {
  isConnected: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  attributes: Set<string>;
  listeners: Map<string, Set<() => void>>;
  style: Record<string, string>;
  getBoundingClientRect(): { right: number; top: number };
  hasAttribute(name: string): boolean;
  setAttribute(name: string, value?: string): void;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  remove(): void;
  append(child: FakeElement): void;
}

function makeElement(): FakeElement {
  const attributes = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    isConnected: true,
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 400,
    attributes,
    listeners,
    style: {},
    getBoundingClientRect: () => ({ right: 800, top: 0 }),
    hasAttribute: name => attributes.has(name),
    setAttribute: (name, value = '') => { void value; attributes.add(name); },
    removeAttribute: name => { attributes.delete(name); },
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    remove() { this.isConnected = false; },
    append() {},
  };
}

function fixture() {
  /* The surfaces the document hands back; `replace` is the page rebuilding its
     tree, `add` is one more scroller arriving. */
  const surfaces: FakeElement[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  /* The module reads its clock through `window`, so this fixture owns it: a
     fade only runs when the test says it is due. */
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout(fn: () => void) { const handle = nextTimer++; timers.set(handle, fn); return handle; },
    clearTimeout(handle: number) { timers.delete(handle); },
    addEventListener() {},
    removeEventListener() {},
  } });
  let callback = () => {};
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true, value: class {
      constructor(fn: () => void) { callback = fn; }
      observe() {}
      disconnect() {}
    },
  });

  const body = makeElement();
  const document = {
    body,
    createElement: () => makeElement(),
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: () => surfaces,
  } as unknown as Document;

  let disposed = false;
  const mount = () => {
    disposed = false;
    return mountScrollPills(document, () => {});
  };
  let release = mount();
  return {
    surfaces,
    document,
    get disposed() { return disposed; },
    /** Mount a fresh surface, as the tree arriving does. */
    add(surface = makeElement()) { surfaces.push(surface); callback(); return surface; },
    /** Replace the whole set, the way a rebuilt page does. */
    replace(next: FakeElement[]) { surfaces.splice(0, surfaces.length, ...next); callback(); },
    /** Release this mount and mount again on the same document, as a config change does. */
    remount() { release(); disposed = true; release = mount(); },
    dispose() { release(); disposed = true; },
    /** Deliver every pending idle timer. */
    idle() {
      for (const [handle, fn] of [...timers]) {
        timers.delete(handle);
        fn();
      }
    },
    /** Scroll one surface and count the handlers that hear it. */
    scroll(surface: FakeElement, offset: number) {
      surface.scrollTop = offset;
      let heard = 0;
      for (const listener of surface.listeners.get('scroll') ?? []) { heard += 1; listener(); }
      return heard;
    },
    get timers() { return timers.size; },
  };
}

test('one mount adopts one listener per surface', () => {
  const f = fixture();
  try {
    const surface = f.add();
    assert.equal(surface.attributes.has(PILL_SURFACE_ATTRIBUTE), true);
    assert.equal(f.scroll(surface, 100), 1, 'exactly one listener answers a scroll');
  } finally { f.dispose(); }
});

test('a replaced surface hands its listener, mark and pill back', () => {
  const f = fixture();
  try {
    const first = f.add();
    const lasting = f.add();
    assert.equal(first.listeners.get('scroll')?.size, 1);

    /* The host rebuilds the transcript column: the old node leaves the document
       and the lookup no longer returns it. */
    first.isConnected = false;
    const replacement = f.add();
    f.replace([replacement, lasting]);
    assert.equal(first.listeners.get('scroll')?.size, 0, 'the detached surface keeps no listener');
    assert.equal(first.attributes.has(PILL_SURFACE_ATTRIBUTE), false, 'nor its mark');
    assert.equal(f.scroll(replacement, 100), 1);
    assert.equal(lasting.listeners.get('scroll')?.size, 1, 'a live surface is untouched');
  } finally { f.dispose(); }
});

test('a scope mounted again leaves one listener, not one per past mount', () => {
  const f = fixture();
  try {
    const surface = f.add();
    assert.equal(f.scroll(surface, 100), 1);
    for (let cycle = 1; cycle <= 5; cycle += 1) {
      f.remount();
      assert.equal(surface.isConnected, true);
      assert.equal(f.scroll(surface, 100), 1, `one listener after ${cycle} remounts`);
    }
  } finally { f.dispose(); }
});

test('a released surface drops the idle timer that would have touched its pill', () => {
  const f = fixture();
  try {
    const surface = f.add();
    f.scroll(surface, 100);
    assert.equal(f.timers, 1, 'a scroll arms the fade');
    surface.isConnected = false;
    f.add();
    assert.equal(f.timers, 0, 'releasing the surface cancels its fade');
    /* Nothing runs on a timer that belonged to a pill that is gone. */
    f.idle();
  } finally { f.dispose(); }
});

test('dispose leaves no listener, mark, layer or timer behind', () => {
  const f = fixture();
  const surface = f.add();
  f.scroll(surface, 100);
  f.dispose();
  assert.equal(surface.listeners.get('scroll')?.size, 0);
  assert.equal(surface.attributes.has(PILL_SURFACE_ATTRIBUTE), false);
  assert.equal(surface.attributes.has(SCROLLING_ATTRIBUTE), false);
  assert.equal(f.timers, 0);
});

test('the pill\'s marks are the ones the sheet reads', () => {
  /* Constants the stylesheet keys on; changing one silently unstyles a pill. */
  assert.equal(PILL_SURFACE_ATTRIBUTE, 'data-ccd-scroll-pill');
  assert.equal(SCROLLING_ATTRIBUTE, 'data-ccd-scrolling');
  assert.equal(PILL_LAYER_ATTRIBUTE, 'data-ccd-scroll-layer');
  assert.equal(PILL_ATTRIBUTE, 'data-ccd-scroll-thumb');
  assert.equal(IDLE_MS, 800);
});
