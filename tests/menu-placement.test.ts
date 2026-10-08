import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountComposerMenuPlacement } from '../src/client/compat/composer-menus.ts';

interface MenuDouble {
  attributes: Map<string, string>;
  isConnected: boolean;
  style: Record<string, string>;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getAttribute(name: string): string | null;
  querySelector(): null;
  getBoundingClientRect(): { top: number; bottom: number; height: number };
}

/** The open control, as the module's own lookup spells it for each host build. */
const ANCHOR: { readonly hero: string; readonly account: string } = {
  /** `AgentPresetSeat` / the workspace picker: the blank-session chips row. */
  hero: '.ST7X_W_heroWorkspaceRow [aria-expanded="true"]',
  /** The sidebar's account row, the family's third member. */
  account: '.ZogL4G_trigger[aria-expanded="true"]',
};

/**
 * Narrow test double for the compat module's DOM facts: one bottom-edge anchor,
 * one portal menu, a viewport the test moves, and observers the test fires by
 * hand. It makes no claim about the real renderer — the verification record
 * covers that.
 */
function fixture({ viewport = 871, anchorTop = 800, anchorBottom = 828, menuHeight = 110, anchor = ANCHOR.account } = {}) {
  const state = { viewport, menuHeight };
  const control = {
    getAttribute: (name: string) => (name === 'aria-expanded' ? 'true' : null),
    getBoundingClientRect: () => ({ top: anchorTop, bottom: anchorBottom, height: anchorBottom - anchorTop }),
  };
  const menu: MenuDouble = {
    attributes: new Map([['role', 'menu']]),
    isConnected: true,
    /* Mimics CSSStyleDeclaration: reading an unset property answers ''. */
    style: { maxHeight: '', top: '' },
    setAttribute(name, value) { this.attributes.set(name, value); },
    removeAttribute(name) { this.attributes.delete(name); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    querySelector: () => null,
    getBoundingClientRect() { return { top: 0, bottom: state.menuHeight, height: state.menuHeight }; },
  };
  const observers: { callback: (records: unknown[]) => void; disconnected?: boolean }[] = [];
  const listeners = new Map<string, () => void>();
  const documentDouble = {
    body: {},
    documentElement: {
      hasAttribute: () => false,
      getAttribute: () => null,
      setAttribute: () => {},
      removeAttribute: () => {},
    },
    querySelector: (selector: string) => (selector === anchor ? control : null),
    querySelectorAll: () => (menu.getAttribute('role') === 'menu' ? [menu] : []),
  };
  const windowDouble = {
    get innerHeight() { return state.viewport; },
    innerWidth: 1374,
    addEventListener: (type: string, listener: () => void) => { listeners.set(type, listener); },
    removeEventListener: (type: string) => { listeners.delete(type); },
  };
  const MutationObserverDouble = class {
    readonly callback: (records: unknown[]) => void;
    disconnected = false;
    constructor(callback: (records: unknown[]) => void) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  };
  return {
    menu,
    documentDouble,
    windowDouble,
    MutationObserverDouble,
    /** One observer batch: the module's own correction pass. */
    sync: () => { for (const observer of observers) if (!observer.disconnected) observer.callback([]); },
    /** The card grew after it was measured (the account-menu header case). */
    grow: (height: number) => { state.menuHeight = height; },
    /** The picker swaps the surface to a pane that is no longer a menu. */
    dropMenuRole: () => menu.setAttribute('role', 'group'),
  };
}

/** Publish the double as the globals the module reads. Tests run in one process. */
function install(fake: ReturnType<typeof fixture>): void {
  Object.defineProperty(globalThis, 'document', { value: fake.documentDouble, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'window', { value: fake.windowDouble, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'MutationObserver', { value: fake.MutationObserverDouble, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'getComputedStyle', {
    value: (node: unknown) => (node === undefined ? {} : { position: 'fixed', getPropertyValue: () => '' }),
    configurable: true,
    writable: true,
  });
}

test('a card that fits above keeps its own height and stays flush when it grows later', () => {
  const fake = fixture({ menuHeight: 110 });
  install(fake);
  const dispose = mountComposerMenuPlacement(globalThis.document, () => {});
  assert.equal(fake.menu.getAttribute('data-ccd-menu-flipped'), '');
  assert.equal(fake.menu.style.top, '686px', 'card bottom sits 4px above the anchor');
  assert.equal(fake.menu.style.maxHeight, '', 'a fitting card is never ceilinged');

  /* The account menu's header arrives after the first measurement. */
  fake.grow(133);
  fake.sync();
  assert.equal(fake.menu.style.maxHeight, '', 'growth must not meet a stale ceiling');
  assert.equal(fake.menu.style.top, '663px', 'the correction follows the card it now is');
  dispose();
});

test('only a card taller than the free space above is ceilinged', () => {
  const fake = fixture({ viewport: 318, anchorTop: 274, anchorBottom: 302, menuHeight: 280 });
  install(fake);
  const dispose = mountComposerMenuPlacement(globalThis.document, () => {});
  assert.equal(fake.menu.style.maxHeight, '258px', 'the free space above the anchor is the ceiling');
  assert.equal(fake.menu.style.top, '12px', 'the card starts at the frame top margin');
  fake.sync();
  assert.equal(fake.menu.style.maxHeight, '258px', 'the capped height does not feed the next pass');
  dispose();
});

test('a surface that stops being a menu keeps nothing this module wrote', () => {
  const fake = fixture({ viewport: 318, anchorTop: 274, anchorBottom: 302, menuHeight: 280 });
  install(fake);
  const dispose = mountComposerMenuPlacement(globalThis.document, () => {});
  assert.equal(fake.menu.style.maxHeight, '258px');
  /* The model picker drills into its model pane: same node, `role="group"`. */
  fake.dropMenuRole();
  fake.sync();
  assert.equal(fake.menu.style.maxHeight, '', 'the ceiling goes with the surface it was for');
  assert.equal(fake.menu.getAttribute('data-ccd-menu-flipped'), null);
  dispose();
});

test('teardown restores the menu, exactly once', () => {
  const fake = fixture({ viewport: 318, anchorTop: 274, anchorBottom: 302, menuHeight: 280 });
  install(fake);
  const dispose = mountComposerMenuPlacement(globalThis.document, () => {});
  dispose();
  dispose();
  assert.equal(fake.menu.style.maxHeight, '');
  assert.equal(fake.menu.getAttribute('data-ccd-menu-flipped'), null);
});

test('a menu that fits below the anchor is left exactly as the host placed it', () => {
  const fake = fixture({ anchorTop: 100, anchorBottom: 128, menuHeight: 40 });
  install(fake);
  const dispose = mountComposerMenuPlacement(globalThis.document, () => {});
  assert.equal(fake.menu.getAttribute('data-ccd-menu-flipped'), null);
  assert.equal(fake.menu.style.maxHeight, '');
  assert.equal(fake.menu.style.top, '');
  dispose();
});

/*
 * The picker with one workspace: a card a row shorter than the space between
 * the chips row and the window's bottom edge. `below` is the Composer stack
 * itself, so the card fits down there and the primitive keeps it — the reported
 * shape of the picker opening downwards — while the same card with two
 * workspaces is tall enough to be lifted. The side may not depend on how many
 * rows the card happens to have.
 */
test('a short card under the hero chips row opens above the chip, not into the Composer', () => {
  const fake = fixture({ anchor: ANCHOR.hero, anchorTop: 712, anchorBottom: 738, menuHeight: 65 });
  install(fake);
  const dispose = mountComposerMenuPlacement(globalThis.document, () => {});
  assert.equal(fake.menu.getAttribute('data-ccd-menu-flipped'), '', 'the chip owns the side, not the height');
  assert.equal(fake.menu.style.top, '643px', 'card bottom sits 4px above the chip');
  assert.equal(fake.menu.style.maxHeight, '', 'a fitting card is never ceilinged');
  dispose();
});

/*
 * The one case the native side is kept: a window so short that the room below
 * the chips row is the larger of the two. The card shows more of itself down
 * there, so there is nothing to correct.
 */
test('a window whose room below beats the room above keeps the host placement', () => {
  const fake = fixture({ anchor: ANCHOR.hero, viewport: 300, anchorTop: 124, anchorBottom: 150, menuHeight: 40 });
  install(fake);
  const dispose = mountComposerMenuPlacement(globalThis.document, () => {});
  assert.equal(fake.menu.getAttribute('data-ccd-menu-flipped'), null);
  assert.equal(fake.menu.style.maxHeight, '');
  assert.equal(fake.menu.style.top, '');
  dispose();
});
