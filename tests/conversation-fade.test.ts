import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  edgeFadeState, mountConversationFade, FADE_BOTTOM_ATTRIBUTE, FADE_BOTTOM_INSET_PROPERTY, FADE_TOP_ATTRIBUTE,
} from '../src/client/compat/conversation-fade.ts';

test('a viewport with nothing to scroll never fades either edge', () => {
  assert.deepEqual(edgeFadeState(0, 400, 400), { top: false, bottom: false });
  /* Scaled displays report fractional heights; a sliver is not content. */
  assert.deepEqual(edgeFadeState(0, 400.5, 400), { top: false, bottom: false });
});

test('each edge fades only while it still hides content', () => {
  assert.deepEqual(edgeFadeState(0, 1000, 400), { top: false, bottom: true });
  assert.deepEqual(edgeFadeState(300, 1000, 400), { top: true, bottom: true });
  assert.deepEqual(edgeFadeState(600, 1000, 400), { top: true, bottom: false });
  /* Rubber-band overscroll must not re-fade the edge already reached. */
  assert.deepEqual(edgeFadeState(-40, 1000, 400), { top: false, bottom: true });
  assert.deepEqual(edgeFadeState(640, 1000, 400), { top: true, bottom: false });
});

/** The page's own timers, kept so each fixture starts from them rather than
    from the previous fixture's stand-in. */
const REAL_TIMERS = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };

/** Capture the scheduler's timeout fallback so a test can run a paint on demand. */
function installFrames(): () => void {
  const queued = new Map<ReturnType<typeof setTimeout>, () => void>();
  const { setTimeout: schedule, clearTimeout: clear } = REAL_TIMERS;
  globalThis.setTimeout = ((fn: () => void) => {
    const handle = schedule(() => {}, 0);
    queued.set(handle, fn);
    return handle;
  }) as unknown as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    queued.delete(handle);
    clear(handle);
  }) as unknown as typeof globalThis.clearTimeout;
  return () => {
    for (const [handle, fn] of [...queued]) {
      queued.delete(handle);
      clear(handle);
      fn();
    }
  };
}

function fixture() {
  /* The fade coalesces its passes into one paint. This fixture is a window
     without animation frames, so the scheduler's timeout fallback runs them;
     frames() drains what is queued, exactly one pass per batch of batches. */
  const frames = installFrames();

  const makeElement = () => {
    const attributes = new Set<string>();
    const listeners = new Map<string, () => void>();
    return {
      isConnected: true,
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 400,
      /* Viewport 49..449; the Composer seat below covers its last 79px. */
      getBoundingClientRect: () => ({ top: 49, bottom: 449 }),
      attributes,
      listeners,
      hasAttribute: (name: string) => attributes.has(name),
      setAttribute: (name: string) => { attributes.add(name); },
      removeAttribute: (name: string) => { attributes.delete(name); },
      addEventListener: (type: string, listener: () => void) => { listeners.set(type, listener); },
      removeEventListener: (type: string) => { listeners.delete(type); },
    };
  };

  let scroller = makeElement();
  let seatTop = 370;
  let callback = () => {};
  let disconnected = false;
  let options: MutationObserverInit | undefined;
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true, value: class {
      constructor(fn: () => void) { callback = fn; }
      observe(_node: unknown, init: MutationObserverInit) { options = init; }
      disconnect() { disconnected = true; }
    },
  });
  const windowListeners = new Map<string, () => void>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: (key: string, listener: () => void) => windowListeners.set(key, listener),
    removeEventListener: (key: string) => windowListeners.delete(key),
  } });

  const errors: unknown[] = [];
  /* The page body carries the inset the stylesheet's bottom overlay reads. */
  const properties = new Map<string, string>();
  const page = {
    style: {
      getPropertyValue: (name: string) => properties.get(name) ?? '',
      setProperty: (name: string, value: string) => { properties.set(name, value); },
      removeProperty: (name: string) => { properties.delete(name); },
    },
  };
  const document = {
    body: {},
    querySelector: (selector: string) => {
      if (selector === '[data-composer-seat]') return { getBoundingClientRect: () => ({ top: seatTop }) };
      if (selector === '.ST7X_W_body') return page;
      return scroller;
    },
  } as unknown as Document;
  const dispose = mountConversationFade(document, error => errors.push(error));
  return {
    errors, dispose, windowListeners, properties,
    get scroller() { return scroller; },
    get options() { return options; },
    get disconnected() { return disconnected; },
    /* A scroll is a paint-time signal too: the listener only queues the pass. */
    scrollTo(offset: number) { scroller.scrollTop = offset; scroller.listeners.get('scroll')?.(); frames(); },
    shrink() { scroller.scrollHeight = 400; callback(); frames(); },
    seat(top: number) { seatTop = top; scroller.listeners.get('scroll')?.(); frames(); },
    swap() {
      const previous = scroller;
      scroller = makeElement();
      callback();
      frames();
      return previous;
    },
    resize() { windowListeners.get('resize')?.(); frames(); },
    /** Deliver a batch without painting: what the coalescing is for. */
    mutate() { callback(); },
    frames,
  };
}

test('the fade attributes follow the scroller without re-entering the observer', () => {
  const f = fixture();
  assert.equal(f.scroller.attributes.has(FADE_TOP_ATTRIBUTE), true);
  assert.equal(f.scroller.attributes.has(FADE_BOTTOM_ATTRIBUTE), true);
  assert.ok(f.options?.childList && f.options.subtree && f.options.characterData);
  /* The module writes attributes; watching every attribute would loop. */
  assert.deepEqual(f.options?.attributeFilter, ['class', 'style']);

  f.scrollTo(0);
  assert.equal(f.scroller.attributes.has(FADE_TOP_ATTRIBUTE), false);
  assert.equal(f.scroller.attributes.has(FADE_BOTTOM_ATTRIBUTE), true);

  f.scrollTo(600);
  assert.equal(f.scroller.attributes.has(FADE_TOP_ATTRIBUTE), true);
  assert.equal(f.scroller.attributes.has(FADE_BOTTOM_ATTRIBUTE), false);

  f.shrink();
  assert.equal(f.scroller.attributes.has(FADE_TOP_ATTRIBUTE), false);
  assert.equal(f.scroller.attributes.has(FADE_BOTTOM_ATTRIBUTE), false);

  /* The bottom stencil ends where the Composer's seat starts (449 - 370). */
  assert.equal(f.properties.get(FADE_BOTTOM_INSET_PROPERTY), '79px');
  /* A seat that has not been reached yet covers nothing. */
  f.seat(600);
  assert.equal(f.properties.has(FADE_BOTTOM_INSET_PROPERTY), false);

  f.resize();
  assert.deepEqual(f.errors, []);
  f.dispose();
});

test('a rebuilt Session moves the listener and clears the previous scroller', () => {
  const f = fixture();
  const previous = f.swap();
  assert.equal(previous.attributes.has(FADE_TOP_ATTRIBUTE), false);
  assert.equal(previous.attributes.has(FADE_BOTTOM_ATTRIBUTE), false);
  assert.equal(previous.listeners.has('scroll'), false);
  assert.equal(f.scroller.attributes.has(FADE_BOTTOM_ATTRIBUTE), true);
  assert.equal(f.properties.get(FADE_BOTTOM_INSET_PROPERTY), '79px');
  f.scrollTo(600);
  assert.equal(f.scroller.attributes.has(FADE_TOP_ATTRIBUTE), true);
  f.dispose();
});

test('a stream of batches settles in one pass per paint', () => {
  const f = fixture();
  let content = 1000;
  let reads = 0;
  Object.defineProperty(f.scroller, 'scrollHeight', {
    get() { reads += 1; return content; },
    configurable: true,
  });
  /* Every batch queues the same pass; none of them measures on delivery. */
  for (let index = 0; index < 20; index += 1) f.mutate();
  assert.equal(reads, 0, 'an observer batch must not measure the transcript');
  f.frames();
  assert.equal(reads, 1, 'twenty batches, one paint, one measurement');
  /* The next paint's batch is a new pass. */
  content = 400;
  f.mutate();
  f.frames();
  assert.equal(reads, 2);
  assert.equal(f.scroller.attributes.has(FADE_BOTTOM_ATTRIBUTE), false);
  f.dispose();
});

test('dispose releases every observer, listener and attribute', () => {
  const f = fixture();
  f.dispose();
  assert.equal(f.disconnected, true);
  assert.equal(f.windowListeners.has('resize'), false);
  assert.equal(f.scroller.listeners.has('scroll'), false);
  assert.equal(f.scroller.attributes.has(FADE_TOP_ATTRIBUTE), false);
  assert.equal(f.scroller.attributes.has(FADE_BOTTOM_ATTRIBUTE), false);
  assert.equal(f.properties.has(FADE_BOTTOM_INSET_PROPERTY), false);
});

test('a pass queued when the mount is released never runs', () => {
  const f = fixture();
  f.mutate();
  f.dispose();
  assert.equal(f.errors.length, 0);
  /* Nothing threw after teardown: the queued pass was dropped, not run. */
  f.frames();
});

test('an unavailable observer reports once and leaves the transcript alone', () => {
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true, value: class { constructor() { throw new Error('no observers'); } },
  });
  const errors: unknown[] = [];
  const dispose = mountConversationFade(
    { body: {}, querySelector: () => null } as unknown as Document,
    error => errors.push(error),
  );
  assert.equal(errors.length, 1);
  dispose();
});
