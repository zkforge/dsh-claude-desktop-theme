import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * Host popup contract (DESIGN.md §6.7).
 *
 * Every menu the host draws is built from one card — `ui-primitives`'
 * `MenuSurface`, which tags itself `data-menu-material` — and from the rows of
 * whichever primitive renders inside it: `Menu`'s `button[role="menuitem"]`
 * (workspace ⋯, session ⋯, view options, permission, the hero pickers) or the
 * Composer command palette's `button[role="option"]`. `theme/menus.css` is the
 * one sheet that draws that family, so these rules are pinned here rather than
 * per menu: a card that is 12px with a 1px outline, the hairline three-layer
 * shadow and the card fill; a 24px cell per row with a 6px corner and no
 * leading icon seat; one hover fill, the fill plus §七's ring for keyboard
 * focus.
 *
 * Two facts decide how the rules are written, and both are asserted:
 * - the seat and the card are matched through the primitive's own hooks —
 *   `data-menu-material`, `[role="menuitem"]`, `[role="option"]` and the pinned
 *   `_4ub78_` / `_ri079_` neighbourhood — never through a menu of one feature,
 *   so a later menu cannot arrive with the host's 16px material while the rest
 *   of the interface is flat;
 * - the signed-in account card is the one exception the design document names:
 *   its rows and leading glyphs are its reference's own
 *   (`features/sidebar/account-menu.css`), so every row rule carries
 *   `:not([data-ccd-account-menu])` while the card rule covers it too.
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

const MARKER = 'html[data-dsh-ccd-style="true"]';
/** The account card, tagged by `compat/account-menu.ts` on the portalled menu. */
const ACCOUNT = ':not([data-ccd-account-menu])';

const menus = rules(read('../src/client/theme/menus.css'));
const composer = rules(read('../src/client/theme/composer.css'));
const tokens = read('../src/client/theme/tokens.css');

/** Rules that draw a row: the ones naming a row role. */
const rowRules = menus.filter(rule => rule.selector.includes('[role="menuitem"]')
  || rule.selector.includes('[role="option"]'));

test('one card rule draws every host popup surface', () => {
  const cards = menus.filter(rule => rule.selector === `${MARKER} [data-menu-material]`);
  assert.equal(cards.length, 1, 'menus.css should draw exactly one popup card');
  const body = cards[0]?.body ?? '';
  assert.match(body, /box-sizing:\s*border-box/u);
  assert.match(body, /border:\s*1px solid var\(--ccd-border\)/u);
  assert.match(body, /border-radius:\s*var\(--ccd-radius-panel\)/u);
  assert.match(body, /background:\s*var\(--ccd-card\)/u);
  assert.match(body, /box-shadow:\s*var\(--ccd-effort-shadow\)/u);
  /* The fill is replaced through the token the material layer reads, and the
     blur is withdrawn with it: naming `.material` would pin a second hash. */
  assert.match(body, /--dsw-menu-surface-fill:\s*var\(--ccd-card\)/u);
  assert.match(body, /--dsw-menu-backdrop-filter:\s*none/u);
  /* The card is reached by the surface's own tag, not by an expanded chip:
     every menu that opens anywhere in the window takes it. */
  assert.ok(!cards[0]?.selector.includes(':has('), cards[0]?.selector ?? '');
  /* The host's card values stay the host's. */
  for (const property of ['padding:', 'min-width', 'max-height', 'overflow']) {
    assert.ok(!body.includes(property), `${property} is the host's`);
  }
});

test('the card is drawn in one place, not copied per menu', () => {
  assert.equal(composer.filter(rule => rule.selector.includes('[data-menu-material]')).length, 0,
    'composer.css should no longer draw a popup card of its own');
});

test('both row families are the document’s 24px cell', () => {
  const cells = rowRules.filter(rule => rule.body.includes('min-height: 24px'));
  assert.equal(cells.length, 1, 'menus.css should draw exactly one row cell');
  const rule = cells[0] as Rule;
  for (const role of ['[role="menuitem"]', '[role="option"]']) {
    assert.ok(rule.selector.includes(`${MARKER} [data-menu-material]${ACCOUNT} ${role}`), rule.selector);
  }
  assert.match(rule.body, /box-sizing:\s*border-box/u);
  assert.match(rule.body, /min-height:\s*24px/u);
  assert.match(rule.body, /padding-block:\s*2px/u);
  assert.match(rule.body, /border-radius:\s*var\(--ccd-table-radius\)/u);
  /* The host's own type, x and gap are what keep the label's measure and its
     8px start padding; none of them travels with the height. */
  for (const property of ['font-size', 'line-height', 'gap', 'padding:', 'padding-inline']) {
    assert.ok(!rule.body.includes(property), `${property} is the host's`);
  }
});

test('no popup row leads with an icon seat', () => {
  const seats = menus.filter(rule => rule.body.includes('display: none')
    && (rule.selector.includes('._itemIcon_4ub78_148') || rule.selector.includes('aria-hidden="true"')));
  assert.equal(seats.length, 1, 'menus.css should hide exactly one kind of icon seat');
  const selector = seats[0]?.selector ?? '';
  /* `Menu`'s seat, and the command palette's decorative first child span —
     the palette's class prefix is pinned nowhere, so its seat is told by
     `aria-hidden`, which is what makes it a seat rather than content. */
  assert.ok(selector.includes(`${MARKER} [data-menu-material]${ACCOUNT} [role="menuitem"] > ._itemIcon_4ub78_148`), selector);
  assert.ok(selector.includes(`${MARKER} [data-menu-material]${ACCOUNT} [role="option"] > span[aria-hidden="true"]:first-child`), selector);
  assert.equal((seats[0]?.body ?? '').trim(), 'display: none;');
});

test('the pointer and the keyboard share one fill, and no row draws a ring', () => {
  const hover = rowRules.filter(rule => rule.body.includes('background: var(--ccd-hover)'));
  assert.equal(hover.length, 1, 'menus.css should draw exactly one hover fill');
  const hoverSelector = hover[0]?.selector ?? '';
  /* Every state the host fills for itself: pointer and keyboard on a `Menu`
     row, pointer and the listbox keyboard cursor on a palette row. */
  assert.ok(hoverSelector.includes('[role="menuitem"]:hover:not(:disabled)'), hoverSelector);
  assert.ok(hoverSelector.includes('[role="menuitem"]:focus-visible:not(:disabled)'), hoverSelector);
  assert.ok(hoverSelector.includes('[role="option"]:hover'), hoverSelector);
  assert.ok(hoverSelector.includes('[role="option"][aria-selected="true"]'), hoverSelector);
  assert.match(hover[0]?.body ?? '', /background:\s*var\(--ccd-hover\)/u);

  /* No emphasis ring on a popup row: the fill is the one indication, and the
     rule that states it says `none` rather than leaving it to the host. */
  const outlines = menus.flatMap(rule => [...rule.body.matchAll(/outline[^;]*;/gu)].map(([text]) => text.trim()));
  assert.deepEqual(outlines, ['outline: none;'], 'the popup family states no ring and nothing else');
  const noRing = rowRules.filter(rule => rule.body.includes('outline: none'));
  assert.equal(noRing.length, 1, 'menus.css should state the row has no ring');
  const noRingSelector = noRing[0]?.selector ?? '';
  assert.ok(noRingSelector.includes(`${MARKER} [data-menu-material]${ACCOUNT} [role="menuitem"]:focus-visible`), noRingSelector);
  assert.ok(noRingSelector.includes(`${MARKER} [data-menu-material]${ACCOUNT} [role="option"][aria-selected="true"]`), noRingSelector);
});

test('the card’s non-option rows keep the same 24px rhythm', () => {
  /* The heading cell is told apart by what it draws — the `role="presentation"`
     children of a row group — rather than by its ink: the permission card's
     badge wears the same secondary ink for a different job (below). */
  const headings = menus.filter(rule => rule.selector.includes('> [role="presentation"]'));
  assert.equal(headings.length, 1, 'menus.css should draw exactly one heading cell');
  const rule = headings[0] as Rule;
  /* Both containers: the `Menu` list's `.viewport`, and the command palette's
     own `[role="listbox"]` viewport. */
  assert.ok(rule.selector.includes(`${MARKER} [data-menu-material]${ACCOUNT} ._viewport_4ub78_19 > [role="presentation"]`), rule.selector);
  assert.ok(rule.selector.includes(`${MARKER} [data-menu-material]${ACCOUNT} [role="listbox"] > [role="presentation"]`), rule.selector);
  /* One 20px line with 2px above and below, in the control-label step. */
  assert.match(rule.body, /padding:\s*2px 8px/u);
  assert.match(rule.body, /font-size:\s*12px/u);
  assert.match(rule.body, /line-height:\s*20px/u);
  assert.match(rule.body, /color:\s*var\(--ccd-text-secondary\)/u);
});

test('the card’s internal hairlines take the soft line', () => {
  const separator = menus.filter(rule => rule.selector.includes('[role="separator"]'));
  assert.equal(separator.length, 1, 'one separator rule');
  assert.match(separator[0]?.body ?? '', /background:\s*var\(--ccd-border-soft\)/u);
  const footer = menus.filter(rule => rule.selector.includes('._footer_4ub78_62'));
  assert.equal(footer.length, 1, 'one footer rule');
  assert.match(footer[0]?.body ?? '', /border-top-color:\s*var\(--ccd-border-soft\)/u);
});

test('every rule is scoped to the activation marker and the popup family', () => {
  for (const rule of menus) {
    assert.ok(rule.selector.startsWith(MARKER), rule.selector);
    assert.ok(rule.selector.includes('[data-menu-material]'), rule.selector);
  }
});

test('the sheet names only tokens the palette declares', () => {
  const declared = new Set([...tokens.matchAll(/(--ccd-[a-z0-9-]+):/gu)].map(([, name]) => name));
  const used = new Set([...read('../src/client/theme/menus.css').matchAll(/var\((--ccd-[a-z0-9-]+)/gu)].map(([, name]) => name));
  assert.ok(used.size > 0);
  for (const name of used) assert.ok(declared.has(name), `${name} is not declared in tokens.css`);
});

test('the popup sheet is mounted with the rest of the presentation base', () => {
  const mount = read('../src/client/theme/mount.ts');
  assert.match(mount, /import menuCss from '\.\/menus\.css'/u);
  assert.match(mount, /mountStyles\(menuCss\)/u);
});
