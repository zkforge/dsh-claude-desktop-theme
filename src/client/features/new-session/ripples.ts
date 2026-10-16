import { HERO_RIPPLE_DURATION } from '../../contracts/hero-canvas.ts';
import type { HeroRippleImpulse } from '../../contracts/hero-canvas.ts';

const GLYPHS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TAU = Math.PI * 2;
const GLYPH_WIDTH = 8;
const GLYPH_HEIGHT = 15;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (from: number, to: number, value: number) => {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** A stable character/grain seed, independent of both time and user content. */
function hash(x: number, y: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
/** Continuous signed noise; moving through it bends the wavefronts smoothly. */
function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  return mix(mix(hash(ix, iy), hash(ix + 1, iy), sx),
    mix(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx), sy) * 2 - 1;
}

interface WaveFrame {
  readonly time: number;
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly phase: number;
  readonly strength: number;
}
function frameAt(elapsed: number, width: number, height: number): WaveFrame {
  // Keep the field moving continuously: no dark interval or cycle reset.
  const time = elapsed / 1000;
  return {
    time,
    scale: Math.max(320, Math.min(width, height, 900)),
    offsetX: hash(0, 17) * 13,
    offsetY: hash(0, 43) * 13,
    phase: hash(0, 71) * TAU,
    strength: .9 + .1 * Math.sin(time * TAU / 12.8),
  };
}

/** Multiple warped, interfering fronts, with broken crests and soft patches. */
function fieldAt(x: number, y: number, frame: WaveFrame): number {
  const { time: t, scale, phase, offsetX, offsetY, strength } = frame;
  if (strength === 0) return 0;
  const nx = x / scale, ny = y / scale;
  const u = nx + .27 * noise(nx * 2 + offsetX + t * .08, ny * 2 - t * .11)
    + .065 * Math.sin(ny * 5.1 + t * .43 + phase);
  const v = ny + .24 * noise(nx * 2.3 + 23 - t * .09, ny * 2 + offsetY + t * .07)
    + .055 * Math.sin(nx * 4.7 - t * .37);
  const distanceA = Math.hypot((u - .17) * .84, v - .62);
  const distanceB = Math.hypot(u - 1.1, (v + .18) * .78);
  const frontA = Math.sin(distanceA * 12.2 - t * 2.05 + phase);
  const frontB = Math.sin(distanceB * 10.6 - t * 1.53 - phase * .7);
  const cross = Math.sin(u * 5.8 + v * 4.3 + t * .71 + phase);
  const crest = smooth(.12, .94, frontA * .65 + frontB * .43 + cross * .2);
  const secondary = smooth(.48, 1, frontB * .7 - frontA * .3);
  const patches = .3 + .7 * smooth(-.5, .55,
    noise(u * 3.3 + offsetX - t * .12, v * 3.3 + offsetY + t * .08));
  return strength * (crest * .46 + secondary * .14) * patches;
}

/** Reveal the ambient field's broken, warped crests in an outward-moving patch. */
function clickFieldAt(x: number, y: number, elapsed: number, width: number, height: number,
  impulses: readonly HeroRippleImpulse[]): number {
  let light = 0;
  const scale = Math.max(320, Math.min(width, height, 900));
  for (const impulse of impulses) {
    const age = (elapsed - impulse.startedAt) / HERO_RIPPLE_DURATION;
    if (age < 0 || age >= 1) continue;
    const dx = (x - impulse.x * width) / scale, dy = (y - impulse.y * height) / scale;
    const seed = impulse.x * 7 + impulse.y * 11 + impulse.startedAt / 10000;
    const growth = smooth(0, .2, age);
    const u = dx + growth * (.18 * noise(dx * 3.2 + seed + age * .5, dy * 3.2 - age * .4)
      + .065 * Math.sin(dy * 5 + seed));
    const v = dy + growth * (.16 * noise(dx * 3.1 + 23 - age * .5, dy * 3.1 + seed)
      + .06 * Math.sin(dx * 4.3 - seed));
    const distance = Math.hypot(u * .9, v * 1.08);
    const front = (distance - age * 1.25) / (.075 + age * .055);
    const spread = Math.exp(-front * front);
    // Use exactly the natural background's multi-front interference and
    // patchy light. The spreading envelope only reveals it; it paints no ring.
    const texture = fieldAt(x, y, {
      time: 3 + age * 3.5, scale,
      offsetX: seed, offsetY: seed + 13, phase: seed * 1.7, strength: 1,
    });
    const fade = smooth(0, .055, age) * (1 - smooth(.12, 1, age));
    // Brief soft light at the contact point makes the first click visible
    // even when the nearby natural wave crests are currently dark.
    const contact = Math.exp(-(u * u + v * v) / .018) * (1 - smooth(.035, .16, age)) * .32;
    light += (texture * spread * 1.6 + contact) * fade;
  }
  return light;
}

function characterAt(x: number, y: number, illumination: number,
  textureFade = 1): { alpha: number; glyph: string } {
  const grain = hash(Math.floor(x / GLYPH_WIDTH), Math.floor(y / GLYPH_HEIGHT));
  return {
    // Lift the moving light while keeping the quiet character texture subdued.
    alpha: Math.min(.72, (.012 + grain * .013) * textureFade + illumination * 1.65 * (.45 + .55 * grain)),
    glyph: GLYPHS[Math.floor(grain * GLYPHS.length)]!,
  };
}

/** One character's stable grain and time-varying light, before the edge fade. */
export function rippleCell(x: number, y: number, elapsed: number,
  width: number, height: number, impulses: readonly HeroRippleImpulse[] = []): { alpha: number; glyph: string } {
  return characterAt(x, y, fieldAt(x, y, frameAt(elapsed, width, height))
    + clickFieldAt(x, y, elapsed, width, height, impulses));
}

/** Stationary ASCII rows lit by an autonomous, slowly swelling wave field. */
export function drawHeroRipples(canvas: HTMLCanvasElement, elapsed: number,
  impulses: readonly HeroRippleImpulse[] = []): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const ratio = Math.min(canvas.ownerDocument.defaultView!.devicePixelRatio || 1, 2);
  const width = canvas.width / ratio, height = canvas.height / ratio;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!width || !height) return;
  context.fillStyle = getComputedStyle(canvas).getPropertyValue('--ccd-hero-ripple-ink').trim();
  context.font = '12px monospace'; context.textBaseline = 'top';
  const frame = frameAt(elapsed, width, height);
  const fadeIn = smooth(0, 1.4, elapsed / 1000);
  // Sample only the smoothly varying light on a coarse mesh. Bilinear
  // interpolation keeps it continuous without evaluating noise per glyph.
  const step = 18;
  const columns = Math.ceil(width / step) + 1, rows = Math.ceil(height / step) + 1;
  const light = new Float32Array(columns * rows);
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    light[row * columns + col] = fieldAt(col * step, row * step, frame) * fadeIn
      + clickFieldAt(col * step, row * step, elapsed, width, height, impulses);
  }
  for (let y = 0; y < height; y += GLYPH_HEIGHT) {
    const row = Math.floor(y / step), fy = y / step - row;
    for (let x = 0; x < width; x += GLYPH_WIDTH) {
      const col = Math.floor(x / step), fx = x / step - col;
      const index = row * columns + col;
      const illumination = mix(mix(light[index]!, light[index + 1]!, fx),
        mix(light[index + columns]!, light[index + columns + 1]!, fx), fy);
      const cell = characterAt(x, y, illumination, fadeIn);
      const edge = Math.min(smooth(0, 55, x), smooth(0, 55, width - x),
        smooth(0, 16, y), smooth(0, 100, height - y));
      context.globalAlpha = cell.alpha * edge;
      if (context.globalAlpha > .006) context.fillText(cell.glyph, x, y);
    }
  }
  context.globalAlpha = 1;
}
