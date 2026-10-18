import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cachedSize } from '../src/client/features/model-controls/popup.ts';

/**
 * The popover's box is the expensive half of a placement: reading it right
 * after the trigger makes the browser lay the panel out twice. The cache keeps
 * one read per size change, which the panel's own resize observer reports.
 */
function surface(width: number, height: number) {
  let reads = 0;
  const box = {
    style: { width, height },
    getBoundingClientRect() {
      reads += 1;
      return { width: box.style.width, height: box.style.height };
    },
  };
  return { box, get reads() { return reads; } };
}

test('the first placement measures the surface, later ones reuse the size', () => {
  const panel = surface(260, 180);
  const size = cachedSize(panel.box as unknown as Element);
  assert.deepEqual(size.current(), { width: 260, height: 180 });
  assert.equal(panel.reads, 1);
  /* A drag moves the trigger, not the panel: placing again reads no panel box. */
  assert.deepEqual(size.current(), { width: 260, height: 180 });
  assert.equal(panel.reads, 1);
});

test('a resize reported by the observer re-reads the box once', () => {
  const panel = surface(260, 180);
  const size = cachedSize(panel.box as unknown as Element);
  size.current();
  panel.box.style.width = 320;
  panel.box.style.height = 64;
  /* The observer callback is the only path that invalidates the cache. */
  size.refresh();
  assert.equal(panel.reads, 2);
  assert.deepEqual(size.current(), { width: 320, height: 64 });
  assert.equal(panel.reads, 2);
});

test('refresh seeds a cache that was never read', () => {
  const panel = surface(200, 120);
  const size = cachedSize(panel.box as unknown as Element);
  size.refresh();
  assert.deepEqual(size.current(), { width: 200, height: 120 });
  assert.equal(panel.reads, 1);
});
