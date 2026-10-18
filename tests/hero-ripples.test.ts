import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HeroRippleImpulse } from '../src/client/contracts/hero-canvas.ts';
import { drawHeroRipples, rippleCell } from '../src/client/features/new-session/ripples.ts';

test('the ASCII field is deterministic, finite and bounded while its wave travels', () => {
  let changed = 0;
  for (let y = 0; y < 500; y += 11) for (let x = 0; x < 800; x += 7) {
    const cell = rippleCell(x, y, 4200, 800, 500);
    assert.deepEqual(cell, rippleCell(x, y, 4200, 800, 500));
    assert.ok(Number.isFinite(cell.alpha) && cell.alpha >= 0 && cell.alpha <= .72);
    assert.match(cell.glyph, /^[\da-zA-Z]$/);
    if (cell.alpha !== rippleCell(x, y, 6000, 800, 500).alpha) changed++;
  }
  assert.ok(changed > 1000);
});

test('light stays visible over stable glyphs and moves continuously across former cycle boundaries', () => {
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
  for (const total of energy) {
    assert.ok(total > 960 / 18 * Math.ceil(600 / 22) * .04,
      'the moving field remains visible even during former quiet intervals');
  }
  let boundaryDifference = 0;
  for (let y = 0; y < 600; y += 22) for (let x = 0; x < 960; x += 18) {
    boundaryDifference += Math.abs(rippleCell(x, y, 12799, 960, 600).alpha
      - rippleCell(x, y, 12800, 960, 600).alpha);
  }
  assert.ok(boundaryDifference < 1, 'the field does not jump at the former cycle boundary');
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

test('the ink and sampling mesh are resolved once per box and scheme, not per frame', () => {
  const original = globalThis.getComputedStyle;
  let reads = 0;
  globalThis.getComputedStyle = (() => {
    reads += 1;
    return { getPropertyValue: () => (reads === 1 ? '#2477ac' : '#ff0000') };
  }) as unknown as typeof getComputedStyle;
  const allocations: number[] = [];
  const originalFloat = globalThis.Float32Array;
  globalThis.Float32Array = new Proxy(originalFloat, {
    construct(target, args) { allocations.push((args[0] as number) ?? 0); return new target(...args as [number]); },
  }) as unknown as typeof Float32Array;
  const context = {
    globalAlpha: 1, fillStyle: '', font: '', textBaseline: '',
    setTransform() {}, clearRect() {}, fillText() {},
  };
  const body: { hasAttribute(name: string): boolean } = { hasAttribute: () => false };
  const document = { defaultView: { devicePixelRatio: 1 }, body, documentElement: { getAttribute: () => 'true' } };
  const canvas = { width: 400, height: 300, ownerDocument: document, getContext: () => context } as unknown as HTMLCanvasElement;
  try {
    drawHeroRipples(canvas, 0);
    assert.equal(reads, 1);
    assert.equal(allocations.length, 1, 'the light mesh is allocated once');
    assert.equal(context.fillStyle, '#2477ac');
    for (let elapsed = 42; elapsed < 600; elapsed += 42) drawHeroRipples(canvas, elapsed);
    assert.equal(reads, 1, 'frames draw from the resolved ink');
    assert.equal(allocations.length, 1, 'and reuse the mesh');
    /* A resize and a scheme swap are the two things that invalidate it. */
    canvas.width = 800;
    drawHeroRipples(canvas, 700);
    assert.equal(allocations.length, 2, 'a new box needs a mesh of its own');
    assert.equal(reads, 1, 'the ink is still the same colour');
    body.hasAttribute = name => name === 'data-ds-dark-theme';
    drawHeroRipples(canvas, 800);
    assert.equal(reads, 2, 'the dark scheme re-reads it');
    assert.equal(context.fillStyle, '#ff0000');
  } finally {
    globalThis.getComputedStyle = original;
    globalThis.Float32Array = originalFloat;
  }
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
  const titleCanvas = { ...canvas, style: {} as Record<string, string>, remove() {} };
  const hero = { prepend() {}, contains: (target: unknown) => target === background || target === control, getBoundingClientRect: () => ({ left: 200, top: 40, width: 800, height: 500 }),
    getClientRects: () => [{}] };
  let present = true;
  const doc = {
    body: { prepend() {} }, documentElement: {}, hidden: false,
    defaultView: { devicePixelRatio: 3, matchMedia: () => media,
      requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; },
      cancelAnimationFrame: (frame: number) => { frames.delete(frame); },
      addEventListener: (key: string) => windowEvents.add(key), removeEventListener: (key: string) => windowEvents.delete(key),
    },
    querySelector: (selector: string) => selector.includes('data-phase') && present ? hero : null,
    createElement: (() => {
      let created = 0;
      return () => created++ === 0 ? canvas : titleCanvas;
    })(),
    addEventListener: (key: string, callback: (event?: unknown) => void) => events.set(key, callback),
    removeEventListener: (key: string) => events.delete(key),
  };
  const errors: unknown[] = [];
  try {
    const dispose = mountHeroCanvas(doc as unknown as Document, (_canvas, _elapsed, impulses) => { calls++; if (_canvas === canvas as unknown as HTMLCanvasElement) active = impulses; }, error => errors.push(error));
    assert.equal(events.has('pointermove'), false);
    assert.equal(events.has('pointerleave'), false);
    resized();
    assert.equal(canvas.width, 1600); assert.equal(canvas.height, 1000);
    assert.equal(titleCanvas.width, 1600); assert.equal(titleCanvas.height, 80);
    assert.equal(titleCanvas.style.left, '200px');
    assert.equal(titleCanvas.style.width, '800px');
    assert.equal(titleCanvas.style.height, '40px');
    assert.equal(frames.size, 1);
    const [frameId, draw] = [...frames][0]!; frames.delete(frameId); draw(100);
    assert.equal(calls, 2); assert.equal(frames.size, 1);
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
    /* A held pointer and a typing reader both leave the field one frame
       behind; the clock keeps running so it resumes where it would have been. */
    const before = calls;
    events.get('pointerdown')!({ type: 'pointerdown' }); tick(3800);
    assert.equal(calls, before, 'a drag does not paint behind the pointer');
    tick(3900); assert.equal(calls, before);
    /* One paint is two draws: the page's canvas and the title bar's. */
    events.get('pointerup')!({ type: 'pointerup' }); tick(4000);
    assert.equal(calls, before + 2, 'the field resumes when the gesture ends');
    events.get('keydown')!({ type: 'keydown', key: 'a' }); tick(4300);
    assert.equal(calls, before + 2, 'typing holds the same frame');
    events.get('keyup')!({ type: 'keyup', key: 'a' }); tick(4600);
    assert.equal(calls, before + 4, 'releasing the key lets it paint again');
    /* A modifier is not typing, so the cadence carries on under it. */
    events.get('keydown')!({ type: 'keydown', key: 'Shift' }); tick(4700);
    assert.equal(calls, before + 6, 'a bare modifier does not hold the field');
    events.get('keyup')!({ type: 'keyup', key: 'Shift' });
    doc.hidden = true; events.get('visibilitychange')!();
    assert.equal(frames.size, 0); assert.equal(canvas.hidden, true); assert.equal(titleCanvas.hidden, true);
    doc.hidden = false; events.get('visibilitychange')!();
    assert.equal(frames.size, 1);
    tick(3600); assert.equal(active.length, 0, 'hidden pages discard click waves');
    media.matches = true; mediaChange();
    assert.equal(frames.size, 0); assert.equal(canvas.hidden, true); assert.equal(titleCanvas.hidden, true);
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
