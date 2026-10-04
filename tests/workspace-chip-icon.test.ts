import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * Workspace row mark contract: the two chips above the Composer.
 *
 * The row holds the workspace picker's chip and, when developer tools are on,
 * the agent-preset ("mode") chip beside it. Both are host controls, and both
 * carry marks the reference does not draw: the picker chip leads with a folder
 * the host switches between its open and closed artwork on whether a workspace
 * is chosen, and each chip closes its line with a 12px chevron. The reference
 * draws one closed folder, one or two labels, and no chevron.
 *
 * `theme/composer.css` therefore paints the picker chip's leading mark from the
 * `--ccd-icon-folder` mask in `theme/tokens.css` and drops both chevrons. These
 * tests pin the geometry of that mask, the seat it is painted in (the host's
 * 16px box, first in the line, in the chip's own `currentColor`), and the one
 * rule that reaches the two chevrons — the picker's by its class, the mode
 * chip's by its artwork, because that module's prefix is not a pinned one.
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
const tokens = read('../src/client/theme/tokens.css');

/** The chip button and the plugin's guard on it; everything below hangs off it. */
const CHIP = 'html[data-dsh-ccd-style="true"] .bocITq_workspace';

/** The hero row that holds both chips, and the plugin's guard on it. */
const ROW = 'html[data-dsh-ccd-style="true"] .ST7X_W_heroWorkspaceRow';

/** The artwork mask, decoded back to the SVG the token carries. */
function mask(): string {
  const declared = [...tokens.matchAll(/--ccd-icon-folder:\s*url\("([^"]+)"\)/gu)];
  assert.equal(declared.length, 1, 'tokens.css should declare --ccd-icon-folder once');
  const data = declared[0]?.[1] ?? '';
  assert.ok(data.startsWith('data:image/svg+xml,'), data.slice(0, 40));
  return decodeURIComponent(data.replace('data:image/svg+xml,', ''));
}

test('the chip leaves one seed for the mark: the host svg, out of the line', () => {
  const hidden = composer.filter(rule => rule.body.includes('display: none')
    && rule.selector.includes('.bocITq_folder'));
  assert.equal(hidden.length, 1, 'composer.css should hide exactly one folder rule');
  const rule = hidden[0];
  /* The whole selector, not a suffix: the host's glyph is an `svg` carrying
     this class itself, so a descendant or compound form would match nothing. */
  assert.equal(rule?.selector, `${CHIP} .bocITq_folder`);
  assert.match(rule?.body ?? '', /display:\s*none/u);
});

test('the mark is painted in the seat the host svg held', () => {
  const painted = composer.filter(rule => rule.selector === `${CHIP}::before`);
  assert.equal(painted.length, 1, 'composer.css should paint exactly one chip ::before');
  const body = painted[0]?.body ?? '';
  assert.match(body, /content:\s*""/u);
  /* A flex item's own box, not a shrinkable one: with the host svg gone this is
     the line's only fixed item, and a long workspace name must not squeeze it. */
  assert.match(body, /flex:\s*none/u);
  assert.match(body, /width:\s*16px/u);
  assert.match(body, /height:\s*16px/u);
  /* The label's ink and the label's hover step, both inherited: the reference
     paints the mark and the text beside it at the same darkness. */
  assert.match(body, /background-color:\s*currentColor/u);
  assert.match(body, /mask:\s*var\(--ccd-icon-folder\)\s*center\s*\/\s*16px 16px no-repeat/u);
});

test('the seat claims nothing the chip already decides', () => {
  const body = composer.find(rule => rule.selector === `${CHIP}::before`)?.body ?? '';
  /* Padding, gap and type are the chip's own — restating any of them here is
     how the label's x and the icon column would drift apart. */
  for (const property of ['padding', 'gap', 'margin', 'font-size', 'line-height', 'order']) {
    assert.ok(!body.includes(property), `${property} belongs to the chip`);
  }
});

test('the mask is the host’s closed folder, drawn with an empty body', () => {
  const svg = mask();
  assert.match(svg, /viewBox='0 0 16 16'/u);
  assert.match(svg, /fill='none'/u);
  /* One path: the host's own `FolderCloseArtwork` carries a second one, the
     rule line across the body, and the reference draws the body empty. */
  assert.equal([...svg.matchAll(/<path/gu)].length, 1, 'the folder body stays empty');
  assert.match(svg, /stroke='black'/u);
  /* No `stroke-width`: the mark keeps DSH's own 1px default on its 16-unit grid. */
  assert.ok(!svg.includes('stroke-width'), 'the 1px stroke is the artwork default');
  /* The host's silhouette, corner for corner: the left edge from the tab's
     base, the tab's top edge at y 2.1106, the step down to the body's top edge
     at y 4.04319, and the body's bottom edge at y 13.8894 — 13 x 11.8 units of
     ink inside the 16px box, which is what the reference draws. */
  for (const anchor of [
    'M1.50439 3.11059',
    '2.50439 2.1106H5.43389',
    '8.3785 4.04319H13.4958',
    '13.4958 13.8894H2.50439',
  ]) {
    assert.ok(svg.includes(anchor), anchor);
  }
  assert.ok(!svg.includes('M3.63501 7.66614'), 'the rule line is not drawn');
});

test('both cards end on their label: the row keeps no disclosure mark', () => {
  const marks = composer.filter(rule => rule.body.includes('display: none')
    && rule.selector.includes('bocITq_chevron'));
  assert.equal(marks.length, 1, 'composer.css should hide the row’s chevrons in one rule');
  const rule = marks[0];
  const selector = rule?.selector ?? '';
  const chip = `${ROW} button[aria-haspopup="menu"]`;
  /* The picker chip's own mark, named through the class its build pins … */
  assert.ok(selector.includes(`${chip} > .bocITq_chevron`), selector);
  /* … and the mode chip's, which has no pinned class: the seat module's prefix
     is absent from `host-builds.ts`, so the artwork is what names it. Both are
     the same `IconChevronDownOutlineRegular` path. */
  assert.ok(selector.includes(`${chip} > svg:has(> path[d^="M4 6L7.29289"])`), selector);
  /* Nothing else moves with the mark: the whole of the change is the removal. */
  assert.equal((rule?.body ?? '').trim(), 'display: none;');
});

test('the chips’ labels and the mode chip stay the host’s', () => {
  /* No label is restyled, and no seat class is written down: `m0vb0q_` is the
     macOS build's prefix for `AgentPresetSeat.module.css`, which this plugin
     deliberately does not pin. */
  const touched = composer.filter(rule => /bocITq_workspaceLabel|m0vb0q_/u.test(rule.selector));
  assert.deepEqual(touched, []);
});
