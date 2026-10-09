import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * The context panel's contract.
 *
 * The panel replaces DSH's 264px three-row popup with the supplied reference's
 * two states: **collapsed** — a header line over a 4px segmented bar — and
 * **expanded**, which adds the category rows and one drill-down group per
 * category that has rows. There is deliberately no button at the bottom; the
 * header line is the whole affordance, which is what the reference carries once
 * its own `See detailed breakdown` control is taken away.
 *
 * The geometry is the reference's, measured at @2x and recorded in
 * `docs/plan-context-breakdown-panel.md` §2, and it lives in two places: the
 * numbers in `theme/tokens.css` (the only file allowed to carry a literal
 * colour) and the rules in `features/context-panel/context-panel.css`. The
 * words and the two states come from `ContextPanel.tsx`. All three are pinned
 * here, because together they are what "the context breakdown panel" means.
 */

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

/** The light block, the dark block, and the whole sheet. */
const tokens = read('../src/client/theme/tokens.css');
const sheet = read('../src/client/features/context-panel/context-panel.css');
const card = read('../src/client/features/context-panel/ContextPanel.tsx');
const shared = read('../src/shared/context.ts');

/** One token's value, from the light block or the dark one. */
function token(name: string, dark = false): string {
  const at = dark ? tokens.indexOf('body[data-ds-dark-theme]') : 0;
  const source = dark ? tokens.slice(at) : tokens.slice(0, tokens.indexOf('body[data-ds-dark-theme]'));
  const match = new RegExp(`--${name}:\\s*([^;]+);`, 'u').exec(source);
  assert.ok(match, `--${name} is declared ${dark ? 'for the dark palette' : 'for the light palette'}`);
  return (match[1] ?? '').trim();
}

test('the panel is the reference’s card, at the reference’s measurements', () => {
  /* 360px is the reference's own rounded width: its crop cut the right edge off
     at 349 CSS px, and the bar and the percentage column both end exactly where
     360 − 2 (outline) − 24 (padding) puts them. */
  assert.equal(token('ccd-context-panel-width'), '360px');
  assert.equal(token('ccd-context-panel-radius'), '12px');
  assert.equal(token('ccd-context-panel-padding-block'), '8px');
  assert.equal(token('ccd-context-panel-padding-inline'), '12px');
  /* 8 device px of bar at @2x, 38 device px between value rows, 34 between
     detail rows, 20 device px swatches. */
  assert.equal(token('ccd-context-bar-height'), '4px');
  assert.equal(token('ccd-context-bar-gap'), '1px');
  assert.equal(token('ccd-context-bar-reserve-gap'), '4px');
  assert.equal(token('ccd-context-row-height'), '19px');
  assert.equal(token('ccd-context-detail-height'), '17px');
  assert.equal(token('ccd-context-swatch-size'), '10px');
  /* The percentage column's right edge is the content edge; the token column's
     own right edge then lands 40 + 8 = 48px in, which is the reference's own
     618-of-715 device-pixel line. */
  assert.equal(token('ccd-context-percent-width'), '40px');
  assert.equal(token('ccd-context-column-gap'), '8px');

  assert.match(sheet, /\.ccd-context-panel:popover-open\s*\{[^}]*display: block/u);
  assert.match(sheet, /border-radius: var\(--ccd-context-panel-radius\)/u);
  assert.match(sheet, /border: 1px solid var\(--ccd-view-menu-border\)/u);
  /* The reserved grey steps 4px away from the used group where every used
     segment is 1px apart. */
  assert.match(sheet, /\.ccd-context-seg-autocompact\s*\{[^}]*margin-left: calc\(var\(--ccd-context-bar-reserve-gap\) - var\(--ccd-context-bar-gap\)\)/u);
});

test('the bar weighs segments by tokens rather than by a percentage column', () => {
  /* The rows deliberately do not sum to the window — the sampled reading and
     the heuristic tree are two different measures — so the free weight is
     measured against the window instead of summed from the rows. */
  assert.match(shared, /export function barSegments\(/u);
  assert.match(shared, /Math\.max\(0, breakdown\.window - placed\)/u);
  assert.match(card, /barSegments\(breakdown, barWidth\)/u);
  assert.match(card, /style=\{\{ flexGrow: entry\.tokens \}\}/u);
  /* The bar's own background is the free-space track, so the track element is
     there for the weights, not for a fill of its own. */
  assert.match(sheet, /\.ccd-context-bar\s*\{[^}]*background: var\(--ccd-context-free\)/u);
  assert.match(sheet, /\.ccd-context-track\s*\{[^}]*border-radius: 0/u);
});

test('every category has its own colour in both palettes', () => {
  /* The slice key the panel draws, and the token its colour lives in. The
     reserved grey is the one pair that differs: the row is `autocompact` and
     the token is `buffer`. */
  const categories: readonly (readonly [string, string])[] = [
    ['mcp', 'mcp'], ['tools', 'tools'], ['system', 'system'], ['skills', 'skills'],
    ['memory', 'memory'], ['messages', 'messages'], ['autocompact', 'buffer'], ['free', 'free'],
  ];
  for (const [key, name] of categories) {
    const light = token(`ccd-context-${name}`);
    const dark = token(`ccd-context-${name}`, true);
    assert.match(light, /^#[0-9a-f]{6}$/u, `${name} light`);
    assert.match(dark, /^#[0-9a-f]{6}$/u, `${name} dark`);
    assert.notEqual(light, dark, `${name} must be retinted for the dark canvas`);
    /* The bar segment and the row swatch are one category, so both rules
       exist — except for free space, which is the bar's own background rather
       than a segment and so has the swatch rule alone. */
    assert.ok(sheet.includes(`.ccd-context-swatch-${key} { background: var(--ccd-context-${name}); }`), `swatch ${key}`);
    if (key === 'free') {
      assert.ok(!sheet.includes('.ccd-context-seg-free'), 'the free space is the track, not a segment');
      continue;
    }
    assert.ok(sheet.includes(`.ccd-context-seg-${key} { background: var(--ccd-context-${name}); }`), `segment ${key}`);
  }
  /* The five sampled hues, to the reference's own pixels. */
  assert.equal(token('ccd-context-mcp'), '#2a78d8');
  assert.equal(token('ccd-context-tools'), '#e96a33');
  assert.equal(token('ccd-context-system'), '#1ead7c');
  assert.equal(token('ccd-context-skills'), '#eda105');
  assert.equal(token('ccd-context-memory'), '#ea7ca4');
  assert.equal(token('ccd-context-buffer'), '#c2c0b8');
  /* Free space and the bar's track are the same surface in the reference. */
  assert.equal(token('ccd-context-free'), '#eeeeee');
});

test('the header line is the whole affordance, and there is no button under it', () => {
  assert.match(card, /data-ccd-context-head=""/u);
  assert.match(card, /aria-expanded=\{expanded\}/u);
  assert.match(card, /onClick=\{\(\) => \{ port\.toggleExpanded\(\); \}\}/u);
  assert.match(card, /data-ccd-context-chevron=\{open \? 'open' : 'closed'\}/u);
  assert.match(sheet, /\.ccd-context-chevron\[data-ccd-context-chevron='open'\]\s*\{[^}]*transform: rotate\(90deg\)/u);
  /* The reference's own bottom control is deliberately absent. The card has
     exactly two controls — the header line and a group head per drill-down —
     and the decision itself is recorded in the plan, which is where a reader
     who wonders why the reference has a button and this panel does not will
     look. */
  const markup = card.replace(/\/\*[\s\S]*?\*\//gu, '');
  assert.equal([...markup.matchAll(/<button/gu)].length, 2, 'the header line and the group heads');
  assert.doesNotMatch(markup, /See detailed breakdown/u);
  assert.doesNotMatch(markup, /ccd-context-action/u);
  assert.doesNotMatch(sheet, /ccd-context-action/u);
  assert.match(read('../docs/plan-context-breakdown-panel.md'), /不做底部按钮/u);
});

test('the panel opens collapsed and the expansion never outlives it', () => {
  /* `expanded` is the driver's, not the card's: a reopened panel has to start
     collapsed again, and a card that kept its own copy could not promise that. */
  assert.doesNotMatch(card, /useState\([^)]*expand/u);
  assert.match(card, /const \{ open, anchor, breakdown, expanded \} = state;/u);
  assert.match(card, /\{expanded && breakdown !== null && \(/u);
  assert.match(card, /if \(!open\) return null;/u);
});

test('the rows are the reference’s, in the reference’s order', () => {
  /* The bar's order and the rows' order are one order: blue, orange, green,
     amber, pink, the conversation, the reserved grey, then the empty track. */
  const order = [...shared.matchAll(/slice\('(\w+)',/gu)].map(([, key]) => key);
  assert.deepEqual(order, ['mcp', 'tools', 'system', 'skills', 'memory', 'messages', 'autocompact', 'free']);
  for (const key of order) assert.ok(card.includes(`${key}:`), `the card names the ${key} row`);
});

test('a drill-down group is drawn only for a category that has rows', () => {
  assert.match(card, /const GROUP_SOURCES = \[/u);
  for (const key of ['mcp', 'tools', 'skills', 'memory']) {
    assert.ok(card.includes(`{ key: '${key}',`), `group ${key}`);
  }
  assert.match(card, /if \(rows\.length === 0\) continue;/u);
  /* A session with a hundred tools keeps the reference's own visible run and
     scrolls inside the group rather than growing the card. */
  assert.match(sheet, /\.ccd-context-detail\s*\{[^}]*max-height: var\(--ccd-context-detail-max\)/u);
  assert.match(sheet, /\.ccd-context-detail\s*\{[^}]*overflow-y: auto/u);
});

test('the card is a dialog with the reference’s two dismissal rules', () => {
  assert.match(card, /role="dialog"/u);
  assert.match(card, /aria-label=\{copy\.title\}/u);
  assert.match(card, /document\.addEventListener\('pointerdown', onPointer, true\)/u);
  assert.match(card, /document\.addEventListener\('keydown', onKey, true\)/u);
  assert.match(card, /if \(anchor instanceof HTMLElement\) anchor\.focus\(\);/u);
  assert.match(card, /if \(event\.key !== 'Tab'\) return;/u);
  /* It hangs 8px above the ring's own box and is clamped 12px into the
     viewport, which is the reference's own gap and margin. */
  assert.match(card, /const top = Math\.max\(12, Math\.min\(a\.top - p\.height - 8, window\.innerHeight - p\.height - 12\)\);/u);
});

test('both languages carry the whole table', () => {
  const keys = [...card.matchAll(/^\s{4}(\w+): '([^']*)',$/gmu)].map(([, key]) => key);
  for (const key of ['title', 'waiting', 'expand', 'collapse']) {
    assert.ok(keys.includes(key), `copy.${key}`);
  }
  const zh = card.slice(card.indexOf('zh: {'), card.indexOf('en: {'));
  const en = card.slice(card.indexOf('en: {'));
  for (const row of ['mcp', 'tools', 'system', 'skills', 'memory', 'messages', 'autocompact', 'free']) {
    assert.ok(zh.includes(`${row}: '`), `zh row ${row}`);
    assert.ok(en.includes(`${row}: '`), `en row ${row}`);
  }
  assert.match(card, /language\.startsWith\('zh'\) \? COPY\.zh : COPY\.en/u);
});

test('the switch mounts the panel beside the other overlay surfaces', () => {
  const assembly = read('../src/client/apply.ts');
  assert.match(assembly, /import \{ mountContextPanel \} from '\.\/features\/context-panel\/mount\.ts'/u);
  assert.match(assembly, /if \(next\.features\['context-panel'\]\) \{\s*mountContextPanel\(ctx, environment, scope\);/u);
  const mount = read('../src/client/features/context-panel/mount.ts');
  assert.match(mount, /DSH_SLOTS\.shellOverlay/u);
  assert.match(mount, /id: 'ccd-context-panel', order: CONTEXT_PANEL_ORDER/u);
  assert.match(mount, /const CONTEXT_PANEL_ORDER = 40;/u);
  /* A build without the session list keeps DSH's own panel rather than a card
     with nothing in it. */
  assert.match(mount, /if \(projections === null\)/u);
});

test('the driver’s marker is what keeps the host’s panel out of the paint', () => {
  const driver = read('../src/client/compat/context-panel.ts');
  assert.match(driver, /export const OPEN_MARKER = 'data-ccd-context-open';/u);
  /* `visibility` rather than `display`: the host's anchored-position hook
     measures the panel's box, and `display: none` would take it away. */
  assert.match(sheet, /html\[data-dsh-ccd-style="true"\]\[data-ccd-context-open\] \.y0jqnG_panel\s*\{[^}]*visibility: hidden/u);
  assert.doesNotMatch(sheet, /\[data-ccd-context-open\][^}]*display: none/u);
  /* The marker is the belt; the interception is the mechanism. */
  assert.match(driver, /found\.addEventListener\('click', onClick, true\)/u);
  assert.match(driver, /event\.stopPropagation\(\)/u);
});
