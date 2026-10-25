import { normalizeColour } from '../../../shared/config.ts';

export interface HSV {
  readonly h: number;
  readonly s: number;
  readonly v: number;
}

/** Picker coordinates use degrees for hue and unit intervals for the plane. */
export function colourToHSV(colour: string): HSV {
  const hex = normalizeColour(colour) || '#fcfcfb';
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const sector = delta === 0 ? 0 : max === r ? (g - b) / delta
    : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: (sector * 60 + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToColour({ h, s, v }: HSV): string {
  const channel = (offset: number) => {
    const k = (offset + h / 60) % 6;
    return Math.round(255 * v * (1 - s * Math.max(0, Math.min(k, 4 - k, 1))))
      .toString(16).padStart(2, '0');
  };
  return `#${channel(5)}${channel(3)}${channel(1)}`.toUpperCase();
}
