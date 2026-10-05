import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { permissionCopy } from '../src/client/compat/permission-menu.ts';

/*
 * The permission card: the popup family's one two-line row.
 *
 * DSH draws the four permission presets as flat cells — a name on one 20px line
 * — and the reference draws each as the mode's name over a sentence saying what
 * the mode does. `compat/permission-menu.ts` recognises a row by the name it
 * draws (the primitive gives a row no identity of its own), writes the second
 * line and tags the row and its card; `theme/menus.css` draws what it tagged,
 * in the block at the end of that sheet. This file pins both halves: the cell's
 * geometry, measured from the reference at @2x, and the copy tables the module
 * recognises rows by — the one place where a host wording change would silently
 * stop the card being recognised at all.
 *
 * Two facts decide how the sheet's rules are written, and both are asserted:
 * - they outrank the family's row rule (menus.css, "One row, one cell") on
 *   specificity rather than on sheet order, so a two-line cell is never left
 *   clipped by the 24px floor it inherits;
 * - they are scoped to the *rows this module tagged* and to the card that holds
 *   them. The chip in the status bar draws the same `.wXeviG_badge`, and it is
 *   not this card: it keeps the host's 8px superscript.
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

const MARKER = 'html[data-dsh-ccd-style="true"]';
const menus = rules(read('../src/client/theme/menus.css'));

/** The cell this module's tag names. */
const ROW = `${MARKER} [data-menu-material][data-ccd-permission-menu]`
  + ' [role="menuitem"][data-ccd-permission-mode]';

/** Attribute selectors in one selector — what the cascade is decided on here. */
const attributes = (selector: string): number => (selector.match(/\[[^\]]+\]/gu) ?? []).length;

test('the two-line cell outranks the family’s 24px row on specificity', () => {
  /* The family rule states the 24px floor and the 2px block padding at 0-4-1;
     a rule that only tied with it would be decided by sheet order, which is not
     a contract. The family rule names both row families, so the half this card's
     rows would match is the `menuitem` one. */
  const family = menus.find(rule => rule.body.includes('min-height: 24px'));
  assert.ok(family !== undefined, 'the 24px cell is the family row rule');
  const familyRow = family.selector.split(',')
    .map(part => part.trim())
    .find(part => part.endsWith('[role="menuitem"]'));
  assert.ok(familyRow !== undefined, family.selector);
  const cell = ruleFor(menus, '[data-ccd-permission-menu] [role="menuitem"][data-ccd-permission-mode]');
  assert.ok(attributes(cell.selector) > attributes(familyRow),
    `${cell.selector} (${attributes(cell.selector)}) must outrank ${familyRow} (${attributes(familyRow)})`);
});

test('one row is two lines: the name over its sentence, forty pixels', () => {
  const body = ruleFor(menus, '[data-ccd-permission-menu] [role="menuitem"][data-ccd-permission-mode]').body;
  /* Pinned against the box model: the page default is content-box, where the
     same declarations would build a 44px row. */
  assert.match(body, /box-sizing:\s*border-box/u);
  /* 14px on a 20px line over 12px on a 16px line, flush, on the family's own 2px
     of block padding — the reference's 40.25px per row, measured at @2x. */
  assert.match(body, /min-height:\s*40px/u);
  assert.match(body, /padding-block:\s*2px/u);
  assert.ok(!body.includes('min-height: 24px'), body);
  /* A grid, not the host's flex line: two rows of one column, with the trailing
     mark in the second column spanning both. Auto-placement would fill the
     first row's two cells and push the check to a third line. */
  assert.match(body, /display:\s*grid/u);
  assert.match(body, /grid-template-columns:\s*minmax\(0, 1fr\) auto/u);
  assert.match(body, /row-gap:\s*0/u);
  /* The corner and the one fill stay the family's: a row that restated them
     would drift from the rest of the popups. */
  assert.ok(!/border-radius|background/u.test(body), body);
});

test('the name, the sentence and the mark are placed by hand', () => {
  assert.match(ruleFor(menus, `${ROW} > ._itemLabel_4ub78_190`).body, /grid-area:\s*1 \/ 1/u);
  const description = ruleFor(menus, '[data-ccd-permission-menu] [data-ccd-permission-desc]').body;
  assert.match(description, /grid-area:\s*2 \/ 1/u);
  /* The document's 弱化墨: the reference measures its sentence at #898782, a
     clear step under the name it sits below. */
  assert.match(description, /color:\s*var\(--ccd-text-muted\)/u);
  assert.match(description, /font-size:\s*12px/u);
  assert.match(description, /line-height:\s*16px/u);
  /* One line, and it is what sizes the card: the reference's card is as wide as
     its longest sentence, and a wrapping sentence would instead let the card
     settle on the widest *name*. */
  assert.match(description, /white-space:\s*nowrap/u);
  assert.match(description, /text-overflow:\s*ellipsis/u);
  const check = ruleFor(menus, '[data-ccd-permission-mode] > ._check_4ub78_179').body;
  assert.match(check, /grid-area:\s*1 \/ 2 \/ span 2/u);
  assert.match(check, /align-self:\s*center/u);
  /* Ink only: `theme/tokens.css` owns the check's colour and this cell must not
     restate it (`._check_4ub78_179` is not named here for that reason). */
  assert.ok(!/color|stroke|fill/u.test(check), check);
});

test('the badge is the reference’s pill, on the rows and not on the chip', () => {
  const badge = menus.filter(rule => rule.selector.includes('.wXeviG_badge'));
  assert.equal(badge.length, 1, 'one rule draws the badge');
  const rule = badge[0] as Rule;
  /* The chip in the status bar wears the same class and is the same control the
     card opens from, but it is a 20px chip, not this card: the rule reaches the
     tagged rows only and leaves the host's superscript alone. */
  assert.ok(rule.selector.includes('[data-ccd-permission-menu]'), rule.selector);
  assert.ok(rule.selector.includes('[data-ccd-permission-mode]'), rule.selector);
  const body = rule.body;
  /* 16px tall — a 12px name on a 16px line with no block padding — beside the
     row's name rather than above it, and rounder than a superscript, squarer
     than the chip and card step. */
  assert.match(body, /align-self:\s*center/u);
  assert.match(body, /margin-top:\s*0/u);
  assert.match(body, /padding:\s*0 5px/u);
  assert.match(body, /border-radius:\s*4px/u);
  assert.match(body, /font-size:\s*12px/u);
  assert.match(body, /line-height:\s*16px/u);
  /* The host's superscript type — 8px at weight 600 with letter-spacing — is
     what a pill is not, so every one of those is stated back. */
  assert.match(body, /font-weight:\s*400/u);
  assert.match(body, /letter-spacing:\s*normal/u);
  /* The fill is the palette's track step: the measured #f3f3f3, and the one
     surface in the palette that stays clear of the row's own hover fill
     (`--ccd-hover`) in both schemes. */
  assert.match(body, /background:\s*var\(--ccd-track\)/u);
  assert.match(body, /color:\s*var\(--ccd-text-secondary\)/u);
  const gap = ruleFor(menus, '[data-ccd-permission-mode] .wXeviG_optionLabel').body;
  assert.match(gap, /column-gap:\s*6px/u);
});

test('the group’s name sits above the rows, in the host’s own heading row', () => {
  const head = ruleFor(menus, '[data-ccd-permission-menu] ._viewport_4ub78_19 > [data-ccd-permission-heading]').body;
  /* A cell of the family's rhythm plus the reference's own breathing room above
     it (~29px between the card's top edge and the first row). */
  assert.match(head, /padding-block:\s*6px 2px/u);
  /* Type, ink and start padding stay the family heading rule's. */
  assert.ok(!/font-size|color|padding:/u.test(head), head);
});

test('every rule the card adds is scoped to the tag and to the popup family', () => {
  const added = menus.filter(rule => rule.selector.includes('data-ccd-permission'));
  assert.equal(added.length, 7, 'the permission block is seven rules');
  for (const rule of added) {
    assert.ok(rule.selector.startsWith(MARKER), rule.selector);
    assert.ok(rule.selector.includes('[data-menu-material]'), rule.selector);
  }
});

/** A document double carrying only what the language lookup reads. */
const languageDouble = (lang: string) =>
  ({ documentElement: { lang } }) as unknown as Document;

/** What DSH renders for the four presets, per `ui-permission-presets`' dictionaries. */
const HOST_NAMES = {
  zh: ['仅可查看', '工作区内修改', '完全权限', 'Auto review'],
  en: ['Read Only', 'Workspace Write', 'Full access', 'Auto review'],
} as const;

test('a row is recognised by the name DSH renders for it', () => {
  /* This is the module's whole contract with the host: the primitive puts no id,
     no data attribute and no stable class on a row (and the preset's own glyph
     is hidden by `theme/menus.css`), so the localised name is the only handle.
     A DSH release that reworded one of these would stop that row from being
     recognised — silently, and in the safe direction: it would keep the host's
     single-line cell. */
  for (const [language, names] of [['zh-CN', HOST_NAMES.zh], ['en', HOST_NAMES.en]] as const) {
    const copy = permissionCopy(languageDouble(language));
    assert.deepEqual(copy.presets.map(preset => preset.name), [...names]);
  }
});

test('the table is one entry per preset, and every entry says something', () => {
  for (const language of ['zh-CN', 'en']) {
    const copy = permissionCopy(languageDouble(language));
    assert.equal(copy.presets.length, 4, 'four presets, one row each');
    for (const preset of copy.presets) {
      assert.ok(preset.value.length > 0 && preset.label.length > 0, preset.value);
      assert.ok(preset.description.length > 0, preset.value);
      assert.notEqual(preset.description, preset.label, preset.value);
    }
    /* The values are DSH's own machine names: they are what the tag carries and
       what the stylesheet keys on, so they are not the plugin's to word. */
    assert.deepEqual(copy.presets.map(preset => preset.value).sort(),
      ['auto', 'danger-full-access', 'read-only', 'workspace-write']);
  }
});

test('the host’s wording is kept wherever DSH already names the mode in Chinese', () => {
  const copy = permissionCopy(languageDouble('zh-CN'));
  for (const preset of copy.presets) {
    /* Three of the four rows draw exactly what DSH renders, because the same
       mode is named on the chip, in the settings page and in the trigger's own
       `title`: a card that renamed one would be the odd surface out. */
    const expected = preset.value === 'auto' ? '自动审查' : preset.name;
    assert.equal(preset.label, expected, preset.value);
  }
  /* The one preset DSH leaves in English in its Chinese dictionary, and the
     badge it marks that preset with. */
  const auto = copy.presets.find(preset => preset.value === 'auto');
  assert.equal(auto?.name, 'Auto review');
  assert.deepEqual(auto?.badge, { host: 'EXP', text: '实验' });
  assert.equal(copy.heading, '模式');
  for (const preset of copy.presets) {
    if (preset.value !== 'auto') assert.equal(preset.badge, undefined, preset.value);
  }
});

test('the English table restates the host’s names, so no rewrite is a silent edit', () => {
  const copy = permissionCopy(languageDouble('en'));
  for (const preset of copy.presets) {
    assert.equal(preset.label, preset.name, preset.value);
  }
  assert.equal(copy.heading, 'Mode');
  assert.deepEqual(copy.presets.find(preset => preset.value === 'auto')?.badge,
    { host: 'EXP', text: 'EXP' });
});

test('a document that is not Chinese takes the English table', () => {
  /* The same rule `compat/header-labels.ts` follows: a document without a
     language of its own is not a Chinese one. */
  assert.equal(permissionCopy(languageDouble('')).heading, 'Mode');
  assert.equal(permissionCopy(languageDouble('de')).heading, 'Mode');
  assert.equal(permissionCopy(languageDouble('zh-Hans-CN')).heading, '模式');
});

test('the module is mounted with the other Composer compat modules', () => {
  const assembly = read('../src/client/apply.ts');
  assert.match(assembly, /import \{ mountPermissionMenu \} from '\.\/compat\/permission-menu\.ts'/u);
  assert.match(assembly, /scope\.add\(mountPermissionMenu\(/u);
});
