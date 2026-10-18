/**
 * Coalesce DOM work into one paint frame.
 *
 * A mutation observer delivers one batch per microtask, and several documents
 * (a panel drag, a streaming transcript, a slider writing its own inline
 * style) can produce many batches between two paints. Doing a full geometry
 * pass per batch multiplies the layout reads by the batch count; doing it once
 * per frame is what the screen can actually use.
 *
 * The fallbacks are deliberate: an occluded Electron window throttles animation
 * frames, and a frame without `requestAnimationFrame` at all (some test hosts)
 * must still settle. In both cases the work runs on a timeout instead, so the
 * published values are never left stale.
 */

/** One coalescing scheduler; `schedule` runs `task` once before the next paint. */
export interface FrameScheduler {
  /** Queue the task; repeated calls before it runs collapse into one. */
  schedule(): void;
  /** Drop a queued task without running it. */
  cancel(): void;
}

/**
 * Build a scheduler over one task.
 *
 * @param task - the read/write pass to run at most once per frame.
 * @param win - the window supplying animation frames; defaults to the global.
 * @returns the scheduler; its task never runs after `cancel`.
 */
export function frameScheduler(task: () => void, win: Window | null = globalThis.window ?? null): FrameScheduler {
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    if (frame !== 0) {
      (win?.cancelAnimationFrame ?? globalThis.cancelAnimationFrame)(frame);
      frame = 0;
    }
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const run = () => {
    frame = 0;
    timer = undefined;
    task();
  };
  return {
    schedule() {
      if (frame !== 0 || timer !== undefined) return;
      const request = win?.requestAnimationFrame ?? globalThis.requestAnimationFrame;
      if (typeof request === 'function') {
        frame = request.call(win ?? undefined, run);
        return;
      }
      timer = setTimeout(run, 16);
    },
    cancel: clear,
  };
}
