import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * Agent-preset (mode) picker: the one row rule that is genuinely this card's.
 *
 * The second chip in the hero chips row opens the host's `Menu` primitive with
 * `ui-agent-preset`'s own row content: a name span and a description span
 * stacked inside the row label (`AgentPresetSeat.module.css`). That stack is
 * what makes a row 66px tall and the card 324px wide, against the design
 * document's popup row — one 20px line in a 24px box with a trailing mark
 * (DESIGN.md §6.7). `theme/composer.css` therefore drops the second line; the
 * card's chrome and the row's 24px cell are the shared popup rules
 * (theme/menus.css, pinned by tests/menu-surfaces.test.ts), and this test keeps
 * the content rule that is this card's alone.
 *
 * Two facts decide how it is written, and both are asserted here:
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

test('the mode card no longer carries a copy of the shared popup chrome', () => {
  for (const rule of composer) {
    assert.ok(!rule.selector.includes('[data-menu-material]'), rule.selector);
    assert.ok(!rule.selector.includes('._itemIcon_4ub78_148'), rule.selector);
    /* The one 24px box this sheet still states is the editor's own text line;
       the popup's row cell lives in menus.css. */
    if (rule.body.includes('min-height: 24px')) {
      assert.ok(!rule.selector.includes('[role="menu"]'), rule.selector);
    }
  }
});
