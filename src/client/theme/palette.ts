/**
 * Colour arithmetic behind the configurable surfaces.
 *
 * The plugin ships one light palette; a user-supplied background therefore has
 * to bring its own hover, selection and line steps, or a dark canvas would keep
 * light grey rows. Every value here is derived from the two configured colours
 * with fixed ratios, so the result is deterministic and testable — and no other
 * stylesheet gains a literal colour (see `scripts/check-architecture.mjs`).
 *
 * The dark palette is not derived: it is a fixed set of values measured for the
 * dark canvas and mirrored by `theme/tokens.css`, because a colour the user
 * picked for a light canvas says nothing about the dark one.
 */

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** The surfaces a configured background produces. */
export interface Palette {
  readonly canvas: string;
  readonly sidebar: string;
  readonly card: string;
  readonly track: string;
  readonly raised: string;
  readonly hover: string;
  readonly selected: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly borderSoft: string;
  readonly tableHeadLine: string;
}

/**
 * Built-in surfaces, byte-identical to the fallback declarations in
 * `theme/tokens.css` (`--ccd-canvas`, `--ccd-sidebar`, `--ccd-border`); a local
 * test parses that stylesheet and fails when the two drift apart.
 */
export const BUILT_IN_SURFACES = Object.freeze({
  canvas: '#fcfcfb',
  sidebar: '#fbfbf9',
  border: '#e3e3e1',
});

/**
 * Built-in dark palette, byte-identical to the dark block of
 * `theme/tokens.css`; a local test parses that stylesheet and fails when the two
 * drift apart. Configured backgrounds do not reach this mode (see the file
 * comment), so the theme layer can publish these values as the `dark` side of
 * every surface pair.
 */
export const BUILT_IN_DARK: Palette = Object.freeze({
  canvas: '#151515',
  sidebar: '#111111',
  card: '#30302e',
  track: '#1f1e1d',
  raised: '#2f2f2d',
  hover: '#313130',
  selected: '#3a3a37',
  border: '#3e3e3b',
  borderStrong: '#474743',
  borderSoft: '#343431',
  tableHeadLine: '#4a4a46',
});

const WHITE: Rgb = Object.freeze({ r: 255, g: 255, b: 255 });
const BLACK: Rgb = Object.freeze({ r: 0, g: 0, b: 0 });

/* Ratios measured against the CCD reference screenshots; each is the share of
   ink (toward black) or light (toward white) mixed into the configured base. */
const HOVER_INK = 0.05;
const SELECTED_INK = 0.06;
const TRACK_INK = 0.04;
const RAISED_INK = 0.05;
const BORDER_INK = 0.10;
const BORDER_STRONG_INK = 0.11;
const BORDER_SOFT_INK = 0.07;
/* The rule under a table head is the one line the reference draws darker than
   the card outline, so it gets its own step. */
const TABLE_HEAD_LINE_INK = 0.14;
const CARD_LIGHT = 0.6;

const HEX = /^#([0-9a-f]{6})$/i;

/**
 * Parse one normalized `#rrggbb` colour.
 * @param value - the colour to parse.
 * @returns its channels, or undefined when it is not a six-digit hex colour.
 */
export function parseColour(value: string): Rgb | undefined {
  const match = HEX.exec(value.trim());
  const digits = match?.[1];
  if (digits === undefined) return undefined;
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  };
}

/**
 * Format channels as lowercase `#rrggbb`.
 * @param rgb - channels to format.
 * @returns the CSS colour.
 */
export function formatColour(rgb: Rgb): string {
  const channel = (value: number) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0');
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/**
 * Mix one colour toward another.
 * @param base - the colour being adjusted.
 * @param toward - the colour mixed in.
 * @param ratio - share of `toward`, from 0 to 1.
 * @returns the mixed colour.
 */
export function mixColour(base: Rgb, toward: Rgb, ratio: number): Rgb {
  const share = Math.min(1, Math.max(0, ratio));
  return {
    r: base.r + (toward.r - base.r) * share,
    g: base.g + (toward.g - base.g) * share,
    b: base.b + (toward.b - base.b) * share,
  };
}

/**
 * Derive every surface step from the two configured backgrounds.
 *
 * An empty or unusable value falls back to the built-in surface, so the theme
 * layer can call this with raw configuration and still get usable colours.
 * @param canvas - normalized conversation/canvas background, or empty.
 * @param sidebar - normalized sidebar background, or empty.
 * @returns the palette the theme layer publishes as tokens.
 */
export function derivePalette(canvas: string, sidebar: string): Palette {
  const canvasHex = parseColour(canvas) === undefined ? BUILT_IN_SURFACES.canvas : canvas;
  const sidebarHex = parseColour(sidebar) === undefined ? BUILT_IN_SURFACES.sidebar : sidebar;
  const base = parseColour(canvasHex) ?? { r: 252, g: 252, b: 251 };
  return Object.freeze({
    canvas: canvasHex,
    sidebar: sidebarHex,
    card: formatColour(mixColour(base, WHITE, CARD_LIGHT)),
    track: formatColour(mixColour(base, BLACK, TRACK_INK)),
    raised: formatColour(mixColour(base, BLACK, RAISED_INK)),
    hover: formatColour(mixColour(base, BLACK, HOVER_INK)),
    selected: formatColour(mixColour(base, BLACK, SELECTED_INK)),
    border: formatColour(mixColour(base, BLACK, BORDER_INK)),
    borderStrong: formatColour(mixColour(base, BLACK, BORDER_STRONG_INK)),
    borderSoft: formatColour(mixColour(base, BLACK, BORDER_SOFT_INK)),
    tableHeadLine: formatColour(mixColour(base, BLACK, TABLE_HEAD_LINE_INK)),
  });
}
