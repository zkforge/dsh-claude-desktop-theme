import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { adoptConfig, resolveConfig } from '../src/shared/config.ts';
import {
  BUILT_IN_DARK, BUILT_IN_SURFACES, derivePalette, formatColour, mixColour, parseColour,
} from '../src/client/theme/palette.ts';
import type { Rgb } from '../src/client/theme/palette.ts';
import { resolveThemeTokens } from '../src/client/theme/tokens.ts';

const tokensSheet = readFileSync(
  fileURLToPath(new URL('../src/client/theme/tokens.css', import.meta.url)),
  'utf8',
);

/*
 * The stylesheet carries two palettes in one file, so the fixtures below split
 * it the same way the cascade does: everything under the host's dark attribute
 * is the dark side, everything else is the light side.
 */
const DARK_BLOCK = /html\[data-dsh-ccd-style="true"\] body\[data-ds-dark-theme\]\s*\{([^}]*)\}/g;
const darkSheet = [...tokensSheet.matchAll(DARK_BLOCK)].map(match => match[1] ?? '').join('\n');
const lightSheet = tokensSheet.replace(DARK_BLOCK, '');

function declarations(sheet: string): Map<string, string> {
  return new Map([...sheet.matchAll(/--(ccd-[a-z0-9-]+):\s*([^;]+);/g)]
    .map(match => [match[1] ?? '', (match[2] ?? '').trim()]));
}

interface CssRule {
  readonly selector: string;
  readonly body: string;
}

/** Flat `selector { body }` pairs, comments removed. `tokens.css` nests nothing. */
function cssRules(sheet: string): CssRule[] {
  const source = sheet.replace(/\/\*[\s\S]*?\*\//gu, '');
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map(([, selector, body]) => ({
    selector: (selector ?? '').trim().replace(/\s+/gu, ' '),
    body: body ?? '',
  }));
}

const lightVars = declarations(lightSheet);
const darkVars = declarations(darkSheet);

function colour(map: Map<string, string>, name: string): string | undefined {
  return /^#[0-9a-f]{6}$/i.exec(map.get(name) ?? '')?.[0];
}

function declaredColour(name: string): string | undefined {
  return colour(lightVars, name);
}

function darkColour(name: string): string | undefined {
  return colour(darkVars, name);
}

function channels(map: Map<string, string>, name: string): Rgb {
  const value = colour(map, name);
  assert.ok(value !== undefined, `--${name} should be declared as a hex colour`);
  const rgb = parseColour(value);
  assert.ok(rgb !== undefined, `--${name} should parse`);
  return rgb;
}

function brightness(colour: string): number {
  const rgb = parseColour(colour);
  assert.ok(rgb !== undefined, `${colour} should parse`);
  return rgb.r + rgb.g + rgb.b;
}

/** WCAG relative luminance; enough to state "the text stays readable". */
function luminance(rgb: Rgb): number {
  const channel = (value: number) => {
    const share = value / 255;
    return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrast(foreground: Rgb, background: Rgb): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

test('the built-in surfaces agree with the stylesheet they fall back to', () => {
  assert.equal(declaredColour('ccd-canvas'), BUILT_IN_SURFACES.canvas);
  assert.equal(declaredColour('ccd-sidebar'), BUILT_IN_SURFACES.sidebar);
  assert.equal(declaredColour('ccd-border'), BUILT_IN_SURFACES.border);
});

test('a host-token alias is declared where the host writes its tokens', () => {
  /*
   * The theme presenter writes every `--dsw-*` value as an inline style on
   * `body`, so an alias declared anywhere above that element references a
   * variable which is not in scope *where it is declared*. Such a custom
   * property computes to the guaranteed-invalid value and inherits as invalid
   * into the whole subtree, and the rule consuming it falls back to
   * `transparent`: the empty-state context ring disappeared that way, having
   * aliased the host's ring track from the root block.
   */
  const aliases = cssRules(tokensSheet).filter(rule => /var\(--dsw-[a-z0-9-]+\)/u.test(rule.body));
  assert.ok(aliases.length > 0, 'the ring track still asks the host for its own track colour');
  for (const rule of aliases) {
    assert.match(rule.selector, /\bbody\b/u, `${rule.selector} aliases a host token it cannot see`);
  }
  const track = aliases.filter(rule => rule.body.includes('--ccd-context-ring-track'));
  assert.equal(track.length, 1, 'one body-scoped rule carries the ring track alias');
  assert.match(track[0]?.body ?? '', /--ccd-context-ring-track:\s*var\(--dsw-alias-border-l3\)/u);
});

test('the built-in dark palette agrees with the dark block it mirrors', () => {
  const names: Record<keyof typeof BUILT_IN_DARK, string> = {
    canvas: 'ccd-canvas',
    sidebar: 'ccd-sidebar',
    card: 'ccd-card',
    track: 'ccd-track',
    raised: 'ccd-raised',
    hover: 'ccd-hover',
    selected: 'ccd-selected',
    border: 'ccd-border',
    borderStrong: 'ccd-border-strong',
    borderSoft: 'ccd-border-soft',
    tableHeadLine: 'ccd-table-head-line',
  };
  for (const [key, name] of Object.entries(names)) {
    assert.equal(darkColour(name), BUILT_IN_DARK[key as keyof typeof BUILT_IN_DARK], `--${name} drifted`);
  }
});

test('every colour the light block declares has a dark counterpart', () => {
  const isColour = (value: string) => /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(value);
  const missing = [...lightVars].filter(([name, value]) => isColour(value) && !darkVars.has(name));
  assert.deepEqual(missing, [], 'the dark block leaves these tokens at their light value');
});

test('the dark palette keeps the light palette relationships', () => {
  const lightCanvas = channels(lightVars, 'ccd-canvas');
  const darkCanvas = channels(darkVars, 'ccd-canvas');
  assert.ok(brightness(darkColour('ccd-canvas') ?? '#000') < brightness(declaredColour('ccd-canvas') ?? '#fff'));
  /* The canvas is the lighter of the two page surfaces in both schemes, the
     card is the brightest surface in both, and the track is a groove in both. */
  assert.ok(luminance(darkCanvas) > luminance(channels(darkVars, 'ccd-sidebar')));
  assert.ok(luminance(channels(darkVars, 'ccd-card')) > luminance(darkCanvas));
  assert.ok(luminance(channels(lightVars, 'ccd-card')) > luminance(lightCanvas));
  assert.ok(luminance(darkCanvas) > luminance(channels(darkVars, 'ccd-track')));
  assert.ok(luminance(lightCanvas) > luminance(channels(lightVars, 'ccd-track')));
  assert.ok(luminance(channels(darkVars, 'ccd-card')) > luminance(channels(darkVars, 'ccd-track')));
  /* Body copy and secondary copy stay readable on their own canvas. */
  assert.ok(contrast(channels(darkVars, 'ccd-text'), darkCanvas) >= 7);
  assert.ok(contrast(channels(darkVars, 'ccd-text-secondary'), darkCanvas) >= 4.5);
  assert.ok(contrast(channels(lightVars, 'ccd-text'), lightCanvas) >= 7);
  assert.ok(contrast(channels(lightVars, 'ccd-text-secondary'), lightCanvas) >= 4.5);
  /* The head rule is the stronger line in both schemes. */
  assert.ok(brightness(darkColour('ccd-table-head-line') ?? '#000') > brightness(darkColour('ccd-border') ?? '#fff'));
  assert.ok(brightness(declaredColour('ccd-table-head-line') ?? '#fff') < brightness(declaredColour('ccd-border') ?? '#000'));
});

test('colour arithmetic is deterministic and stays in range', () => {
  assert.deepEqual(parseColour('#000000'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(parseColour('#ffffff'), { r: 255, g: 255, b: 255 });
  assert.equal(parseColour('#fff'), undefined);
  assert.equal(formatColour({ r: 300, g: -20, b: 127.6 }), '#ff0080');
  assert.deepEqual(mixColour({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 }, 0.5), { r: 127.5, g: 127.5, b: 127.5 });
  assert.deepEqual(parseColour(derivePalette('', '').canvas), parseColour(BUILT_IN_SURFACES.canvas));
  assert.deepEqual(parseColour(derivePalette('not-a-colour', '').canvas), parseColour(BUILT_IN_SURFACES.canvas));
});

test('an unconfigured plugin publishes the built-in pair for every host token', () => {
  const tokens = resolveThemeTokens(resolveConfig());
  assert.deepEqual(tokens['--dsw-alias-bg-base'], { light: '#fcfcfb', dark: BUILT_IN_DARK.canvas });
  assert.deepEqual(tokens['--dsw-specific-sidebar-fill'], { light: '#fbfbfa', dark: BUILT_IN_DARK.sidebar });
  assert.deepEqual(tokens['--dsw-alias-border-l3'], { light: '#e3e3e1', dark: BUILT_IN_DARK.border });
  assert.equal('--ccd-canvas' in tokens, false);
  assert.equal('--ccd-sidebar' in tokens, false);
  assert.equal('--dsw-font-family' in tokens, false);
  assert.equal('--ds-font-family-code' in tokens, false);
});

test('a configured canvas brings its own light steps and leaves the dark palette alone', () => {
  const tokens = resolveThemeTokens(adoptConfig({ appearance: { canvas: '#303030' } }));
  const base = '#303030';
  assert.deepEqual(tokens['--ccd-canvas'], { light: base, dark: BUILT_IN_DARK.canvas });
  assert.deepEqual(tokens['--dsw-alias-bg-base'], { light: base, dark: BUILT_IN_DARK.canvas });
  /* The dark side is never derived from a light-canvas choice: every token
     carries the built-in dark value, and a local test pins that palette to the
     dark block of the stylesheet. */
  const darkNames: Record<string, keyof typeof BUILT_IN_DARK> = {
    '--ccd-card': 'card',
    '--ccd-track': 'track',
    '--ccd-raised': 'raised',
    '--ccd-hover': 'hover',
    '--ccd-selected': 'selected',
    '--ccd-border': 'border',
    '--ccd-border-strong': 'borderStrong',
    '--ccd-border-soft': 'borderSoft',
    '--ccd-table-head-line': 'tableHeadLine',
  };
  for (const [name, key] of Object.entries(darkNames)) {
    assert.deepEqual(tokens[name]?.dark, BUILT_IN_DARK[key], `${name} should carry the built-in dark value`);
  }
  for (const name of ['--ccd-hover', '--ccd-selected', '--ccd-track', '--ccd-raised', '--ccd-border', '--ccd-border-strong', '--ccd-border-soft', '--ccd-table-head-line']) {
    const value = tokens[name]?.light;
    assert.ok(typeof value === 'string' && value.startsWith('#'), `${name} should be a colour`);
    assert.ok(brightness(value) < brightness(base), `${name} should step away from the base`);
  }
  assert.ok(brightness(tokens['--ccd-card']?.light ?? base) > brightness(base), 'the card sits above the canvas');
  assert.equal('--ccd-sidebar' in tokens, false);
  assert.deepEqual(tokens['--dsw-specific-sidebar-fill'], { light: '#fbfbfa', dark: BUILT_IN_DARK.sidebar });
});

test('a configured sidebar stays independent of the canvas in both schemes', () => {
  const tokens = resolveThemeTokens(adoptConfig({ appearance: { sidebar: '#f0eee9' } }));
  assert.deepEqual(tokens['--ccd-sidebar'], { light: '#f0eee9', dark: BUILT_IN_DARK.sidebar });
  assert.deepEqual(tokens['--dsw-specific-sidebar-fill'], { light: '#f0eee9', dark: BUILT_IN_DARK.sidebar });
  assert.equal('--ccd-canvas' in tokens, false);
  assert.deepEqual(tokens['--dsw-alias-border-l3'], { light: BUILT_IN_SURFACES.border, dark: BUILT_IN_DARK.border });
});

test('typefaces compose in fallback order and reach both host tokens in both schemes', () => {
  const tokens = resolveThemeTokens(adoptConfig({
    fonts: { uiLatin: 'Newsreader', uiCjk: 'PingFang SC', code: 'JetBrains Mono' },
  }));
  const ui = '"Newsreader", "PingFang SC", var(--ccd-font-fallback)';
  const code = '"JetBrains Mono", var(--ccd-code-fallback)';
  assert.deepEqual(tokens['--dsw-font-family'], { light: ui, dark: ui });
  assert.deepEqual(tokens['--ccd-font-ui'], { light: ui, dark: ui });
  assert.deepEqual(tokens['--ds-font-family-code'], { light: code, dark: code });
  assert.deepEqual(tokens['--ccd-font-code'], { light: code, dark: code });
});

test('one configured family still composes a complete stack', () => {
  const tokens = resolveThemeTokens(adoptConfig({ fonts: { uiCjk: '思源黑体' } }));
  assert.deepEqual(tokens['--dsw-font-family'], {
    light: '"思源黑体", var(--ccd-font-fallback)',
    dark: '"思源黑体", var(--ccd-font-fallback)',
  });
  assert.equal('--ds-font-family-code' in tokens, false);
});

test('both configuration sections travel in one override layer', () => {
  const tokens = resolveThemeTokens(adoptConfig({
    appearance: { canvas: '#101418', sidebar: '#0c1014' },
    fonts: { code: 'Fira Code' },
  }));
  assert.deepEqual(tokens['--ccd-sidebar'], { light: '#0c1014', dark: BUILT_IN_DARK.sidebar });
  assert.deepEqual(tokens['--dsw-alias-bg-base'], { light: '#101418', dark: BUILT_IN_DARK.canvas });
  assert.equal(typeof tokens['--dsw-font-family'], 'undefined');
  assert.equal(typeof tokens['--ds-font-family-code'], 'object');
});
