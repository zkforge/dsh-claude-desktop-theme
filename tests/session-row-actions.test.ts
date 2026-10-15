import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * A Session row's trailing side.
 *
 * `ui-workspace`'s `SessionNodeItem` gives the row a `rowActions` box holding two
 * things: the `Menu` trigger whose card carries the Session's actions, and the
 * host's own `sidebar.workspaces.session.row.action` list — where that package
 * registers an archive button and a pin button, both revealed by the row's
 * hover. The reference draws one trailing control there, the ⋮ that opens the
 * menu, so `features/sidebar/sidebar.css` takes the list's outlet out of the line
 * and dresses that trigger. The actions themselves are not lost: the same two
 * are rows of the ⋮ card, which is what `ui-workspace` registers into
 * `sidebar.workspaces.session.menu.item` (pin 100, rename 200, fork 300,
 * archive 400) — the four the reference's menu holds.
 *
 * Two facts decide how the rules are written, and both are asserted here:
 *
 * - the outlet is a `renderSlot` anchor — a `div[data-slot]` carrying the
 *   renderer's own `display: contents` as an *inline* style, which is what keeps
 *   the wrapper out of layout — so a rule that hides it has to outrank an inline
 *   declaration, and `!important` is the only way an author sheet can;
 * - the trigger is the host's own 16px icon button, so its mark is the stacked ⋮
 *   the conversation header already paints from the host's artwork
 *   (`--ccd-icon-more`), not a second ellipsis drawn for the sidebar.
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
const ROW = '.jJkEga_sessionRow';
const ACTIONS = `${ROW} .jJkEga_rowActions`;
const TRIGGER = `${ACTIONS} .jJkEga_iconButton`;
/** The seat `ui-workspace` renders the two hover buttons into. */
const SEAT = 'div[data-slot="sidebar.workspaces.session.row.action"]';

const sidebar = rules(read('../src/client/features/sidebar/sidebar.css'));

const hiding = sidebar.filter(rule => rule.selector.includes(SEAT));
const trigger = sidebar.filter(rule => rule.selector.includes(TRIGGER));

test('the Session row takes the host\'s own row-action seat out of the line', () => {
  assert.equal(hiding.length, 1, 'sidebar.css should hide the seat in exactly one rule');
  const rule = hiding[0] as Rule;
  assert.ok(rule.selector.startsWith(MARKER), rule.selector);
  assert.ok(rule.selector.includes(`${ACTIONS} > ${SEAT}`), rule.selector);
  /* Only a Session row: the Workspace row's own actions keep their line. */
  assert.ok(rule.selector.includes(ROW), rule.selector);
  /* The outlet carries `display: contents` inline, so the hide has to be
     `!important` — a plain declaration would simply lose to it. */
  assert.equal(rule.body.trim(), 'display: none !important;');
});

test('the one control a Session row keeps is drawn from the reference', () => {
  assert.equal(trigger.length, 4, 'the box, its hover, its mark and the host svg it replaces');
  for (const rule of trigger) assert.ok(rule.selector.startsWith(MARKER), rule.selector);
  const bodies = trigger.map(rule => (rule.selector.endsWith(' svg') ? 'svg' : rule.selector.endsWith('::before') ? 'mark' : ''));
  assert.deepEqual(bodies, ['', '', 'svg', 'mark'], 'the host svg steps aside for the plugin mark');

  const [box, hover] = trigger as [Rule, Rule];
  assert.match(box.body, /box-sizing:\s*border-box;/u);
  /* Match the project menu button dimensions. */
  assert.match(box.body, /width:\s*22px;/u);
  assert.match(box.body, /height:\s*22px;/u);
  assert.match(box.body, /border-radius:\s*6px;/u);
  assert.match(box.body, /color:\s*var\(--ccd-text-secondary\);/u);

  /* A filled row is what the pointer leaves under it, so the control's own hover
     step is the one below that fill rather than the row-level `--ccd-hover`. */
  assert.match(hover.body, /background:\s*var\(--ccd-hover-strong\);/u);
  assert.match(hover.body, /color:\s*var\(--ccd-text\);/u);

  const [svg, mark] = trigger.slice(2) as [Rule, Rule];
  assert.match(svg.body, /display:\s*none;/u);
  /* The same stacked ⋮ the header's session menu draws, at the compact project-icon size. */
  assert.match(mark.body, /content:\s*"";/u);
  assert.match(mark.body, /mask:\s*var\(--ccd-icon-more\) center \/ 14px 14px no-repeat;/u);
});


test('sidebar menu artwork never opts the whole row into header icon geometry', () => {
  const module = read('../src/client/compat/sidebar-session-icons.ts');
  const sheet = read('../src/client/features/sidebar/sidebar.css');
  const header = read('../src/client/features/conversation/header-actions/header-menus.css');
  assert.ok(header.includes('[data-ccd-session-icon]'), 'header owns its existing icon marker');
  assert.ok(module.includes("const attribute = 'data-ccd-sidebar-session-icon'"));
  assert.ok(!module.includes("'data-ccd-session-icon'"));
  assert.ok(!sheet.includes('[data-ccd-session-icon'));
  assert.ok(sheet.includes('[data-ccd-sidebar-session-icon="pin"] > ._itemIcon_4ub78_148'));
  assert.ok(sheet.includes('[data-ccd-sidebar-session-icon="rename"] > ._itemIcon_4ub78_148'));
});
