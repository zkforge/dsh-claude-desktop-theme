/** Click position in canvas-relative 0..1 coordinates, on the paused hero clock. */
export interface HeroRippleImpulse {
  readonly x: number;
  readonly y: number;
  readonly startedAt: number;
}

export const HERO_RIPPLE_DURATION = 2800;

export interface HeroPointer { readonly x: number; readonly y: number }

/** The space scene spans the hero and its caption strip in one coordinate system. */
export interface HeroSpaceRenderer {
  draw(canvas: HTMLCanvasElement, title: HTMLCanvasElement | null, elapsed: number,
    clicks: readonly HeroRippleImpulse[], pointer: HeroPointer | null): void;
}
