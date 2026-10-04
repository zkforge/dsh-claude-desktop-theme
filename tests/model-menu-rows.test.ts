import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * Model card row contract.
 *
 * The Composer's model seat opens this plugin's own card, not a host `Menu`, so
 * its cells answer to the popup section of the design document rather than to
 * the primitive: one row is 24px — a 13px label on a 20px line with 2px above
 * and below, the reference's 48 device px at @2x — where the card used to draw
 * the host's 34px cell (the same 13px label on `line-height: 1.4` under 8px of
 * block padding). The corner follows the height (6px), the heading above a
 * group is a cell of the same rhythm in the document's control-label size, and
 * the card's one editable face takes the stronger line an editable face gets in
 * this palette. `features/model-controls/controls.css` carries the geometry and
 * this test pins it; the chosen mark's accent ink is a tokens.css rule and is
 * pinned here too, because it is the other half of "selected, without a fill".
 */

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

interface Rule {
  readonly selector: string;
  readonly body: string;
}

/** Flat `selector { body }` pairs; nested at-rule wrappers are skipped. */
function rules(sheet: string): Rule[] {
  const source = sheet.replace(/\/\*[\s\S]*?\*\//gu, '');
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map(([, selector, body]) => ({
    selector: (selector ?? '').trim().replace(/\s+/gu, ' '),
    body: body ?? '',
  }));
}

/** The single rule whose selector ends with this one, so `.x button` cannot match `.x`. */
function ruleFor(sheet: readonly Rule[], selector: string): Rule {
  const found = sheet.filter(rule => rule.selector.endsWith(selector));
  assert.equal(found.length, 1, `expected one rule for ${selector}`);
  return found[0] as Rule;
}

/** The single rule whose selector is exactly this one, guard and all. */
function exactRule(sheet: readonly Rule[], selector: string): Rule {
  const found = sheet.filter(rule => rule.selector === selector);
  assert.equal(found.length, 1, `expected one rule for ${selector}`);
  return found[0] as Rule;
}

const controls = rules(read('../src/client/features/model-controls/controls.css'));
const tokens = rules(read('../src/client/theme/tokens.css'));

test('the card is the document’s popup surface', () => {
  const body = ruleFor(controls, '.ccd-model-panel, .ccd-model-error').body;
  assert.match(body, /border:\s*1px solid var\(--ccd-border\)/u);
  assert.match(body, /border-radius:\s*12px/u);
  assert.match(body, /background:\s*var\(--ccd-card\)/u);
  /* The three-layer hairline the transcript's own popups carry. */
  assert.match(body, /box-shadow:\s*var\(--ccd-effort-shadow\)/u);
  /* The card's measure is the document's 13px step, and it is the one place
     that decides it: the rows and the heading inherit from here. */
  assert.match(body, /font:\s*13px\//u);
});

test('one row is 24px: a 20px label line with 2px above and below', () => {
  const body = exactRule(controls, '.ccd-model-options button').body;
  /* Pinned against the box model rather than inherited from it: the button
     leaves `box-sizing` to the page, and under the content-box default the
     same declarations would build a 28px row. */
  assert.match(body, /box-sizing:\s*border-box/u);
  assert.match(body, /min-height:\s*24px/u);
  assert.match(body, /padding:\s*2px 8px/u);
  assert.match(body, /line-height:\s*20px/u);
  assert.match(body, /border-radius:\s*6px/u);
  /* The card's own 13px measure is the label's, and the row must not restate
     it: the panel's `font` shorthand is the one place that decides. */
  assert.ok(!/font-size/u.test(body), body);
  /* A row is a choice, not a box: its resting state is ink on the card. */
  assert.match(body, /background:\s*transparent/u);
  assert.match(body, /border:\s*0/u);
});

test('the row’s two states are the flat fill and the document’s focus ring', () => {
  const fills = controls.filter(rule => /background:\s*var\(--ccd-hover\)/u.test(rule.body)
    && rule.selector.includes('.ccd-model-options button'));
  assert.equal(fills.length, 1, 'one rule paints the row');
  for (const state of [':hover', ':focus-visible']) {
    assert.ok(fills[0]?.selector.includes(`.ccd-model-options button${state}`), fills[0]?.selector ?? '');
  }
  /* Keyboard focus needs more than the pointer's fill (§七), and the ring is a
     ring — not a second fill, border or shadow. */
  const ring = exactRule(controls, '.ccd-model-options button:focus-visible').body;
  assert.match(ring, /outline:\s*2px solid var\(--ccd-accent\)/u);
  assert.match(ring, /outline-offset:\s*2px/u);
  assert.ok(!/background|box-shadow|border/u.test(ring), ring);
});

test('the provider heading is a cell of the same rhythm, one size down', () => {
  const body = ruleFor(controls, '.ccd-model-provider').body;
  assert.match(body, /font-size:\s*12px/u);
  assert.match(body, /line-height:\s*20px/u);
  assert.match(body, /padding:\s*2px 8px/u);
  assert.match(body, /color:\s*var\(--ccd-text-secondary\)/u);
  /* A heading is not a choice: no fill, at rest or ever. */
  assert.ok(!/background|box-shadow/u.test(body), body);
});

test('the card’s one editable face takes the stronger line, not the card outline', () => {
  const search = ruleFor(controls, '.ccd-model-search').body;
  assert.match(search, /border:\s*1px solid var\(--ccd-border-strong\)/u);
  /* The field is a cell of the card's rhythm: the rows' 24px box and the
     corner that height asks for, not a banner twice their height. */
  assert.match(search, /height:\s*24px/u);
  assert.match(search, /border-radius:\s*6px/u);
  /* Without this the field is a content box under the page default and renders
     taller than the 24px the card is laid out around. */
  assert.match(search, /box-sizing:\s*border-box/u);
  assert.match(ruleFor(controls, '.ccd-model-search::placeholder').body, /color:\s*var\(--ccd-text-muted\)/u);
});

test('the cells that are not choices wear the rows’ geometry', () => {
  const body = ruleFor(controls, '.ccd-model-note').body;
  assert.match(body, /padding:\s*2px 8px/u);
  assert.match(body, /line-height:\s*20px/u);
  assert.match(body, /margin:\s*0/u);
  const retry = ruleFor(controls, '.ccd-model-retry').body;
  assert.match(retry, /color:\s*var\(--ccd-accent\)/u);
  /* The retry is a flat label: no box of its own, on the card or in the alert
     that floats above it. */
  assert.match(retry, /border:\s*0/u);
  assert.match(retry, /background:\s*none/u);
});

test('the chosen row is marked by the accent check alone', () => {
  /* No rule may paint a chosen row: not with a fill, and not with the same
     fill smuggled in through a shadow or a border. */
  const painted = controls.filter(rule => /background|box-shadow|border:|font-weight/u.test(rule.body)
    && /aria-pressed|aria-checked|data-active/u.test(rule.selector));
  assert.deepEqual(painted, []);
  const weights = controls.filter(rule => /font-weight/u.test(rule.body));
  assert.deepEqual(weights, []);
});

test('the card’s model names keep the chosen-value ink through the row’s cascade', () => {
  /* The Composer's tool row paints every button in it with secondary grey at
     0-2-2, so the card's rows only stay black under this guarded selector. */
  const ink = exactRule(controls,
    'html[data-dsh-ccd-style="true"] .ccd-model-controls .ccd-model-trigger,'
    + ' html[data-dsh-ccd-style="true"] .ccd-model-controls .ccd-effort-trigger,'
    + ' html[data-dsh-ccd-style="true"] .ccd-model-controls .ccd-model-options button').body;
  assert.match(ink, /color:\s*var\(--ccd-text-strong\)/u);
});

test('the chosen row’s mark is the accent check, on the seat that holds a glyph', () => {
  const accent = tokens.filter(rule => rule.selector.includes('.ccd-model-options button')
    && rule.body.includes('var(--ccd-accent)'));
  assert.equal(accent.length, 1, 'one rule recolours the card’s mark');
  const selector = accent[0]?.selector ?? '';
  assert.ok(selector.includes('button[aria-pressed="true"] > span[aria-hidden="true"]'), selector);
  assert.ok(selector.includes('span[aria-hidden="true"]:not(:empty)'), selector);
  /* Ink only: the rule must not turn the mark into a filled or weighted cell. */
  assert.ok(!/background|box-shadow|font-weight|border/u.test(accent[0]?.body ?? ''), accent[0]?.body ?? '');
});

