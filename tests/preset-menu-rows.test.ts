import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * Agent-preset (mode) picker contract.
 *
 * The second chip in the hero chips row opens the host's `Menu` primitive with
 * `ui-agent-preset`'s own row content: a name span and a description span
 * stacked inside the row label (`AgentPresetSeat.module.css`). That stack is
 * what makes a row 66px tall and the card 324px wide, against the design
 * document's popup row — one 20px line in a 24px box with a trailing mark
 * (DESIGN.md §6.7). `theme/composer.css` therefore drops the second line,
 * flattens the cells, and gives the card the document's popup chrome; this test
 * pins the shape of those three rules.
 *
 * Two facts decide how they are written, and both are asserted here:
 * - the guard is the preset seat's own expanded state, told apart from the
 *   workspace chip beside it by `:not(.bocITq_workspace)` — the one class of the
 *   two that `compat/host-dom.ts` pins for both shipped builds;
 * - the description is reached structurally, because every class of that pane
 *   (`m0vb0q_*`) is a per-build hash with no Windows counterpart in
 *   `compat/host-builds.ts`. Naming one would silently leave that build's rows
 *   two lines tall.
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

/** The mode seat's expanded state; the workspace chip is the row's other menu button. */
const GUARD = 'html[data-dsh-ccd-style="true"]:has(.ST7X_W_heroWorkspaceRow button[aria-haspopup="menu"]:not(.bocITq_workspace)[aria-expanded="true"])';

/** The mode card's one row group: it has no `.footer`, so this is the whole card. */
const ROW = '[role="menu"] > ._viewport_4ub78_19 > ._itemWrap_4ub78_90 > ._item_4ub78_90';

/** Both chips' cards: either expanded menu button in the row reaches one surface. */
const CARD_GUARD = 'html[data-dsh-ccd-style="true"]:has(.ST7X_W_heroWorkspaceRow button[aria-haspopup="menu"][aria-expanded="true"])';

test('the mode card hides the row’s description line structurally', () => {
  const hidden = composer.filter(rule => rule.body.includes('display: none')
    && rule.selector.includes('._itemLabel_4ub78_190'));
  assert.equal(hidden.length, 1, 'composer.css should hide exactly one description line');
  const rule = hidden[0];
  const selector = rule?.selector ?? '';
  assert.ok(selector.startsWith(GUARD), selector);
  /* The second span of the label wrapper is the description; the first is the
     name. `:not(:first-child)` is what keeps this off the name. */
  assert.ok(selector.includes(`${GUARD} ${ROW} > ._itemLabel_4ub78_190 > span > :not(:first-child)`), selector);
  /* The line is removed, not faded: no ink, size or layout property travels
     with it, so the row keeps the host's own label metrics. */
  assert.equal((rule?.body ?? '').trim(), 'display: none;');
});

test('the mode card draws the same flat cell as the workspace card', () => {
  const flat = composer.filter(rule => rule.selector.startsWith(GUARD)
    && rule.body.includes('min-height: 24px'));
  assert.equal(flat.length, 1, 'one row rule for the mode card');
  const rule = flat[0];
  const selector = rule?.selector ?? '';
  /* One group: the mode card renders no footer. */
  assert.ok(selector.includes(`${GUARD} ${ROW},`) || selector.endsWith(`${GUARD} ${ROW}`), selector);
  assert.ok(!selector.includes('_footer_4ub78_62'), selector);
  assert.match(rule?.body ?? '', /box-sizing:\s*border-box/u);
  assert.match(rule?.body ?? '', /min-height:\s*24px/u);
  assert.match(rule?.body ?? '', /padding-block:\s*2px/u);
  assert.match(rule?.body ?? '', /border-radius:\s*6px/u);
  /* The label's own type, x and gap stay the host's. */
  for (const property of ['font-size', 'line-height', 'gap', 'padding:', 'padding-inline']) {
    assert.ok(!(rule?.body ?? '').includes(property), `${property} is the host's`);
  }
});

test('both hero picker cards answer to the design document’s popup chrome', () => {
  const cards = composer.filter(rule => rule.selector.includes('[data-menu-material]'));
  assert.equal(cards.length, 1, 'composer.css should draw exactly one hero picker card');
  const rule = cards[0];
  const selector = rule?.selector ?? '';
  /* One rule for both chips: the guard is the row's own expanded menu button,
     so the two cards cannot drift apart. */
  assert.ok(selector.startsWith(CARD_GUARD), selector);
  assert.ok(!selector.includes(':not(.bocITq_workspace)'), selector);
  const body = rule?.body ?? '';
  assert.match(body, /border:\s*1px solid var\(--ccd-border\)/u);
  assert.match(body, /border-radius:\s*var\(--ccd-radius-panel\)/u);
  assert.match(body, /background:\s*var\(--ccd-card\)/u);
  /* The popup's three-layer shadow (DESIGN.md §三), the same one this plugin's
     own model card carries. */
  assert.match(body, /box-shadow:\s*var\(--ccd-effort-shadow\)/u);
  /* The fill is the material layer's own token: naming that layer's class would
     pin another hash the Windows table does not carry. */
  assert.match(body, /--dsw-menu-surface-fill:\s*var\(--ccd-card\)/u);
  assert.match(body, /--dsw-menu-backdrop-filter:\s*none/u);
  /* Nothing else moves: the card keeps the primitive's padding, its own
     scrollbar rebinding and the host's row treatment. */
  for (const property of ['padding:', 'font-size', 'min-height']) {
    assert.ok(!body.includes(property), `${property} is the host's`);
  }
});
