/**
 * The two View switcher glyphs, bundled as trusted static markup.
 *
 * Drawn to the reference's own segments (docs/issues/img/todo-sidebar-sessions-target.webp,
 * @2x): a pair of speech bubbles for the chat View and the `</>` pair for the
 * trajectory View, both on the CCD 16 grid — 1–1.2px stroke (each glyph's own
 * weight read off the reference), round caps and joins, `currentColor` ink,
 * ink box ≈ 12.5 × 11px inside the 16px artwork.
 */
export const VIEW_SWITCH_ICONS = Object.freeze({
  chat: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n  <path d=\"M10.4 8.3a2.6 2.6 0 0 1-2.6 2.6H5.7L3.3 12.5V5.9a2.6 2.6 0 0 1 2.6-2.6h1.9a2.6 2.6 0 0 1 2.6 2.6Z\"/>\n  <path d=\"M10.3 5.9H12.1a2.1 2.1 0 0 1 2.1 2.1V10.4a2.1 2.1 0 0 1-2.1 2.1H10.25L9.1 13.1\"/>\n</svg>",
  trajectory: "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\" width=\"16\" height=\"16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">\n  <path d=\"M5.3 5.8 3.05 8l2.25 2.2\"/>\n  <path d=\"M9.1 3.8 6.9 12.2\"/>\n  <path d=\"M10.7 5.8 12.95 8l-2.25 2.2\"/>\n</svg>",
});
