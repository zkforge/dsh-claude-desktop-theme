import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDLE_MS, SCROLLING_ATTRIBUTE, mountScrollPills } from '../src/client/compat/scroll-pill.ts';

test('one capture listener marks dynamic scrollers, resets idle timers and fully releases', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const timers = new Map<number, () => void>();
  let next = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    setTimeout(fn: () => void, delay: number) { assert.equal(delay, IDLE_MS); timers.set(++next, fn); return next; },
    clearTimeout(id: number) { timers.delete(id); },
  } });
  let listener: ((event: Event) => void) | undefined;
  let removed = false;
  const surface = () => {
    const attrs = new Set<string>();
    return { attrs, setAttribute(name: string) { attrs.add(name); }, removeAttribute(name: string) { attrs.delete(name); } };
  };
  const first = surface(), second = surface(), page = surface();
  const document = {
    scrollingElement: page,
    addEventListener(name: string, callback: (event: Event) => void, options: AddEventListenerOptions) {
      assert.equal(name, 'scroll'); assert.equal(options.capture, true); listener = callback;
    },
    removeEventListener(_name: string, callback: (event: Event) => void) { assert.equal(callback, listener); removed = true; },
  } as unknown as Document;
  const errors: unknown[] = [];
  const dispose = mountScrollPills(document, error => errors.push(error));
  try {
    listener!({ target: first } as unknown as Event);
    assert.ok(first.attrs.has(SCROLLING_ATTRIBUTE));
    listener!({ target: first } as unknown as Event);
    assert.equal(timers.size, 1);
    listener!({ target: second } as unknown as Event);
    listener!({ target: document } as unknown as Event);
    assert.ok(second.attrs.has(SCROLLING_ATTRIBUTE));
    assert.ok(page.attrs.has(SCROLLING_ATTRIBUTE));
    for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
    assert.equal(first.attrs.size + second.attrs.size + page.attrs.size, 0);
    listener!({ target: second } as unknown as Event);
    assert.ok(second.attrs.has(SCROLLING_ATTRIBUTE));
    assert.deepEqual(errors, []);
  } finally {
    dispose();
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else Reflect.deleteProperty(globalThis, 'window');
  }
  assert.equal(removed, true);
  assert.equal(second.attrs.size, 0);
  assert.equal(timers.size, 0);
});
