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
 * the card's one editable face is a chrome-free cell with a single hairline
 * under it rather than a framed box — a cell that bleeds to the card's edges,
 * so its inline padding is stated against the rows' rather than on its own.
 * `features/model-controls/controls.css`
 * carries the geometry and this test pins it; the chosen row is a fill from
 * that sheet plus the accent mark's ink, and a tokens.css rule carries the ink
 * half, so both halves are pinned here.
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

/** One declaration's value from a rule body, trimmed. */
function declared(body: string, property: string): string {
  const found = new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`, 'u').exec(body)?.[1];
  assert.ok(found !== undefined, `${property} is not declared in ${body}`);
  return found.trim();
}

/** A box shorthand's inline (left/right) value, in px: `2px 8px` → 8, `0 -6px 4px` → -6. */
function inlineOf(body: string, property: 'padding' | 'margin'): number {
  const parts = declared(body, property).split(/\s+/u).map(Number.parseFloat);
  const inline = parts.length === 1 ? parts[0] : parts[1];
  assert.ok(Number.isFinite(inline), `${property} declares no inline value in ${body}`);
  return inline as number;
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

test('the pointer’s state is the flat fill and the keyboard’s is the document’s focus ring', () => {
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

test('the card’s search cell is a bare line, not a box', () => {
  const search = ruleFor(controls, '.ccd-model-search').body;
  /* No frame, no fill, no corner: the reference's own search row is a bare
     cell with one hairline under it, which is the pair the user asked for. */
  assert.match(search, /border:\s*0/u);
  assert.match(search, /border-bottom:\s*1px solid var\(--ccd-border-soft\)/u);
  assert.match(search, /background:\s*transparent/u);
  /* The corner is reset rather than rounded away in an inherited sheet: a bare
     line has no corner to round. */
  assert.match(search, /border-radius:\s*0/u);
  /* The cell is still a cell of the card's rhythm — the rows' 24px box, pinned
     against the box model because the page default is content-box. */
  assert.match(search, /box-sizing:\s*border-box/u);
  assert.match(search, /height:\s*24px/u);
  /* It bleeds past the card's 6px padding so the rule under it runs the card's
     full width, and that shift carries the cell's text 6px left of the rows'
     own, so its inline padding has to give the 6 back on top of the rows': the
     caret the card opens with lands on the row labels' x only while the two
     numbers still add up. Pinned as that sum and not as a literal — the first
     cut left the rows' 8px under a -6px bleed and put the caret 6px ahead of
     every label below it. */
  assert.match(search, /margin:\s*0 -6px 4px/u);
  assert.match(search, /width:\s*calc\(100% \+ 12px\)/u);
  assert.equal(inlineOf(search, 'padding'),
    inlineOf(exactRule(controls, '.ccd-model-options button').body, 'padding')
    + Math.abs(inlineOf(search, 'margin')));
});

test('the search cell paints no ring and no hint text', () => {
  /* §七's ring is what turned this cell into a blue frame: the panel focuses
     the field the moment the card opens. The user's rule replaces it with the
     caret, so no outline may reach the field under either focus spelling. */
  const focus = controls.filter(rule => rule.selector.includes('.ccd-model-search:'));
  assert.equal(focus.length, 1, 'one rule states the field’s focus');
  for (const state of [':focus', ':focus-visible']) {
    assert.ok(focus[0]?.selector.includes(`.ccd-model-search${state}`), focus[0]?.selector ?? '');
  }
  assert.match(focus[0]?.body ?? '', /outline:\s*none/u);
  /* No placeholder rule survives, and the component writes no attribute for
     one to paint: the host's string stays as the field's accessible name. */
  assert.deepEqual(controls.filter(rule => rule.selector.includes('::placeholder')), []);
  const component = read('../src/client/features/model-controls/ModelControls.tsx');
  assert.ok(!/\bplaceholder=/u.test(component), 'the search field carries no hint text');
  assert.match(component, /aria-label=\{t\('search\.placeholder'\)\}/u);
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

test('the chosen row softens the selected step onto the card, not onto the hover step', () => {
  /* Two steps, as the sidebar's current row reads beside its hovered
     neighbour: the selected step for the row you are on, `--ccd-hover` for the
     row you are pointing at. The rule is the only one that names the chosen
     state, and it sits after the hover rule at the same specificity, so a row
     that is both keeps the chosen step. */
  const chosen = exactRule(controls, '.ccd-model-options button[aria-pressed="true"]').body;
  /* The selected step is measured against the canvas, and this card is white:
     at full strength the pill reads two steps too grey on it — the regression
     the user reported, which the reference's own pill (12/255 below its card,
     against the step's 20) confirms. */
  assert.ok(!/background:\s*var\(--ccd-selected\)\s*;/u.test(chosen), chosen);
  /* Softened rather than replaced: the mix is what keeps the pill
     palette-relative, so a configured canvas and the dark scheme move both ends
     together. */
  assert.match(chosen,
    /background:\s*color-mix\(in srgb, var\(--ccd-selected\) 60%, var\(--ccd-card\)\)/u);
  /* And not the hover step either: its dark value sits 1/255 from the dark
     card, which would leave the chosen row invisible in the dark scheme. */
  assert.ok(!/var\(--ccd-hover\)/u.test(chosen), chosen);
  /* The state is the fill alone: the ink the row already carries and the mark
     in its trailing seat. No weight, no second box, no recoloured label. */
  assert.ok(!/font-weight|box-shadow|border|color:/u.test(chosen), chosen);
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

