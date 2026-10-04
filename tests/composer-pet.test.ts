import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ANCHOR } from '../src/client/compat/host-dom.ts';
import { DSH_SLOTS } from '../src/client/compat/slots.ts';
import { PET_BOX, PET_INSET, createPetAnchor } from '../src/client/compat/pet-anchor.ts';
import type { PetAnchor } from '../src/client/compat/pet-anchor.ts';

/* ------------------------------------------------------------------ 页面闸门 */

test('the seat is measured under the hero phase, which is what keeps the pet off a conversation', () => {
  /* DSH computes `phase` as "no session yet, or one that has never carried a
     message" -> hero, everything else -> active. The anchor's selector is the
     pet's only gate: if this string loses `[data-phase="hero"]`, the whale comes
     back to every conversation. */
  assert.match(ANCHOR.composerCardHero, /\[data-phase="hero"\]/);
});

/* ------------------------------------------------------------------ 量测 */

interface Rect { right: number; top: number; width: number; height: number }

/** The browser globals a compat module reaches for, replaced for one fixture. */
const saved = {
  MutationObserver: globalThis.MutationObserver,
  ResizeObserver: globalThis.ResizeObserver,
  window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
};

function restoreGlobals(): void {
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: saved.MutationObserver });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: saved.ResizeObserver });
  if (saved.window === undefined) Reflect.deleteProperty(globalThis, 'window');
  else Object.defineProperty(globalThis, 'window', saved.window);
}

function fixture(options: {
  readonly rect?: Rect;
  readonly card?: boolean;
  readonly hidden?: boolean;
  readonly resizeObserver?: boolean;
} = {}) {
  let rect = options.rect ?? { right: 800, top: 500, width: 770, height: 120 };
  let present = options.card ?? true;
  let pass = () => {};
  let observersDisconnected = 0;
  let observed = 0;

  class FakeObserver {
    constructor(callback: () => void) { pass = callback; }
    observe() { observed += 1; }
    disconnect() { observersDisconnected += 1; }
  }
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: FakeObserver });
  if (options.resizeObserver === false) {
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: undefined });
  } else {
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: FakeObserver });
  }

  const windowListeners = new Set<string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    addEventListener: (type: string) => { windowListeners.add(type); },
    removeEventListener: (type: string) => { windowListeners.delete(type); },
  } });

  const documentListeners = new Set<string>();
  const card = {
    getBoundingClientRect: () => rect,
  };
  const document = {
    hidden: options.hidden ?? false,
    body: {},
    querySelector: (selector: string) => (selector === ANCHOR.composerCardHero && present ? card : null),
    addEventListener: (type: string) => { documentListeners.add(type); },
    removeEventListener: (type: string) => { documentListeners.delete(type); },
  } as unknown as Document;

  const reported: unknown[] = [];
  const anchor = createPetAnchor(document, error => { reported.push(error); });
  let notifications = 0;
  anchor.subscribe(() => { notifications += 1; });
  return {
    anchor,
    reported,
    get notifications() { return notifications; },
    get observed() { return observed; },
    get observersDisconnected() { return observersDisconnected; },
    get windowListeners() { return windowListeners; },
    get documentListeners() { return documentListeners; },
    /** Move the card (column drag, card growth) and run the observer's pass. */
    move(next: Rect) { rect = next; pass(); },
    /** Replace the card with nothing, the way a phase change does. */
    drop() { present = false; pass(); },
    /** The next phase renders a card again. */
    restore() { present = true; pass(); },
    /** Force a pass without changing anything. */
    pass() { pass(); },
  };
}

const seatOf = (rect: Rect): PetAnchor => ({
  left: Math.round(rect.right - PET_BOX.width - PET_INSET),
  top: Math.round(rect.top - PET_BOX.height),
});

test('the frame-wide seat lands on the card\u2019s trailing top corner and follows it', () => {
  const f = fixture();
  try {
    const first = f.anchor.getSnapshot();
    assert.deepEqual(first, seatOf({ right: 800, top: 500, width: 770, height: 120 }));

    /* useSyncExternalStore's hard requirement: an unchanged read must return the
       same object, or React re-renders on every pass. */
    f.pass();
    assert.strictEqual(f.anchor.getSnapshot(), first, 'an unchanged corner keeps its identity');
    assert.equal(f.notifications, 0);

    const moved = { right: 620, top: 480, width: 590, height: 150 };
    f.move(moved);
    assert.deepEqual(f.anchor.getSnapshot(), seatOf(moved));
    assert.notStrictEqual(f.anchor.getSnapshot(), first);
    assert.equal(f.notifications, 1);

    /* A pass that measures the same corner is not a change. */
    f.pass();
    assert.equal(f.notifications, 1);
  } finally {
    f.anchor.dispose();
    restoreGlobals();
  }
});

test('the seat stays empty without a card, without layout, or on a hidden page', () => {
  for (const options of [
    { card: false },
    { rect: { right: 800, top: 500, width: 0, height: 120 } },
    { rect: { right: 800, top: 500, width: 770, height: 0 } },
    { hidden: true },
  ]) {
    const f = fixture(options);
    try {
      assert.equal(f.anchor.getSnapshot(), null, JSON.stringify(options));
    } finally {
      f.anchor.dispose();
      restoreGlobals();
    }
  }
});

test('a rebuilt card is re-observed instead of followed through a dead reference', () => {
  const f = fixture();
  try {
    assert.deepEqual(f.anchor.getSnapshot(), seatOf({ right: 800, top: 500, width: 770, height: 120 }));

    /* Phase change: the card leaves and a new one arrives — the seat follows the
       new node, not the dead reference. */
    f.drop();
    assert.equal(f.anchor.getSnapshot(), null);
    f.restore();
    assert.deepEqual(f.anchor.getSnapshot(), seatOf({ right: 800, top: 500, width: 770, height: 120 }));
    assert.equal(f.observed >= 2, true, 'each card is observed once');
  } finally {
    f.anchor.dispose();
    restoreGlobals();
  }
});

test('a document without ResizeObserver still measures through the mutation observer', () => {
  const f = fixture({ resizeObserver: false });
  try {
    assert.deepEqual(f.anchor.getSnapshot(), seatOf({ right: 800, top: 500, width: 770, height: 120 }));
    f.move({ right: 900, top: 460, width: 870, height: 120 });
    assert.deepEqual(f.anchor.getSnapshot(), seatOf({ right: 900, top: 460, width: 870, height: 120 }));
  } finally {
    f.anchor.dispose();
    restoreGlobals();
  }
});

test('dispose releases every observer and listener and stops publishing', () => {
  const f = fixture();
  try {
    assert.equal(f.windowListeners.has('resize'), true);
    assert.deepEqual([...f.documentListeners].sort(), ['scroll', 'visibilitychange']);
    f.anchor.dispose();
    assert.equal(f.windowListeners.size, 0);
    assert.equal(f.documentListeners.size, 0);
    /* The mutation observer and the card observer are both released. */
    assert.equal(f.observersDisconnected, 2);
    assert.equal(f.anchor.getSnapshot(), null);

    const notifications = f.notifications;
    f.move({ right: 1000, top: 400, width: 900, height: 120 });
    assert.equal(f.notifications, notifications, 'a released source must not publish');
    assert.equal(f.anchor.getSnapshot(), null);
  } finally {
    f.anchor.dispose();
    restoreGlobals();
  }
});

test('a frame without a body reports once and leaves an inert seat instead of throwing', () => {
  const savedObserver = globalThis.MutationObserver;
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class {
    constructor() { throw new Error('no observer in this frame'); }
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener: () => {}, removeEventListener: () => {} } });
  try {
    const reported: unknown[] = [];
    const document = { body: null, querySelector: () => null, addEventListener: () => {}, removeEventListener: () => {}, hidden: false } as unknown as Document;
    const anchor = createPetAnchor(document, error => { reported.push(error); });
    assert.equal(reported.length, 1);
    assert.equal(anchor.getSnapshot(), null);
    /* The inert source is still disposable and subscribable. */
    const off = anchor.subscribe(() => {});
    off();
    anchor.dispose();
  } finally {
    Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: savedObserver });
    if (savedWindow === undefined) Reflect.deleteProperty(globalThis, 'window');
    else Object.defineProperty(globalThis, 'window', savedWindow);
  }
});

/* ------------------------------------------------------------------ 尺寸契约 */

const petCss = readFileSync(new URL('../src/client/features/composer-pet/pet.css', import.meta.url), 'utf8');

function ruleBody(selector: string): string {
  const escaped = selector.replace(/\./g, '\\.');
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(petCss)?.[1] ?? '';
}

test('the measured box is the box the stylesheet draws', () => {
  for (const selector of ['.ccd-pet-blank-seat', '.ccd-composer-pet']) {
    const body = ruleBody(selector);
    assert.match(body, new RegExp(`width:\\s*${PET_BOX.width}px`), `${selector} width`);
    assert.match(body, new RegExp(`height:\\s*${PET_BOX.height}px`), `${selector} height`);
  }
});

test('the seat is inset from the card\u2019s trailing edge by the measured amount', () => {
  /* `pet-anchor.ts` publishes `right - PET_BOX.width - PET_INSET`; the artwork
     is what fills that box, so the inset only has to stay a real number the
     anchor and the stylesheet agree on. */
  assert.match(ruleBody('.ccd-pet-blank-seat'), /position:\s*fixed/);
  assert.equal(PET_INSET, 12);
});

/* ------------------------------------------------------------------ 宠物契约 */

const whaleArt = readFileSync(new URL('../src/client/features/composer-pet/Whale.tsx', import.meta.url), 'utf8');
const composerPet = readFileSync(new URL('../src/client/features/composer-pet/ComposerPet.tsx', import.meta.url), 'utf8');
const petMount = readFileSync(new URL('../src/client/features/composer-pet/mount.ts', import.meta.url), 'utf8');

/** The code without its comments: these contracts are about what runs, and the
    modules explain the removed seats in prose on purpose. */
const withoutComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('the artwork\u2019s grid is the box the anchor measures', () => {
  assert.match(whaleArt, new RegExp(`viewBox="0 0 ${PET_BOX.width} ${PET_BOX.height}"`));
  assert.match(whaleArt, new RegExp(`width="${PET_BOX.width}" height="${PET_BOX.height}"`));
  /* The body still ends on y 23, one row above the card's top edge. */
  assert.match(whaleArt, /M1 11V9H2V7H4V5H7V4H12V5H15V4H18V5/);
});

test('only the whale accepts clicks: the surrounding seat stays click-through and reactions stay local', () => {
  assert.match(ruleBody('.ccd-pet-blank-seat'), /pointer-events:\s*none/);
  assert.match(ruleBody('.ccd-composer-pet'), /pointer-events:\s*auto/);
  assert.match(composerPet, /type="button"/);
  assert.match(composerPet, /aria-label="Play with the whale"/);
  assert.doesNotMatch(withoutComments(composerPet), /setTimeout|running|useSyncExternalStore|data-ccd-pet-state/);
});

test('the pet has one seat, and it is the new-session one', () => {
  /* The in-card overlay (`conversation.input.overlay`) only exists while a
     Session does — the opposite page — so registering there would put the whale
     back into every conversation. The frame-wide seat is the only one. */
  assert.doesNotMatch(withoutComments(petMount), /input\.overlay|composerOverlay|SlotPet/);
  assert.match(withoutComments(petMount), /DSH_SLOTS\.shellOverlay/);
  assert.match(withoutComments(petMount), /features\['new-session'\]/);
  assert.equal('composerOverlay' in DSH_SLOTS, false, 'the in-card slot is no longer part of the registry');
});
