import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * Workspace picker row contract.
 *
 * The chip above the Composer opens the workspace picker through the host's
 * `Menu` primitive, whose cell is 34px tall — a 13px label on a 20px line under
 * a 34px minimum with 6px of block padding (`ui-primitives/lib/Menu.module.css`,
 * shipped by the static web frontend as `_4ub78_`) — where the reference draws
 * one row as 48 device px at @2x: the same line in a 24px box. `theme/
 * composer.css` flattens the card's two row groups, the scrolling `.viewport`
 * and the pinned `.footer`, and this test pins the shape of that rule: the
 * height and its padding are one decision, the corner has to leave the pill the
 * host's 12px row radius becomes at half of 24px, and the guard is the host's
 * own expanded-chip state so every other Menu surface keeps the host's row.
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

const composer = rules(read('../src/client/theme/composer.css'));

/* The host's own expanded-chip state (ConversationHero.module.css paints its
   fill on the same `[aria-expanded="true"]`), read from the portalled card. */
const GUARD = 'html[data-dsh-ccd-style="true"]:has(.bocITq_workspace[aria-expanded="true"]) [role="menu"]';

/** The two groups the Menu primitive keeps the card's rows in. */
const GROUPS = [
  '> ._viewport_4ub78_19 > ._itemWrap_4ub78_90 > ._item_4ub78_90',
  '> ._footer_4ub78_62 > ._itemWrap_4ub78_90 > ._item_4ub78_90',
];

/* The one rule that reshapes the workspace picker's cells. The agent-preset
   card beside it carries its own rule with the same four declarations and its
   own guard (tests/preset-menu-rows.test.ts), so the filter is the guard, not
   the declarations: one card, one rule. */
const flat = composer.filter(rule => rule.selector.startsWith(GUARD)
  && rule.body.includes('min-height: 24px'));

test('the picker card draws the reference’s flat row in both of its groups', () => {
  assert.equal(flat.length, 1, 'composer.css should flatten exactly one row rule per card');
  const rule = flat[0];
  const selector = rule?.selector ?? '';
  assert.ok(selector.startsWith(GUARD), selector);
  for (const group of GROUPS) assert.ok(selector.includes(`${GUARD} ${group}`), selector);
  /* Height is pinned against the document's box model rather than inherited
     from it: the host's button leaves `box-sizing` to the page, and under the
     content-box default the same declarations would build a 28px row. */
  assert.match(rule?.body ?? '', /box-sizing:\s*border-box/u);
  assert.match(rule?.body ?? '', /min-height:\s*24px/u);
  assert.match(rule?.body ?? '', /padding-block:\s*2px/u);
  /* The reference's 12-device-px corner at @2x — the curve the transcript's
     table and code cards already use. */
  assert.match(rule?.body ?? '', /border-radius:\s*6px/u);
});

test('the flat row leaves the cell’s type, inline padding and gap to the host', () => {
  const body = flat[0]?.body ?? '';
  /* Every one of these is the host's, and every one of them is what keeps the
     label's x, its 13px measure and the row's 8px inline padding unchanged. */
  for (const property of ['font-size', 'line-height', 'gap', 'padding:', 'padding-inline', 'padding-left', 'padding-right']) {
    assert.ok(!body.includes(property), `${property} is the host's`);
  }
});

test('the flat row and the hidden icon seat are the same card, one guard apart', () => {
  const seats = composer.filter(rule => rule.body.includes('display: none')
    && rule.selector.includes('._itemIcon_4ub78_148'));
  assert.equal(seats.length, 1, 'composer.css should hide exactly one icon seat rule');
  const seat = seats[0];
  assert.ok((seat?.selector ?? '').startsWith(GUARD), seat?.selector ?? '');
  for (const group of GROUPS) {
    assert.ok((seat?.selector ?? '').includes(`${GUARD} ${group} > ._itemIcon_4ub78_148`), seat?.selector ?? '');
  }
});
