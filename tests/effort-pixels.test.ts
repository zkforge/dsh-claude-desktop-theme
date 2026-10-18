import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawPixelField } from '../src/client/features/model-controls/pixels.ts';

/**
 * The field is drawn from an animation frame, so anything it resolves per
 * frame is paid 30 times a second for as long as the card is open. Its colours
 * are theme variables: they change when the host swaps the scheme, not between
 * frames.
 */
function fixture(scheme: { dark: boolean; style: string }) {
  let reads = 0;
  const originalStyle = globalThis.getComputedStyle;
  const hadWindow = 'window' in globalThis;
  const originalWindow = (globalThis as { window?: unknown }).window;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
  globalThis.getComputedStyle = (() => {
    reads += 1;
    const stops = ['leftColor', 'deepViolet', 'deepMid', 'midPurple', 'softMid', 'softLilac', 'paleCool', 'highlightColor', 'peakColor'];
    return {
      getPropertyValue: (name: string) => {
        const index = stops.findIndex(stop => name === `--ccd-effort-pixel-${stop}`);
        if (index < 0) return '';
        const base = scheme.dark ? 92 : 210;
        return `${base}, ${base - 4}, ${base + 8}`;
      },
    };
  }) as unknown as typeof getComputedStyle;
  const document = {
    documentElement: { getAttribute: () => scheme.style },
    body: { hasAttribute: (name: string) => name === 'data-ds-dark-theme' && scheme.dark },
  };
  let fills = 0;
  const context = {
    globalAlpha: 1, fillStyle: '', canvas: null as unknown,
    setTransform() {}, clearRect() {}, save() {}, restore() {}, clip() {}, beginPath() {},
    roundRect() {}, fillRect() { fills += 1; },
  };
  const canvas = {
    width: 640, height: 96, ownerDocument: document,
    getContext: () => context,
  } as unknown as HTMLCanvasElement;
  return { canvas, scheme, get reads() { return reads; }, get fills() { return fills; },
    restore: () => {
      globalThis.getComputedStyle = originalStyle;
      if (hadWindow) Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
      else delete (globalThis as { window?: unknown }).window;
    } };
}

test('the palette is resolved once per scheme, not once per frame', () => {
  const f = fixture({ dark: false, style: 'true' });
  try {
    drawPixelField(f.canvas, 0, false);
    const first = f.reads;
    assert.ok(first >= 1, 'the first frame resolves the stops');
    for (let elapsed = 33; elapsed < 1000; elapsed += 33) drawPixelField(f.canvas, elapsed, false);
    assert.equal(f.reads, first, 'later frames draw from the resolved palette');
    assert.ok(f.fills > 0);
  } finally { f.restore(); }
});

test('a scheme swap resolves the stops again', () => {
  const f = fixture({ dark: false, style: 'true' });
  try {
    drawPixelField(f.canvas, 0, false);
    const light = f.reads;
    f.scheme.dark = true;
    drawPixelField(f.canvas, 33, false);
    assert.equal(f.reads, light + 1, 'the dark palette is read once the host switches');
    drawPixelField(f.canvas, 66, false);
    assert.equal(f.reads, light + 1);
  } finally { f.restore(); }
});
