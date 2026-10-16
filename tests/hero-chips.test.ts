import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HERO_CHIP_WIDTH_PROPERTY, mountHeroChips } from '../src/client/compat/hero-chips.ts';
import { HOST } from '../src/client/compat/host-dom.ts';

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

/** The Composer stack that carries the row and the reserve built from it. */
const HERO = 'html[data-dsh-ccd-style="true"] .ST7X_W_composerHero';

/** The row itself. */
const ROW = 'html[data-dsh-ccd-style="true"] .ST7X_W_heroWorkspaceRow';

/** The picker's own chip. */
const PICKER = `${ROW} .bocITq_workspace`;

/** The picker's label: the box the ellipsis is drawn in. */
const LABEL = 'html[data-dsh-ccd-style="true"] .bocITq_workspaceLabel';

/** The preset's seat: the `Menu` anchor around its button, the row's flex item. */
const PRESET = `${ROW} [data-slot="conversation.hero.agentPreset"] > :first-child`;

test('the row sizes to its content and only long workspace names are capped', () => {
  const hero = composer.find(rule => rule.selector === HERO);
  assert.match(hero?.body ?? '', /--ccd-workspace-seat:\s*280px/u);
  const row = composer.find(rule => rule.selector === ROW);
  assert.match(row?.body ?? '', /width:\s*max-content/u);
  const picker = composer.find(rule => rule.selector === PICKER);
  assert.match(picker?.body ?? '', /width:\s*max-content/u);
  assert.match(picker?.body ?? '', /max-width:\s*clamp\(100px, 24cqw, 240px\)/u);
  const label = composer.find(rule => rule.selector === LABEL);
  assert.match(label?.body ?? '', /text-overflow:\s*ellipsis/u);
});

test('the preset seat never shrinks, and the sheet names its wrapper without its module', () => {
  const preset = composer.find(rule => rule.selector.includes(PRESET));
  assert.ok(preset, 'composer.css should hold the preset seat’s own box');
  assert.match(preset?.body ?? '', /flex:\s*none/u);
  /* The seat's module prefix is not a pinned name, so the button inside it is
     what names the wrapper — and no `m0vb0q_` class may be written down here. */
  assert.ok(!/m0vb0q_/u.test(composer.map(rule => rule.selector).join('\n')));
});

test('the tool row reserves the row plus one gap, which is what the row now measures', () => {
  const reserve = composer.find(rule => rule.selector.includes(':has(.ST7X_W_heroWorkspaceRow) .yhfFVG_tools'));
  assert.ok(reserve, 'composer.css should reserve the row’s width in the tool row');
  assert.match(reserve?.body ?? '', /padding-left:\s*calc\(var\(--ccd-workspace-seat\) \+ var\(--ccd-hero-control-gap\)\)/u);
});

/** DOM double for the published width, not a browser geometry assertion. */
function fixture(width = 92) {
  const properties = new Map<string, string>();
  const observed = new Set<unknown>();
  let seatWidth = width;
  let seatConnected = true;
  let row = true;
  let resizeCallback: () => void = () => {};
  let mutationCallback: () => void = () => {};
  let sizesDisconnected = false;
  let mutationsDisconnected = false;
  const stack = {
    style: {
      getPropertyValue: (key: string) => properties.get(key) ?? '',
      setProperty: (key: string, value: string) => { properties.set(key, value); },
      removeProperty: (key: string) => { properties.delete(key); },
    },
  };
  const seat = {
    get isConnected() { return seatConnected; },
    getBoundingClientRect: () => ({ width: seatWidth }),
  };
  const element = {
    closest: (selector: string) => selector === HOST.composerStack ? stack : null,
    get isConnected() { return seat.isConnected; },
    getBoundingClientRect: () => seat.getBoundingClientRect(),
  };
  const doc = {
    documentElement: {},
    querySelector: (selector: string) => selector === HOST.heroWorkspaceRow && row ? element : null,
  };
  const Sources = class {
    constructor(callback: () => void) { resizeCallback = callback; }
    observe(node: unknown) { observed.add(node); }
    disconnect() { sizesDisconnected = true; observed.clear(); }
  };
  const Mutations = class {
    constructor(callback: () => void) { mutationCallback = callback; }
    observe() {}
    disconnect() { mutationsDisconnected = true; }
  };
  Object.defineProperty(globalThis, 'ResizeObserver', { value: Sources, configurable: true });
  Object.defineProperty(globalThis, 'MutationObserver', { value: Mutations, configurable: true });
  const errors: unknown[] = [];
  const dispose = mountHeroChips(doc as unknown as Document, error => errors.push(error));
  return {
    properties, errors, dispose,
    get observed() { return observed; },
    get sizesDisconnected() { return sizesDisconnected; },
    get mutationsDisconnected() { return mutationsDisconnected; },
    resize: (next: number) => { seatWidth = next; resizeCallback(); },
    replaceSeat: () => { row = false; mutationCallback(); row = true; mutationCallback(); },
    detachSeat: () => { seatConnected = false; mutationCallback(); },
  };
}

test('the seat’s own width is published where the row and the reserve read it', () => {
  const f = fixture(92.4);
  assert.equal(f.properties.get(HERO_CHIP_WIDTH_PROPERTY), '92px', 'the sheet consumes whole px');
  assert.deepEqual(f.errors, []);
  f.dispose();
});

test('a re-measure rides the seat’s own resize, and identical widths are not rewritten', () => {
  const f = fixture();
  f.resize(124.6);
  assert.equal(f.properties.get(HERO_CHIP_WIDTH_PROPERTY), '125px');
  const before = f.properties.get(HERO_CHIP_WIDTH_PROPERTY);
  f.resize(125);
  assert.equal(f.properties.get(HERO_CHIP_WIDTH_PROPERTY), before, 'a settled width stays quiet');
  f.dispose();
});

test('an unlaid seat publishes nothing rather than capping both chips to zero', () => {
  const f = fixture(0);
  assert.equal(f.properties.has(HERO_CHIP_WIDTH_PROPERTY), false);
  f.resize(0);
  assert.equal(f.properties.has(HERO_CHIP_WIDTH_PROPERTY), false);
  f.resize(96);
  assert.equal(f.properties.get(HERO_CHIP_WIDTH_PROPERTY), '96px');
  f.dispose();
});

test('a seat React replaces is re-bound and read again', () => {
  const f = fixture();
  assert.equal(f.observed.size, 1, 'the live seat is the one watched');
  f.replaceSeat();
  assert.equal(f.observed.size, 1, 'the replaced seat is dropped for the new one');
  f.resize(108);
  assert.equal(f.properties.get(HERO_CHIP_WIDTH_PROPERTY), '108px');
  f.detachSeat();
  f.dispose();
});

test('teardown takes the property back and leaves both observers disconnected', () => {
  const f = fixture();
  f.dispose();
  assert.equal(f.properties.has(HERO_CHIP_WIDTH_PROPERTY), false);
  assert.equal(f.sizesDisconnected, true);
  assert.equal(f.mutationsDisconnected, true);
});
