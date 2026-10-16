/** Click position in canvas-relative 0..1 coordinates, on the paused hero clock. */
export interface HeroRippleImpulse {
  readonly x: number;
  readonly y: number;
  readonly startedAt: number;
}

export const HERO_RIPPLE_DURATION = 2800;
