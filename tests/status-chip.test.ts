import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { STATS_ATTRIBUTE } from '../src/client/compat/stats-values.ts';

/*
 * Status-bar contract: one box and one gap for the whole row.
 *
 * The tool row's controls are the reference's chips, not boxes stretched to the
 * row: the model and effort chips draw their fill as one label line (40 device
 * px at @2x, so a 20px box around the same 12px label), and the command plus,
 * the permission control, the voice control, the statistics readouts and the
 * context ring now carry that same box, so a pointer crossing the row finds one
 * fill height instead of three. The row itself keeps its 28px —
 * `--ccd-control-row-height` is what the dock, the ring's seat and the trailing
 * cluster are measured from — and every container in the bar spaces its children
 * with the one `--ccd-cluster-gap`, because the host's leading groups ran 12px
 * against the plugin's trailing 6px. See DESIGN.md, the status-bar section.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

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

function declared(sheet: string, name: string): string | undefined {
  return new RegExp(`--${name}:\\s*([^;]+);`, 'u').exec(sheet)?.[1]?.trim();
}

const tokensSheet = read('../src/client/theme/tokens.css');
const controlsSheet = read('../src/client/features/model-controls/controls.css');
const composerSheet = read('../src/client/theme/composer.css');

const controls = rules(controlsSheet);
const composer = rules(composerSheet);
const ROW_CONTAINERS = ['.yhfFVG_tools', '.yhfFVG_modes', '.yhfFVG_trailing', '.yhfFVG_standardControls'];

test('the chip carries the reference box, not the control row it sits in', () => {
  /* 40 device px at @2x, the reference's 12-device-px corner, and the one
     inline padding the row's text chips and glyph buttons all take. */
  assert.equal(declared(tokensSheet, 'ccd-chip-height'), '20px');
  assert.equal(declared(tokensSheet, 'ccd-chip-radius'), '6px');
  assert.equal(declared(tokensSheet, 'ccd-chip-padding-inline'), '7px');
  /* The row is what the dock, the ring's seat and the trailing cluster measure,
     so the chip shrinks to its own token rather than the row shrinking. */
  assert.equal(declared(tokensSheet, 'ccd-control-row-height'), '28px');
  assert.equal(declared(tokensSheet, 'ccd-cluster-gap'), '6px');
});

test('both value chips read their box from the chip tokens alone', () => {
  const body = ruleFor(controls, '.ccd-model-trigger, .ccd-effort-trigger').body;
  assert.match(body, /height:\s*var\(--ccd-chip-height,\s*20px\)/u);
  assert.match(body, /border-radius:\s*var\(--ccd-chip-radius,\s*6px\)/u);
  assert.match(body, /padding:\s*0 var\(--ccd-chip-padding-inline,\s*7px\)/u);
  /* The row's own height must not come back through the chip's box. */
  assert.ok(!/height:\s*var\(--ccd-control-row-height/u.test(body), body);
  assert.match(body, /font-size:\s*12px/u);
  assert.match(body, /color:\s*var\(--ccd-text-strong\)/u);
});

test('the fill is the one flat hover step, on hover and while a panel is open', () => {
  const fills = controls.filter(rule =>
    /background:\s*var\(--ccd-hover\)/u.test(rule.body) && rule.selector.includes('.ccd-model-trigger'));
  assert.equal(fills.length, 1, 'one rule paints the chip fill');
  const selector = fills[0]?.selector ?? '';
  for (const trigger of ['.ccd-model-trigger', '.ccd-effort-trigger']) {
    assert.ok(selector.includes(`${trigger}:hover`), selector);
    assert.ok(selector.includes(`${trigger}[aria-expanded="true"]`), selector);
  }
  /* The flat step is the whole fill: no gradient, no second surface layer. */
  assert.ok(!/gradient|box-shadow/u.test(fills[0]?.body ?? ''), fills[0]?.body ?? '');
});

test('every control in the row takes the one chip box', () => {
  const add = ruleFor(composer, '.yhfFVG_add').body;
  assert.match(add, /height:\s*var\(--ccd-chip-height\)/u);
  assert.match(add, /border-radius:\s*var\(--ccd-chip-radius\)/u);
  /* A glyph button is the row's 14px artwork plus one chip padding a side. */
  assert.match(add, /width:\s*calc\(var\(--ccd-row-icon-size\) \+ 2 \* var\(--ccd-chip-padding-inline\)\)/u);

  const permission = ruleFor(composer, '.wXeviG_trigger').body;
  assert.match(permission, /height:\s*var\(--ccd-chip-height\)/u);
  assert.match(permission, /border-radius:\s*var\(--ccd-chip-radius\)/u);
  assert.match(permission, /padding:\s*0 var\(--ccd-chip-padding-inline\)/u);

  const readouts = composer.filter(rule =>
    rule.selector.includes('.OpZ85W_pill') && rule.selector.includes('.y0jqnG_trigger')
    && rule.body.includes('--ccd-chip-height'));
  assert.equal(readouts.length, 1, 'the readouts and the ring share one chip rule');
  assert.match(readouts[0]?.body ?? '', /border-radius:\s*var\(--ccd-chip-radius\)/u);

  /* The ring is placed in a seat as tall as the row, so the chip inside it has
     to be centred rather than parked at the seat's top edge. */
  const seat = composer.filter(rule => rule.selector.includes('.yhfFVG_dock > .y0jqnG_root'));
  assert.equal(seat.length, 2, 'the seat box and its centring');
  assert.match(seat[0]?.body ?? '', /height:\s*var\(--ccd-control-row-height\)/u);
  assert.match(seat[1]?.body ?? '', /align-items:\s*center/u);
});

test('the permission chip is its text: no mode glyph, no disclosure mark', () => {
  /* Both of the host's marks leave the line in one rule: the mode glyph it
     leads with and the chevron it closes with. */
  const marks = composer.filter(rule => rule.body.includes('display: none')
    && (rule.selector.includes('.wXeviG_triggerIcon') || rule.selector.includes('.wXeviG_chevron')));
  assert.equal(marks.length, 1, 'one rule withdraws the glyph and the chevron');
  const selector = marks[0]?.selector ?? '';
  assert.ok(selector.includes('html[data-dsh-ccd-style="true"] .wXeviG_triggerIcon'), selector);
  assert.ok(selector.includes('html[data-dsh-ccd-style="true"] .wXeviG_chevron'), selector);
  assert.equal((marks[0]?.body ?? '').trim(), 'display: none;');

  /* The label is the whole control, so no rule hides it: the plugin's own
     narrow-column rule is gone, and the host's `≤460px`
     `.wXeviG_trigger:has(.wXeviG_triggerIcon) .wXeviG_triggerLabel` — which
     reads the glyph as the reading that survives there — is outranked by a
     rule that names the same seat with `:has()` and the child combinator. */
  const hidden = composer.filter(rule =>
    rule.selector.includes('.wXeviG_triggerLabel') && rule.body.includes('display: none'));
  assert.deepEqual(hidden, [], 'the permission label is drawn at every width');
  const kept = composer.filter(rule =>
    rule.selector.includes('.wXeviG_triggerLabel') && rule.body.includes('display: inline'));
  assert.equal(kept.length, 1, 'one rule keeps the permission label');
  const keeper = kept[0]?.selector ?? '';
  assert.ok(keeper.includes(':has(.wXeviG_triggerIcon)'), keeper);
  assert.ok(keeper.includes('> .wXeviG_triggerLabel'), keeper);
});

test('every container in the row spaces its children with the one gap', () => {
  const gapRule = ruleFor(composer, ROW_CONTAINERS.join(', html[data-dsh-ccd-style="true"] '));
  assert.match(gapRule.body, /gap:\s*var\(--ccd-cluster-gap\)/u);
  assert.match(ruleFor(composer, '.yhfFVG_row').body, /gap:\s*var\(--ccd-cluster-gap\)/u);
  assert.match(ruleFor(composer, '.OpZ85W_root').body, /gap:\s*var\(--ccd-cluster-gap\)/u);
  /* The host's own 12px row gap must not survive anywhere in the bar. */
  const stragglers = composer.filter(rule =>
    /gap:\s*(?:12px|8px)/u.test(rule.body)
    && [...ROW_CONTAINERS, '.yhfFVG_row', '.OpZ85W_root'].some(container => rule.selector.includes(container)));
  assert.deepEqual(stragglers, []);
});

test('the statistics readouts leave the row unless the configuration asks for them', () => {
  /* The state comes from `compat/stats-values.ts` and is read here, so the
     attribute is pinned across the two files rather than spelled twice, and the
     host's cluster is named by its own stable marker rather than by a class
     hash. A default configuration writes `off`, so the row ships without the
     readouts. */
  const rule = ruleFor(composer, `[${STATS_ATTRIBUTE}="off"] [data-composer-stats]`);
  assert.ok(rule.selector.startsWith('html[data-dsh-ccd-style="true"]'), rule.selector);
  assert.equal(rule.body.trim(), 'display: none;');
});
