import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * Idle Session row contract.
 *
 * DSH gives a Session row's leading 16px cell a mark only while the row has a
 * status of its own: `ui-workspace`'s SessionNodeItem renders the activity ring
 * or a state dot when the primary status is not `idle`, and otherwise calls
 * `renderSlot('sidebar.session.row.leading')` — the plugin seat, which is empty
 * until something registers into it. The stylesheet fills that seat with the
 * activity ring's own circle, still, so an idle row keeps the column's left
 * edge instead of starting 16px early (docs/issues/14-idle-session-ring.md).
 *
 * These tests pin the two halves that must stay in step: the ring rule reads
 * the seat's *empty* outlet, and the mask it paints is the spinner's own
 * geometry at the spinner's own scale. Read from the shipped `0.2.0-rc.2`
 * `ui-workspace` and `ui-primitives` sources.
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

const sidebar = rules(read('../src/client/features/sidebar/sidebar.css'));
const tokensSheet = read('../src/client/theme/tokens.css');

const ringRules = sidebar.filter(rule => rule.body.includes('--ccd-icon-session-ring'));

test('an idle Session paints the still ring in its empty leading seat', () => {
  assert.equal(ringRules.length, 1);
  const [rule] = ringRules;
  const selector = rule?.selector ?? '';
  /* Gated like every other sidebar rule, and only on a Session row. */
  assert.ok(selector.includes('[data-dsh-ccd-style="true"]'), selector);
  assert.ok(selector.includes('.jJkEga_sessionRow'), selector);
  /* The archived row's cell belongs to the archive mark alone. */
  assert.ok(selector.includes(':not(.jJkEga_archived)'), selector);
  /* The seat's outlet is what tells "idle" from "marked": a row with a status
     never renders the seat, and a seat with a registered entry (ui-schedule's
     task mark) is not empty, so neither can match. */
  assert.ok(
    selector.includes('> .jJkEga_slot:has(> div[data-slot="sidebar.session.row.leading"]:empty)'),
    selector,
  );
  assert.match(rule?.body ?? '', /width:\s*8px/u);
  assert.match(rule?.body ?? '', /height:\s*8px/u);
  /* The mark is the cell's own ink, so it follows the host theme instead of an
     authored colour. */
  assert.match(rule?.body ?? '', /background-color:\s*currentColor/u);
  assert.match(rule?.body ?? '', /mask:\s*var\(--ccd-icon-session-ring\)\s+center\s*\/\s*8px 8px no-repeat/u);
});

test('the still ring is the activity ring geometry at the spinner’s scale', () => {
  const declared = /--ccd-icon-session-ring:\s*url\("([^"]+)"\)/u.exec(tokensSheet);
  assert.ok(declared !== null, 'tokens.css should declare --ccd-icon-session-ring');
  const artwork = decodeURIComponent(declared[1] ?? '');
  /* ui-primitives' StateDot spinner draws the ongoing ring as two circles of
     r 9.5 with a 2-unit stroke on a 24-unit canvas; the still ring is that same
     circle, so the two marks differ only by motion. */
  assert.match(artwork, /viewBox='0 0 24 24'/u);
  assert.match(artwork, /cx='12' cy='12' r='9\.5'/u);
  assert.match(artwork, /stroke-width='2'/u);
  /* One scale for both: the running mark is scaled to 8px by the rule next to
     this one, and the ring is painted at the same 8px. */
  const spinner = sidebar.filter(rule => rule.selector.includes('svg[data-state="ongoing"]'));
  assert.equal(spinner.length, 1);
  assert.match(spinner[0]?.body ?? '', /width:\s*8px/u);
  assert.match(spinner[0]?.body ?? '', /height:\s*8px/u);
});
