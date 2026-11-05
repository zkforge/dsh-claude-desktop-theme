import { ASTRONAUT_WIDTH, ASTRONAUT_HEIGHT } from './astronaut.ts';

/** Geometry of the claude.dev footer at full reveal, in CSS pixels. */
export const SPACING = 9;
const SMALL = .15 * SPACING;
const LARGE = .267 * SPACING;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const smooth = (n: number) => n * n * (3 - 2 * n);

function hash(x: number, y: number, seed: number): number {
  let bits = (0x165667b1 * x + 0x27d4eb2f * y + 69069 * seed) | 0;
  bits = Math.imul(bits ^ (bits >>> 13), 0x4bf19f61);
  return ((bits ^ (bits >>> 16)) >>> 0) / 0x100000000;
}

function noise(x: number, y: number, seed: number): number {
  const col = Math.floor(x), row = Math.floor(y);
  const u = smooth(x - col), v = smooth(y - row);
  const a = hash(col, row, seed), b = hash(col + 1, row, seed);
  const c = hash(col, row + 1, seed), d = hash(col + 1, row + 1, seed);
  const top = a + (b - a) * u;
  return top + (c + (d - c) * u - top) * v;
}

/** Noise slices change every few seconds. Only the interpolation runs per paint. */
class Drift {
  private slice = -1;
  private from = 0;
  private to = 0;
  private x: number;
  private y: number;
  private seed: number;
  constructor(x: number, y: number, seed: number) {
    this.x = x; this.y = y; this.seed = seed;
  }
  at(time: number, blend: number): number {
    const slice = Math.floor(time);
    if (slice !== this.slice) {
      this.from = slice === this.slice + 1 && this.slice >= 0 ? this.to
        : noise(this.x, this.y, this.seed ^ Math.imul(slice, 0x9e3779b1));
      this.to = noise(this.x, this.y, this.seed ^ Math.imul(slice + 1, 0x9e3779b1));
      this.slice = slice;
    }
    return this.from + (this.to - this.from) * blend;
  }
}

export function createSpaceField(width: number, height: number, seed: number) {
  const size = Math.min(width, height);
  const moon = Math.min(Math.max(52, .115 * size), .3 * size);
  const moonX = Math.max(.14 * width, 1.1 * moon), moonY = Math.max(.3 * height, 1.1 * moon);
  const planet = Math.min(Math.max(60, .15 * size), .19 * size);
  type Dot = { x: number; y: number; clearance: number; fixed: number } & (
    { cloud: null } | { cloud: Drift; grain: Drift; speck: number; bias: number }
  );
  const dots: Dot[] = [];

  for (let row = 0, y = (height % SPACING + SPACING) / 2; y < height; row++, y += SPACING) {
    for (let col = 0, x = (width % SPACING + SPACING) / 2; x < width; col++, x += SPACING) {
      const random = (salt: number) => hash(col, row, seed ^ salt);
      const moonDist = Math.hypot(x - moonX, y - moonY);
      const cut = Math.hypot(x - moonX - .45 * moon, y - moonY);
      let fixed = 0;
      if (moonDist < moon && cut >= .92 * moon) {
        fixed = moon - moonDist > Math.max(.12 * moon, .9 * SPACING)
          && cut - .92 * moon > Math.max(.18 * .92 * moon, .9 * SPACING) ? LARGE : SMALL;
      } else if (moonDist < 2.2 * moon && random(12295) > smooth(clamp((moonDist / moon - 1.4) / .8))) {
        continue;
      } else {
        const dx = x - .8 * width, dy = y - (height - .66 * planet);
        const dist = Math.hypot(dx, dy);
        const along = .949235418 * dx + .314566561 * dy;
        const across = -.314566561 * dx + .949235418 * dy;
        const ring = Math.hypot(along / (1.75 * planet), across / (.32 * planet));
        const tip = Math.abs(along) / (1.75 * planet);
        const ringDot = ring > .8 && ring < 1.2 && !(tip > .9 && random(37191) < (tip - .9) * 9)
          ? (Math.abs(ring - 1) < .16 ? LARGE : SMALL) : 0;
        if (across > 0 && ringDot) fixed = ringDot;
        else if (across > 0 && dist < planet && Math.abs(ring - 1) < .34) continue;
        else if (dist < planet) {
          const edge = 1 - dist / planet;
          if (edge < .05 && random(1812) > (edge / .05) ** 1.4) continue;
          fixed = SMALL;
          if (planet - dist >= Math.max(.1 * planet, .9 * SPACING)) {
            const shade = .5 - (.28 * dx + .82 * dy) / (2 * planet)
              + (noise(col / 3.1, row / 3.1, seed ^ 2458) - .5) * .35;
            if (shade < .18) continue;
            if (shade > .82) fixed = LARGE;
          }
        } else if (ringDot) fixed = ringDot;
        else {
          const margin = Math.min(dist / (1.18 * planet), ring / 1.24);
          if (margin < 1.32 && (margin < 1 || random(30634) > smooth((margin - 1) / .32))) continue;
        }
      }
      if (!fixed && random(170) > 1.15 * (.2 + .8 * y / height)) continue;
      const base = { x, y, clearance: random(3098), fixed };
      if (fixed) {
        dots.push({ ...base, cloud: null });
        continue;
      }
      const band = noise(col / 8.4, row / 8.4, seed ^ 273);
      const grain = band < .38 ? new Drift(col / 9, row / 1.3, seed ^ 819)
        : band < .52 ? new Drift(col / 1.3, row / 9, seed ^ 1092)
        : band < .62 ? new Drift((col + row) / 7, (col - row) / 1.4, seed ^ 1365)
        : new Drift(col / 2.6, row / 2.6, seed ^ 1638);
      dots.push({ ...base, cloud: new Drift(col / 5.292, row / 5.292, seed ^ 546),
        grain, speck: random(1911), bias: .2 * random(2184) });
    }
  }
  return (time: number, petX: number, petY: number, plot: (x: number, y: number, radius: number) => void) => {
    const phase = .22 * time;
    const grainBlend = smooth(phase % 1), cloudBlend = smooth((phase / 2) % 1);
    for (const dot of dots) {
      const distance = Math.max(Math.abs(dot.x - petX) - ASTRONAUT_WIDTH / 2,
        petY - ASTRONAUT_HEIGHT / 2 + 2 * SPACING - dot.y, dot.y - petY - ASTRONAUT_HEIGHT / 2) / SPACING;
      if (distance <= 7 && dot.clearance > smooth(clamp((distance - 1) / 6))) continue;
      if (!dot.cloud) { plot(dot.x, dot.y, dot.fixed); continue; }
      const intensity = (.74 * dot.grain.at(phase, grainBlend) + dot.bias)
        * (.12 + 1.15 * dot.cloud.at(phase / 2, cloudBlend) ** 1.5);
      const threshold = .62 - .34 * .42;
      if (intensity < threshold) {
        if (dot.speck > .988) plot(dot.x, dot.y, SMALL * (.7 + 25 * (dot.speck - .988)));
      } else {
        const weight = smooth(clamp((intensity - threshold) / .23));
        plot(dot.x, dot.y, .6 + (LARGE - .6) * weight + (dot.speck > .9985 ? .6 * (1 + weight) : 0));
      }
    }
  };
}
