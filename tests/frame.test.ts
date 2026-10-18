import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frameScheduler } from '../src/client/compat/frame.ts';

/*
 * The coalescing contract every paint-time pass in the plugin leans on: many
 * schedules before a frame run the task once, `cancel` drops it, and a window
 * without animation frames still settles.
 */

/** A window whose frames are run by hand. */
function frames() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let next = 1;
  const win = {
    requestAnimationFrame(callback: FrameRequestCallback) {
      const handle = next++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame(handle: number) { callbacks.delete(handle); },
  } as unknown as Window;
  return {
    win,
    get pending() { return callbacks.size; },
    /** Run one frame, as the compositor would. */
    paint(time = 16) {
      for (const [handle, callback] of [...callbacks]) {
        callbacks.delete(handle);
        callback(time);
      }
    },
  };
}

test('many schedules before a paint run one task', () => {
  const f = frames();
  let runs = 0;
  const scheduler = frameScheduler(() => { runs += 1; }, f.win);
  for (let index = 0; index < 50; index += 1) scheduler.schedule();
  assert.equal(f.pending, 1, 'one frame is queued, not fifty');
  assert.equal(runs, 0, 'nothing runs on schedule');
  f.paint();
  assert.equal(runs, 1);
  assert.equal(f.pending, 0, 'the frame is released');
});

test('a schedule after a paint runs on the next frame', () => {
  const f = frames();
  let runs = 0;
  const scheduler = frameScheduler(() => { runs += 1; }, f.win);
  scheduler.schedule();
  f.paint();
  scheduler.schedule();
  assert.equal(runs, 1);
  f.paint();
  assert.equal(runs, 2);
});

test('cancel drops the queued task and allows a new one', () => {
  const f = frames();
  let runs = 0;
  const scheduler = frameScheduler(() => { runs += 1; }, f.win);
  scheduler.schedule();
  scheduler.cancel();
  assert.equal(f.pending, 0);
  f.paint();
  assert.equal(runs, 0, 'a cancelled task never runs');

  scheduler.schedule();
  f.paint();
  assert.equal(runs, 1, 'and the scheduler is usable again');
});

test('a window without animation frames settles on the timeout fallback', async () => {
  /* An occluded window throttles frames; a test host has none at all. The
     scheduler must still run the pass, or published values stay stale. */
  const win = {} as unknown as Window;
  const original = globalThis.requestAnimationFrame;
  let runs = 0;
  try {
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    const scheduler = frameScheduler(() => { runs += 1; }, win);
    /* The fallback's delay is short but not zero; one macrotask is enough. */
    scheduler.schedule();
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(runs, 1);
  } finally {
    if (original !== undefined) globalThis.requestAnimationFrame = original;
  }
});

test('a cancelled fallback never runs', async () => {
  const win = {} as unknown as Window;
  const original = globalThis.requestAnimationFrame;
  let runs = 0;
  try {
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    const scheduler = frameScheduler(() => { runs += 1; }, win);
    scheduler.schedule();
    scheduler.cancel();
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(runs, 0);
  } finally {
    if (original !== undefined) globalThis.requestAnimationFrame = original;
  }
});
