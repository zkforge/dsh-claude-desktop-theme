import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HeroRippleImpulse } from '../src/client/contracts/hero-canvas.ts';
import { drawHeroRipples, rippleCell } from '../src/client/features/new-session/ripples.ts';

test('the ASCII field is deterministic, finite and bounded while its wave travels', () => {
  let changed = 0;
  for (let y = 0; y < 500; y += 11) for (let x = 0; x < 800; x += 7) {
    const cell = rippleCell(x, y, 4200, 800, 500);
    assert.deepEqual(cell, rippleCell(x, y, 4200, 800, 500));
    assert.ok(Number.isFinite(cell.alpha) && cell.alpha >= 0 && cell.alpha <= .62);
    assert.match(cell.glyph, /^[\da-zA-Z]$/);
    if (cell.alpha !== rippleCell(x, y, 6000, 800, 500).alpha) changed++;
  }
  assert.ok(changed > 1000);
});

test('light swells and decays over stable glyphs, with different shapes on the next pass', () => {
  const times = [0, 1600, 4800, 11000, 12800, 17600];
  const energy = times.map(time => {
    let total = 0;
    for (let y = 0; y < 600; y += 22) for (let x = 0; x < 960; x += 18) {
      const cell = rippleCell(x, y, time, 960, 600);
      assert.equal(cell.glyph, rippleCell(x, y, 0, 960, 600).glyph);
      total += cell.alpha;
    }
    return total;
  });
  assert.ok(energy[2]! > energy[0]! * 2, 'the active wave stands above the quiet texture');
  assert.equal(energy[0], energy[1]);
  assert.equal(energy[0], energy[3]);
  assert.equal(energy[0], energy[4], 'a new cycle starts without a brightness cut');
  let difference = 0;
  for (let y = 0; y < 600; y += 22) for (let x = 0; x < 960; x += 18) {
    difference += Math.abs(rippleCell(x, y, 4800, 960, 600).alpha
      - rippleCell(x, y, 17600, 960, 600).alpha);
  }
  assert.ok(difference > 20, 'the next pass does not replay the same wave shape');
});

test('click light spreads outward in uneven patches, then releases the unchanged ambient field', () => {
  const impulses = [{ x: .5, y: .5, startedAt: 11000 }];
  const delta = (x: number, y: number, age: number) => rippleCell(x, y, 11000 + age, 960, 600, impulses).alpha
    - rippleCell(x, y, 11000 + age, 960, 600).alpha;
  const meanRadius = (age: number) => {
    let energy = 0, radius = 0;
    for (let y = 0; y < 600; y += 11) for (let x = 0; x < 960; x += 6) {
      const light = delta(x, y, age);
      energy += light; radius += light * Math.hypot(x - 480, y - 300);
    }
    assert.ok(energy > 0);
    return radius / energy;
  };
  const near = meanRadius(200), middle = meanRadius(900), far = meanRadius(1400);
  assert.ok(middle > near * 1.5 && far > middle * 1.3, 'visible patches advance away from the click');
  const sectors = Array.from({ length: 8 }, (_, i) => {
    const angle = i * Math.PI / 4;
    let light = 0;
    for (let radius = 120; radius < 330; radius += 12) {
      light += delta(480 + Math.cos(angle) * radius, 300 + Math.sin(angle) * radius, 900);
    }
    return light;
  });
  assert.ok(Math.max(...sectors) > Math.min(...sectors) * 3, 'the front has interrupted, uneven illumination');
  assert.equal(delta(708, 300, 2800), 0, 'expired clicks do not affect the ambient field');
  assert.equal(delta(708, 300, -1), 0, 'a wave cannot appear before its click');
  assert.equal(rippleCell(708, 300, 11900, 960, 600, impulses).glyph,
    rippleCell(708, 300, 11900, 960, 600).glyph);
});

test('drawing uses theme ink, caps pixel density, clears the prior frame and restores alpha', () => {
  const original = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (() => ({ getPropertyValue: () => '#2477ac' })) as unknown as typeof getComputedStyle;
  const transforms: number[][] = [], clears: number[][] = [];
  let glyphs = 0, brightest = 0;
  const context = {
    globalAlpha: 1, fillStyle: '', font: '', textBaseline: '',
    setTransform(...values: number[]) { transforms.push(values); },
    clearRect(...values: number[]) { clears.push(values); },
    fillText() { glyphs++; brightest = Math.max(brightest, this.globalAlpha); },
  };
  const canvas = { width: 800, height: 600, ownerDocument: { defaultView: { devicePixelRatio: 3 } },
    getContext: () => context } as unknown as HTMLCanvasElement;
  try {
    drawHeroRipples(canvas, 4800);
    assert.deepEqual(transforms, [[2, 0, 0, 2, 0, 0]]);
    assert.deepEqual(clears, [[0, 0, 400, 300]]);
    assert.equal(context.fillStyle, '#2477ac');
    assert.equal(context.globalAlpha, 1);
    assert.ok(glyphs > 0);
    brightest = 0;
    drawHeroRipples(canvas, 200, [{ x: .5, y: .5, startedAt: 0 }]);
    assert.ok(brightest > .1, 'an immediate click is visible during the ambient fade-in');
  } finally { globalThis.getComputedStyle = original; }
});

test('hero lifecycle pauses for visibility and reduced motion and releases the canvas on phase change', async () => {
  const { mountHeroCanvas } = await import('../src/client/compat/hero-canvas.ts');
  const oldMutation = globalThis.MutationObserver, oldResize = globalThis.ResizeObserver;
  let mutation = () => {}, resized = () => {};
  let disconnected = 0;
  globalThis.MutationObserver = class {
    constructor(callback: () => void) { mutation = callback; }
    observe() {} disconnect() { disconnected++; }
  } as unknown as typeof MutationObserver;
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) { resized = callback; }
    observe() {} disconnect() { disconnected++; }
  } as unknown as typeof ResizeObserver;
  const events = new Map<string, (event?: unknown) => void>(), windowEvents = new Set<string>();
  const frames = new Map<number, FrameRequestCallback>();
  let id = 0, mediaChange = () => {}, removed = 0, calls = 0;
  let active: readonly HeroRippleImpulse[] = [];
  const background = { closest: () => null };
  const control = { closest: () => control };
  const media = { matches: false,
    addEventListener: (_: string, callback: () => void) => { mediaChange = callback; },
    removeEventListener: () => { mediaChange = () => {}; },
  };
  const canvas = { width: 300, height: 150, hidden: false, className: '', setAttribute() {},
    getBoundingClientRect: () => ({ left: 50, top: 40, right: 850, bottom: 540, width: 800, height: 500 }),
    remove: () => { removed++; } };
  const hero = { prepend() {}, contains: (target: unknown) => target === background || target === control, getBoundingClientRect: () => ({ width: 800, height: 500 }),
    getClientRects: () => [{}] };
  let present = true;
  const doc = {
    body: {}, documentElement: {}, hidden: false,
    defaultView: { devicePixelRatio: 3, matchMedia: () => media,
      requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; },
      cancelAnimationFrame: (frame: number) => { frames.delete(frame); },
      addEventListener: (key: string) => windowEvents.add(key), removeEventListener: (key: string) => windowEvents.delete(key),
    },
    querySelector: (selector: string) => selector.includes('data-phase') && present ? hero : null,
    createElement: () => canvas,
    addEventListener: (key: string, callback: (event?: unknown) => void) => events.set(key, callback),
    removeEventListener: (key: string) => events.delete(key),
  };
  const errors: unknown[] = [];
  try {
    const dispose = mountHeroCanvas(doc as unknown as Document, (_canvas, _elapsed, impulses) => { calls++; active = impulses; }, error => errors.push(error));
    assert.equal(events.has('pointermove'), false);
    assert.equal(events.has('pointerleave'), false);
    resized();
    assert.equal(canvas.width, 1600); assert.equal(canvas.height, 1000);
    assert.equal(frames.size, 1);
    const [frameId, draw] = [...frames][0]!; frames.delete(frameId); draw(100);
    assert.equal(calls, 1); assert.equal(frames.size, 1);
    const click = (extra: object = {}) => events.get('click')!({
      target: background, clientX: 450, clientY: 290, button: 0, detail: 1, defaultPrevented: false, ...extra,
    });
    const tick = (time: number) => {
      const [frameId, draw] = [...frames][0]!; frames.delete(frameId); draw(time);
    };
    click(); tick(200);
    assert.deepEqual(active, [{ x: .5, y: .5, startedAt: 0 }]);
    for (const extra of [{ target: control }, { button: 2 }, { defaultPrevented: true },
      { detail: 0 }, { clientX: 20 }, { target: { closest: () => null } }]) click(extra);
    tick(300); assert.equal(active.length, 1, 'controls, outside clicks and cancelled gestures stay native');
    for (let i = 0; i < 10; i++) click({ clientX: 100 + i });
    tick(400);
    assert.deepEqual(active, [{ x: .5, y: .5, startedAt: 0 }],
      'rapid clicks neither stack, relocate nor restart the first wave');
    tick(3400); assert.equal(active.length, 0, 'expired waves are released');
    click({ clientX: 130, clientY: 140 }); tick(3500);
    assert.deepEqual(active, [{ x: .1, y: .2, startedAt: 3300 }], 'a new click is accepted after completion');
    doc.hidden = true; events.get('visibilitychange')!();
    assert.equal(frames.size, 0); assert.equal(canvas.hidden, true);
    doc.hidden = false; events.get('visibilitychange')!();
    assert.equal(frames.size, 1);
    tick(3600); assert.equal(active.length, 0, 'hidden pages discard click waves');
    media.matches = true; mediaChange();
    assert.equal(frames.size, 0); assert.equal(canvas.hidden, true);
    click();
    media.matches = false; mediaChange(); assert.equal(frames.size, 1);
    tick(3700); assert.equal(active.length, 0, 'reduced motion ignores clicks');
    present = false; mutation();
    assert.equal(frames.size, 0); assert.equal(removed, 1);
    dispose(); mutation();
    assert.equal(events.size, 0); assert.equal(windowEvents.size, 0);
    assert.ok(disconnected >= 2); assert.deepEqual(errors, []);
  } finally {
    globalThis.MutationObserver = oldMutation; globalThis.ResizeObserver = oldResize;
  }
});
