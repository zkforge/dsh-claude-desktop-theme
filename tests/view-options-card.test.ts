import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * The view-options card's contract.
 *
 * The card replaces DSH's eight-row menu with the reference's shape: three value
 * rows (dimension, current choice, disclosure mark), one switch row and one
 * action row, with the options one level down in a card of their own. The
 * numbers come from the reference and live in
 * `features/view-options/view-options.css`; the words and the row order come
 * from `ViewOptionsCard.tsx`. Both are pinned here, because the two of them
 * together are what "the sidebar's view options" means in this interface.
 *
 * Two facts about the mapping are worth stating where a reader will find them:
 * the host draws its filter rows as `hide-archived`, `show-archived`,
 * `only-archived`, and this plugin renames that triple to 活跃会话 / 已归档会话 /
 * 全部 while drawing them in the reference's order — 活跃, then 已归档, then
 * 全部 — which is *not* the host's row order.
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

/**
 * The single rule whose selector ends with this one, so `.x button` cannot
 * match `.x` — or, with `exact`, the one rule whose selector is exactly this,
 * for a name that also ends a longer, shared selector.
 */
function ruleFor(sheet: readonly Rule[], selector: string, exact = false): Rule {
  const found = sheet.filter(rule => (exact ? rule.selector === selector : rule.selector.endsWith(selector)));
  assert.equal(found.length, 1, `expected one rule for ${selector}`);
  return found[0] as Rule;
}

const sheet = rules(read('../src/client/features/view-options/view-options.css'));
const card = read('../src/client/features/view-options/ViewOptionsCard.tsx');
const tokens = read('../src/client/theme/tokens.css');

test('the card is the family’s surface, in the reference’s box', () => {
  /* The chrome itself is menus.css's: the card carries the marker the family
     sheet draws every host popup from, rather than a second copy of it. */
  assert.match(card, /data-menu-material/u, 'the card is a family surface');
  const box = ruleFor(sheet, '.ccd-view-options', true);
  assert.match(box.body, /min-width:\s*200px/u);
  assert.match(box.body, /max-width:\s*320px/u);
  assert.match(box.body, /padding:\s*4px/u);
  assert.match(box.body, /font:\s*13px\/20px\s+var\(--ccd-font-ui\)/u);
  /* The UA hides a closed popover with `display: none`, so the card's own
     display may only apply while it is open. */
  const open = ruleFor(sheet, '.ccd-view-options:popover-open');
  assert.match(open.body, /display:\s*flex/u);
  assert.equal(sheet.filter(rule => /^\.ccd-view-options\b/u.test(rule.selector)
    && /display:/u.test(rule.body)).length, 1, 'only the open state states a display');
});

test('a row is the family’s 24px cell with a value column and a mark', () => {
  const row = ruleFor(sheet, '.ccd-view-row', true);
  assert.match(row.body, /min-height:\s*24px/u);
  assert.match(row.body, /padding:\s*2px 8px/u);
  assert.match(row.body, /border-radius:\s*var\(--ccd-table-radius\)/u);
  assert.match(row.body, /grid-template-columns:\s*minmax\(0, 1fr\) auto auto/u);
  assert.match(row.body, /column-gap:\s*12px/u);
  /* A row with no value column — the switch, and every option in the flyout —
     drops it: an empty `auto` column still takes the 12px column gap, which
     would hold the trailing mark off the edge. */
  const narrow = sheet.filter(rule => rule.selector.includes('data-ccd-view-switch')
    || rule.selector.includes('.ccd-view-submenu .ccd-view-row'));
  assert.equal(narrow.length, 1, 'one rule drops the third column');
  assert.match(narrow[0]?.body ?? '', /grid-template-columns:\s*minmax\(0, 1fr\) auto/u);
  const fill = sheet.filter(rule => rule.body.includes('background: var(--ccd-view-menu-hover)'));
  assert.equal(fill.length, 1, 'one fill for every row state');
  const fillSelector = fill[0]?.selector ?? '';
  assert.ok(fillSelector.includes('.ccd-view-row:hover'), fillSelector);
  assert.ok(fillSelector.includes('.ccd-view-row:focus-visible'), fillSelector);
  assert.ok(fillSelector.includes(".ccd-view-row[aria-expanded='true']"), fillSelector);
});

test('the value column is one step down, and the marks are the family’s', () => {
  const value = ruleFor(sheet, '.ccd-view-row-value');
  assert.match(value.body, /font-size:\s*12px/u);
  assert.match(value.body, /line-height:\s*16px/u);
  assert.match(value.body, /color:\s*var\(--ccd-view-menu-muted\)/u);
  assert.match(value.body, /max-width:\s*160px/u);
  assert.match(value.body, /text-overflow:\s*ellipsis/u);
  const marks = ruleFor(sheet, '.ccd-view-chevron, .ccd-view-check');
  assert.match(marks.body, /width:\s*16px/u);
  assert.match(marks.body, /margin-right:\s*-4px/u);
  assert.match(ruleFor(sheet, '.ccd-view-chevron', true).body, /color:\s*var\(--ccd-view-menu-muted\)/u);
  assert.match(ruleFor(sheet, '.ccd-view-check', true).body, /color:\s*var\(--ccd-view-menu-accent\)/u);
});

test('the separators and the flyout keep the family’s geometry', () => {
  const separator = ruleFor(sheet, '.ccd-view-separator');
  assert.match(separator.body, /height:\s*1px/u);
  assert.match(separator.body, /margin:\s*4px 8px/u);
  assert.match(separator.body, /background:\s*var\(--ccd-view-menu-separator\)/u);
  const flyout = ruleFor(sheet, '.ccd-view-submenu');
  assert.match(flyout.body, /position:\s*absolute/u);
  assert.match(flyout.body, /padding:\s*4px/u);
  /* The supplied reference has a 1px gap with a matching hit bridge. */
  assert.match(read('../src/client/features/view-options/ViewOptionsCard.tsx'), /SUBMENU_GAP = 1/u);
  const bridge = ruleFor(sheet, '.ccd-view-submenu::before');
  assert.match(bridge.body, /left:\s*-1px/u);
  assert.match(bridge.body, /width:\s*1px/u);
  assert.match(ruleFor(sheet, ".ccd-view-submenu[data-ccd-flip='true']::before").body, /right:\s*-1px/u);
});

test('the card the driver opens stays out of the paint, and only that card', () => {
  const driving = sheet.filter(rule => rule.selector.includes('[data-ccd-view-options-driving]'));
  assert.equal(driving.length, 1, 'one rule hides the driven card');
  const selector = driving[0]?.selector ?? '';
  assert.ok(selector.startsWith('html[data-dsh-ccd-style="true"][data-ccd-view-options-driving]'), selector);
  assert.ok(selector.includes('._7514NG_viewOptionsMenu'), selector);
  assert.ok(selector.includes('[data-menu-backing]'), selector);
  /* `visibility`, not `display`: the box the host's own positioning measures
     has to stay where it is. */
  assert.match(driving[0]?.body ?? '', /visibility:\s*hidden/u);
  assert.match(driving[0]?.body ?? '', /pointer-events:\s*none/u);
});

test('the card names only tokens the palette declares', () => {
  const declared = new Set([...tokens.matchAll(/(--ccd-[a-z0-9-]+):/gu)].map(([, name]) => name));
  const used = new Set([
    ...read('../src/client/features/view-options/view-options.css').matchAll(/var\((--ccd-[a-z0-9-]+)/gu),
  ].map(([, name]) => name as string));
  assert.ok(used.size > 0);
  for (const name of used) assert.ok(declared.has(name), `${name} is not declared in tokens.css`);
});

test('the filter triple is renamed to the reference’s words, in the reference’s order', () => {
  /* The host's own row order, as the card's table is written. */
  assert.match(card, /filters:\s*\['活跃', '全部', '已归档'\]/u);
  assert.match(card, /filters:\s*\['Active', 'All', 'Archived'\]/u);
  /* And the order the card draws them in: 活跃, 已归档, 全部. */
  assert.match(card, /FILTER_ORDER = \[0, 2, 1\]/u);
  assert.match(card, /FILTER_GROUP = 2/u);
  /* The two rows this plugin does not rename borrow the host's own words. */
  assert.match(card, /index === FILTER_GROUP \? copy\.filters\[host\]! : group\.labels\[host\]!/u);
  assert.match(card, /copy\.filters\[group\.selected\]/u);
});

test('the rows carry the roles their behaviour deserves', () => {
  /* A value row opens a card of its own; an option inside it is one of a set;
     the switch is on or off. */
  assert.match(card, /aria-haspopup="menu"/u);
  assert.match(card, /aria-expanded=\{openRow === index\}/u);
  assert.match(card, /role="menuitemradio"/u);
  assert.match(card, /role="menuitemcheckbox"/u);
  assert.match(card, /aria-checked=\{option\.host === group\.selected\}/u);
  assert.match(card, /aria-checked=\{on\}/u);
  /* The card is a menu named by the host's own label for its trigger. */
  assert.match(card, /anchor\?\.getAttribute\('aria-label'\)/u);
});

test('the action row exists only while a filter is off its default', () => {
  assert.match(card, /const filtersOff = groups\[FILTER_GROUP\]\?\.selected !== 0 \|\| showEmptyGroups;/u);
  assert.match(card, /\{filtersOff && \(/u);
  /* Clearing puts the filter row back to the host's own default (index 0, the
     first row) and the switch back to off, which is the schema's default. */
  assert.match(card, /await port\.choose\(FILTER_GROUP, 0\)/u);
  assert.match(card, /if \(showEmptyGroups\) setShowEmptyGroups\(false\)/u);
});

test('the switch is the one value the card owns, and it writes the configuration', () => {
  assert.match(card, /setShowEmptyGroups\(next\)/u);
  const mount = read('../src/client/features/view-options/mount.ts');
  assert.match(mount, /path: \['view', 'showEmptyGroups'\]/u);
  assert.match(mount, /form\.mutate\(/u);
  assert.match(mount, /environment\.config\.view\.showEmptyGroups/u);
  /* The card is a slot entry, not a listener on the host's DOM. */
  assert.match(mount, /DSH_SLOTS\.shellOverlay/u);
});
