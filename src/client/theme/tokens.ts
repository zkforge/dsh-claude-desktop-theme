import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client';
import type { StyleConfig } from '../../shared/config.ts';
import { BUILT_IN_DARK, BUILT_IN_SURFACES, derivePalette } from './palette.ts';

/**
 * Compose host semantic tokens and configured --ccd-* overrides as light/dark
 * pairs. The theme presenter writes the active values onto body. Configured
 * backgrounds affect light mode; dark mode uses the built-in palette. Font
 * choices apply to both schemes. Other values come from theme/tokens.css.
 */
export const THEME_OVERRIDE_SOURCE = 'dsh-ccd-style';

/** Host semantic surfaces the CCD canvas replaces. */
export const HOST_SURFACE_TOKENS = Object.freeze({
  base: '--dsw-alias-bg-base',
  sidebar: '--dsw-specific-sidebar-fill',
  border: '--dsw-alias-border-l3',
});

/** Host typography tokens; both drive app-wide stacks. */
export const HOST_FONT_TOKENS = Object.freeze({
  ui: '--dsw-font-family',
  code: '--ds-font-family-code',
});

/**
 * Fallback tails live in `theme/tokens.css` next to the built-in stacks, so the
 * composed value references them instead of copying a font list into TypeScript.
 */
const UI_FALLBACK = 'var(--ccd-font-fallback)';
const CODE_FALLBACK = 'var(--ccd-code-fallback)';

interface TokenModes { readonly light: string; readonly dark: string }

function pair(light: string, dark: string): TokenModes {
  return { light, dark };
}

/** A scheme-invariant value: the same string on both sides of the pair. */
function both(value: string): TokenModes {
  return { light: value, dark: value };
}

/** One family name per entry, in fallback order, closed by the built-in tail. */
function composeStack(names: readonly string[], fallback: string): string {
  return [...names.map(name => `"${name}"`), fallback].join(', ');
}

function surfaceTokens(config: StyleConfig): Record<string, TokenModes> {
  const { canvas, sidebar } = config.appearance;
  const palette = derivePalette(canvas, sidebar);
  const dark = BUILT_IN_DARK;
  const tokens: Record<string, TokenModes> = {
    [HOST_SURFACE_TOKENS.base]: pair(palette.canvas, dark.canvas),
    [HOST_SURFACE_TOKENS.sidebar]: pair(palette.sidebar, dark.sidebar),
    /* The built-in border is measured against the built-in canvas; only a
       configured canvas brings its own line steps, so configuring the sidebar
       alone leaves every other built-in value byte for byte. */
    [HOST_SURFACE_TOKENS.border]: pair(
      canvas === '' ? BUILT_IN_SURFACES.border : palette.border,
      dark.border,
    ),
  };
  if (canvas !== '') {
    tokens['--ccd-canvas'] = pair(palette.canvas, dark.canvas);
    tokens['--ccd-card'] = pair(palette.card, dark.card);
    tokens['--ccd-track'] = pair(palette.track, dark.track);
    tokens['--ccd-raised'] = pair(palette.raised, dark.raised);
    tokens['--ccd-hover'] = pair(palette.hover, dark.hover);
    tokens['--ccd-hover-strong'] = pair(palette.hoverStrong, dark.hoverStrong);
    tokens['--ccd-selected'] = pair(palette.selected, dark.selected);
    tokens['--ccd-border'] = pair(palette.border, dark.border);
    tokens['--ccd-border-strong'] = pair(palette.borderStrong, dark.borderStrong);
    tokens['--ccd-border-soft'] = pair(palette.borderSoft, dark.borderSoft);
    tokens['--ccd-table-head-line'] = pair(palette.tableHeadLine, dark.tableHeadLine);
  }
  if (sidebar !== '') tokens['--ccd-sidebar'] = pair(palette.sidebar, dark.sidebar);
  return tokens;
}

function fontTokens(config: StyleConfig): Record<string, TokenModes> {
  const { uiLatin, uiCjk, code } = config.fonts;
  const tokens: Record<string, TokenModes> = {};
  if (uiLatin !== '' || uiCjk !== '') {
    const stack = composeStack([uiLatin, uiCjk].filter(name => name !== ''), UI_FALLBACK);
    tokens[HOST_FONT_TOKENS.ui] = both(stack);
    tokens['--ccd-font-ui'] = both(stack);
  }
  if (code !== '') {
    const stack = composeStack([code], CODE_FALLBACK);
    tokens[HOST_FONT_TOKENS.code] = both(stack);
    tokens['--ccd-font-code'] = both(stack);
  }
  return tokens;
}

/**
 * Resolve the whole override layer for one configuration.
 * @param config - the adopted configuration section.
 * @returns token overrides keyed by custom-property name; never empty, because
 * the host surface tokens always travel with the plugin's own canvas.
 */
export function resolveThemeTokens(config: StyleConfig): ThemeTokenOverrides {
  return { ...surfaceTokens(config), ...fontTokens(config) };
}
