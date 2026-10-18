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

interface ClickFrame {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly age: number;
  readonly seed: number;
  readonly growth: number;
  readonly radius: number;
  readonly thickness: number;
  readonly fade: number;
  readonly contact: number;
  readonly innerSquared: number;
  readonly outerSquared: number;
}

function clicksAt(elapsed: number, width: number, height: number,
  impulses: readonly HeroRippleImpulse[]): ClickFrame[] {
  const scale = Math.max(320, Math.min(width, height, 900));
  const frames: ClickFrame[] = [];
  for (const impulse of impulses) {
    const age = (elapsed - impulse.startedAt) / HERO_RIPPLE_DURATION;
    if (age < 0 || age >= 1) continue;
    const growth = smooth(0, .2, age), radius = age * 1.25, thickness = .022 + age * .018;
    const contact = (1 - smooth(.025, .12, age)) * .24;
    // Domain warp changes radius by at most sqrt(2)*.12 + .035 + .018.
    // Four Gaussian widths include all visible crests (tail < 0.00000012).
    const margin = growth * (Math.SQRT2 * .12 + .053) + thickness * 4;
    const inner = contact > 0 ? 0 : Math.max(0, radius - .19 - margin);
    const outer = Math.max(radius + margin, contact > 0 ? .4 : 0);
    frames.push({ x: impulse.x * width, y: impulse.y * height, scale, age,
      seed: impulse.x * 7 + impulse.y * 11 + impulse.startedAt / 10000,
      growth, radius, thickness, contact,
      fade: smooth(0, .045, age) * (1 - smooth(.25, 1, age)),
      innerSquared: inner * inner, outerSquared: outer * outer });
  }
  return frames;
}

/** Evaluate only the annulus that can contain a visible folded crest. */
function clickLightAt(x: number, y: number, frame: ClickFrame): number {
  const { scale, age, seed, growth, radius, thickness, fade, contact } = frame;
  const dx = (x - frame.x) / scale, dy = (y - frame.y) / scale;
  const squared = dx * dx + dy * dy;
  if (squared < frame.innerSquared || squared > frame.outerSquared) return 0;
  const u = dx + growth * .12 * noise(dx * 3.2 + seed + age * .5, dy * 3.2 - age * .4);
  const v = dy + growth * .12 * noise(dx * 3.1 + 23 - age * .5, dy * 3.1 + seed);
  const angle = Math.atan2(v, u);
  const distance = Math.hypot(u, v)
    + growth * (.035 * Math.sin(angle * 3 + seed + age * 2)
      + .018 * Math.sin(angle * 5 - age * 3));
  let crests = 0;
  for (let i = 0; i < 3; i++) {
    const front = (distance - radius + i * .095) / thickness;
    if (Math.abs(front) <= 4) crests += Math.exp(-front * front) * (1 - i * .23);
  }
  // Most points between the crests need neither patch noise nor exponentials.
  const patches = crests > 0 ? .025 + .975 * smooth(-.1, .65,
    noise(u * 5 + seed + age * .3, v * 5 - age * .2)) : 0;
  const point = contact > 0 ? Math.exp(-(u * u + v * v) / .009) * contact : 0;
  return (crests * patches * .65 + point) * fade;
}

function characterAt(x: number, y: number, illumination: number,
  elapsed: number, textureFade = 1): { alpha: number; glyph: string } {
  const grain = hash(Math.floor(x / GLYPH_WIDTH), Math.floor(y / GLYPH_HEIGHT));
  // Each cell ticks independently, so the grid shimmers without flashing in unison.
  const tick = Math.floor(elapsed / (300 + grain * 400) + grain * 17);
  const character = hash(Math.floor(x / GLYPH_WIDTH) + tick * 1013, Math.floor(y / GLYPH_HEIGHT));
  return {
    // Lift the moving light while keeping the quiet character texture subdued.
    alpha: Math.min(.72, (.012 + grain * .013) * textureFade + illumination * 1.65 * (.45 + .55 * grain)),
    glyph: GLYPHS[Math.floor(character * GLYPHS.length)]!,
  };
}

/** One cell's independently changing character and moving light, before edge fade. */
export function rippleCell(x: number, y: number, elapsed: number,
  width: number, height: number, impulses: readonly HeroRippleImpulse[] = []): { alpha: number; glyph: string } {
  let light = fieldAt(x, y, frameAt(elapsed, width, height));
  for (const frame of clicksAt(elapsed, width, height, impulses)) light += clickLightAt(x, y, frame);
  return characterAt(x, y, light, elapsed);
}

/**
 * The ink and the sampling mesh, kept between frames.
 *
 * Both are facts about the canvas's box and colour scheme, and both are read
 * with layout-forcing calls (`getComputedStyle`, `defaultView`). The field is
 * redrawn about 24 times a second for as long as the page is up, so resolving
 * them per frame makes the background's cost scale with the display's refresh
 * rate for no visual difference. The mesh is keyed on the exact pixel size the
 * canvas was last drawn at; the ink on the document's colour scheme.
 */
interface RippleSurface {
  readonly bitmapWidth: number;
  readonly bitmapHeight: number;
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
  readonly step: number;
  readonly columns: number;
  readonly rows: number;
  /** Reused between frames: the interpolation reads it, nothing retains it. */
  readonly light: Float32Array;
  readonly cells: readonly GlyphCell[];
  readonly scheme: string;
  atlas?: HTMLCanvasElement;
  layers?: {
    glyphs: HTMLCanvasElement;
    mask: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    maskContext: CanvasRenderingContext2D;
    pixels: ImageData;
  };
  ink: string;
}

interface GlyphCell {
  readonly x: number;
  readonly y: number;
  readonly index: number;
  readonly fx: number;
  readonly fy: number;
  readonly grain: number;
  readonly edge: number;
  tick: number;
  glyph: number;
}

const surfaces = new WeakMap<HTMLCanvasElement, RippleSurface>();

/** The colour scheme the ink was read under (see `theme/tokens.css`). */
function schemeOf(canvas: HTMLCanvasElement): string {
  const document = canvas.ownerDocument;
  return `${document?.documentElement?.getAttribute('data-dsh-ccd-style') ?? ''}|${document?.body?.hasAttribute('data-ds-dark-theme') ?? false}`;
}

function surfaceOf(canvas: HTMLCanvasElement, scheme: string): RippleSurface {
  const cached = surfaces.get(canvas);
  const ratio = Math.min(canvas.ownerDocument.defaultView!.devicePixelRatio || 1, 2);
  if (cached !== undefined && cached.bitmapWidth === canvas.width && cached.bitmapHeight === canvas.height
    && cached.ratio === ratio && cached.scheme === scheme) return cached;
  const width = canvas.width / ratio, height = canvas.height / ratio;
  /* Sample only the smoothly varying light on a coarse mesh. Bilinear
     interpolation keeps it continuous without evaluating noise per glyph. */
  const step = 18;
  const columns = Math.max(1, Math.ceil(width / step) + 1), rows = Math.max(1, Math.ceil(height / step) + 1);
  const cells: GlyphCell[] = [];
  for (let y = 0; y < height; y += GLYPH_HEIGHT) for (let x = 0; x < width; x += GLYPH_WIDTH) {
    const edge = Math.min(smooth(0, 55, x), smooth(0, 55, width - x),
      smooth(0, 16, y), smooth(0, 100, height - y));
    if (edge === 0) continue;
    cells.push({ x, y, index: Math.floor(y / step) * columns + Math.floor(x / step),
      fx: x / step % 1, fy: y / step % 1,
      grain: hash(Math.floor(x / GLYPH_WIDTH), Math.floor(y / GLYPH_HEIGHT)),
      edge, tick: -1, glyph: 0 });
  }
  const surface: RippleSurface = {
    bitmapWidth: canvas.width, bitmapHeight: canvas.height,
    width, height, ratio, step, columns, rows, cells,
    light: new Float32Array(columns * rows),
    scheme,
    ink: cached?.scheme === scheme ? cached.ink : '',
  };
  surfaces.set(canvas, surface);
  return surface;
}

/** Shimmering ASCII rows lit by an autonomous, slowly swelling wave field. */
export function drawHeroRipples(canvas: HTMLCanvasElement, elapsed: number,
  impulses: readonly HeroRippleImpulse[] = []): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const surface = surfaceOf(canvas, schemeOf(canvas));
  const { width, height, ratio, step, columns, rows, light } = surface;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (!width || !height) return;
  if (surface.ink === '') surface.ink = getComputedStyle(canvas).getPropertyValue('--ccd-hero-ripple-ink').trim();
  context.fillStyle = surface.ink;
  context.font = '10px monospace'; context.textBaseline = 'top';
  // Rasterize each glyph once at device density; frames only composite sprites.
  if (!surface.atlas && canvas.ownerDocument.createElement) {
    const atlas = canvas.ownerDocument.createElement('canvas');
    atlas.width = GLYPHS.length * GLYPH_WIDTH * ratio;
    atlas.height = GLYPH_HEIGHT * ratio;
    const ink = atlas.getContext('2d');
    if (ink) {
      ink.setTransform(ratio, 0, 0, ratio, 0, 0);
      ink.fillStyle = surface.ink;
      ink.font = context.font; ink.textBaseline = 'top';
      for (let i = 0; i < GLYPHS.length; i++) ink.fillText(GLYPHS[i]!, i * GLYPH_WIDTH, 0);
      surface.atlas = atlas;
    }
  }
  if (surface.atlas && !surface.layers) {
    const glyphs = canvas.ownerDocument.createElement('canvas');
    glyphs.width = canvas.width; glyphs.height = canvas.height;
    const mask = canvas.ownerDocument.createElement('canvas');
    mask.width = Math.ceil(width / GLYPH_WIDTH); mask.height = Math.ceil(height / GLYPH_HEIGHT);
    const glyphContext = glyphs.getContext('2d'), maskContext = mask.getContext('2d');
    if (glyphContext && maskContext?.createImageData) {
      glyphContext.setTransform(ratio, 0, 0, ratio, 0, 0);
      const pixels = maskContext.createImageData(mask.width, mask.height);
      // Only alpha changes; the mask's RGB remains white.
      pixels.data.fill(255);
      for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = 0;
      surface.layers = { glyphs, mask, context: glyphContext, maskContext, pixels };
    }
  }
  const layers = surface.layers;
  const frame = frameAt(elapsed, width, height);
  const fadeIn = smooth(0, 1.4, elapsed / 1000);
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    light[row * columns + col] = fieldAt(col * step, row * step, frame) * fadeIn;
  }
  // Add each click only inside its bounding box, rather than testing every
  // active click at every point of the full-screen ambient mesh.
  for (const click of clicksAt(elapsed, width, height, impulses)) {
    const reach = Math.sqrt(click.outerSquared) * click.scale;
    const left = Math.max(0, Math.ceil((click.x - reach) / step));
    const right = Math.min(columns - 1, Math.floor((click.x + reach) / step));
    const top = Math.max(0, Math.ceil((click.y - reach) / step));
    const bottom = Math.min(rows - 1, Math.floor((click.y + reach) / step));
    for (let row = top; row <= bottom; row++) for (let col = left; col <= right; col++) {
      light[row * columns + col]! += clickLightAt(col * step, row * step, click);
    }
  }
  for (const cell of surface.cells) {
    const { x, y, index, fx, fy, grain, edge } = cell;
    const illumination = mix(mix(light[index]!, light[index + 1]!, fx),
      mix(light[index + columns]!, light[index + columns + 1]!, fx), fy);
    const alpha = Math.min(.72, (.012 + grain * .013) * fadeIn
      + illumination * 1.65 * (.45 + .55 * grain)) * edge;
    if (layers) {
      const pixel = (Math.floor(y / GLYPH_HEIGHT) * layers.mask.width + Math.floor(x / GLYPH_WIDTH)) * 4 + 3;
      layers.pixels.data[pixel] = alpha > .006 ? Math.round(alpha * 255) : 0;
    }
    if (alpha <= .006) continue;
    const tick = Math.floor(elapsed / (300 + grain * 400) + grain * 17);
    const changed = tick !== cell.tick;
    if (changed) {
      cell.tick = tick;
      cell.glyph = Math.floor(hash(Math.floor(x / GLYPH_WIDTH) + tick * 1013,
        Math.floor(y / GLYPH_HEIGHT)) * GLYPHS.length);
    }
    if (layers && surface.atlas) {
      if (changed) {
        layers.context.clearRect(x, y, GLYPH_WIDTH, GLYPH_HEIGHT);
        layers.context.drawImage(surface.atlas, cell.glyph * GLYPH_WIDTH * ratio, 0,
          GLYPH_WIDTH * ratio, GLYPH_HEIGHT * ratio, x, y, GLYPH_WIDTH, GLYPH_HEIGHT);
      }
      continue;
    }
    context.globalAlpha = alpha;
    if (surface.atlas) {
      context.drawImage(surface.atlas, cell.glyph * GLYPH_WIDTH * ratio, 0,
        GLYPH_WIDTH * ratio, GLYPH_HEIGHT * ratio, x, y, GLYPH_WIDTH, GLYPH_HEIGHT);
    } else context.fillText(GLYPHS[cell.glyph]!, x, y);
  }
  context.globalAlpha = 1;
  if (layers) {
    layers.maskContext.putImageData(layers.pixels, 0, 0);
    context.drawImage(layers.glyphs, 0, 0, width, height);
    const smoothing = context.imageSmoothingEnabled;
    context.imageSmoothingEnabled = false;
    context.globalCompositeOperation = 'destination-in';
    context.drawImage(layers.mask, 0, 0,
      layers.mask.width * GLYPH_WIDTH, layers.mask.height * GLYPH_HEIGHT);
    context.globalCompositeOperation = 'source-over';
    context.imageSmoothingEnabled = smoothing;
  }
}
