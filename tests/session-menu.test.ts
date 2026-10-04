import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MENU_ROW_ATTRIBUTE, mountSessionMenuRow } from '../src/client/compat/session-menu.ts';

/*
 * Session menu contract.
 *
 * `session-log-export` owns the header's ⋮ menu and offers no slot for a
 * third-party row, so `compat/session-menu.ts` adds one to the list the host
 * drew — copied from a native row, which is what keeps it native-looking without
 * pinning a hashed class. These tests pin the five facts the copy depends on:
 * the row is the card's *first* (so it leads the primitive's keyboard walk, which
 * is DOM order), it joins the host's own viewport, it carries only the label and
 * this module's marker (the reference draws no leading glyph), it exists exactly
 * while its predicate says so, and choosing it runs the caller's action before
 * the menu's own trigger is clicked closed again.
 */

/** The small slice of the DOM this module touches, with real tree behaviour. */
class FakeElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  readonly listeners = new Map<string, (() => void)[]>();
  text = '';

  constructor(tagName: string, attributes: Record<string, string> = {}) {
    this.tagName = tagName;
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
  }

  get parentElement(): FakeElement | null { return this.parent; }

  /** Attached to the fake document's own root, which is the `html` element. */
  get isConnected(): boolean {
    let node: FakeElement = this;
    while (node.parent !== null) node = node.parent;
    return node.tagName === 'html';
  }

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }

  removeAttribute(name: string): void { this.attributes.delete(name); }

  /** The one reflected property this module writes; `disabled` is the attribute. */
  get disabled(): boolean { return this.attributes.has('disabled'); }

  set disabled(value: boolean) {
    if (value) this.attributes.set('disabled', '');
    else this.attributes.delete('disabled');
  }

  get textContent(): string {
    return this.children.length === 0 ? this.text : this.children.map(child => child.textContent).join('');
  }

  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }

  append(...children: FakeElement[]): void {
    this.insert(this.children.length, children);
  }

  prepend(...children: FakeElement[]): void {
    this.insert(0, children);
  }

  private insert(index: number, children: readonly FakeElement[]): void {
    for (const child of children) {
      child.parent?.children.splice(child.parent.children.indexOf(child), 1);
      child.parent = this;
      
      this.children.splice(index, 0, child);
      index += 1;
    }
  }

  remove(): void {
    if (this.parent === null) return;
    this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }

  cloneNode(deep = false): FakeElement {
    const clone = new FakeElement(this.tagName, Object.fromEntries(this.attributes));
    clone.text = this.text;
    if (deep) for (const child of this.children) clone.append(child.cloneNode(true));
    return clone;
  }

  addEventListener(type: string, listener: () => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  click(): void {
    for (const listener of this.listeners.get('click') ?? []) listener();
  }

  /** One compound selector: tag, `.class`es and `[attr]`／`[attr="value"]` parts. */
  matches(selector: string): boolean {
    const tokens = selector.match(/^[a-zA-Z][\w-]*|\.[\w-]+|\[[^\]]+\]/gu) ?? [];
    if (tokens.length === 0) return false;
    return tokens.every(token => {
      if (token.startsWith('.')) {
        return (this.attributes.get('class') ?? '').split(/\s+/u).includes(token.slice(1));
      }
      const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/u.exec(token);
      if (attribute !== null) {
        return attribute[2] === undefined
          ? this.attributes.has(attribute[1] ?? '')
          : this.attributes.get(attribute[1] ?? '') === attribute[2];
      }
      return this.tagName === token;
    });
  }

  /** Flat descendant-combinator matching; enough for the selectors under test. */
  private matchesChain(selector: string): boolean {
    const parts = selector.trim().split(/\s+/u);
    let node: FakeElement | null = this;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index] ?? '';
      if (index === parts.length - 1) {
        if (node === null || !node.matches(part)) return false;
        node = node.parent;
        continue;
      }
      let ancestor: FakeElement | null = node;
      while (ancestor !== null && !ancestor.matches(part)) ancestor = ancestor.parent;
      if (ancestor === null) return false;
      node = ancestor.parent;
    }
    return true;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const visit = (element: FakeElement) => {
      for (const child of element.children) {
        if (child.matchesChain(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

/** Observer double recording the last instance so a test can force a pass. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly callback: () => void;
  disconnected = false;
  constructor(callback: () => void) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }
  observe(): void {}
  disconnect(): void { this.disconnected = true; }
}

/** The header's open ⋮ menu: its trigger, `Menu`'s root span and a native row. */
function sessionMenu(expanded = 'true'): { root: FakeElement; header: FakeElement; trigger: FakeElement; viewport: FakeElement } {
  const header = new FakeElement('div', { class: 'ST7X_W_header' });
  const root = new FakeElement('span', { class: '_root_4ub78_1' });
  const trigger = new FakeElement('button', {
    class: 'Da3aKq_moreButton', 'aria-haspopup': 'menu', 'aria-expanded': expanded,
  });
  trigger.addEventListener('click', () => {
    trigger.setAttribute('aria-expanded', trigger.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
  });
  const list = new FakeElement('div', { role: 'menu', 'data-menu-material': 'translucent' });
  const viewport = new FakeElement('div', { role: 'presentation', class: '_viewport_4ub78_19' });
  const wrap = new FakeElement('div', { class: '_itemWrap_4ub78_10' });
  const button = new FakeElement('button', { type: 'button', role: 'menuitem', class: '_item_4ub78_11' });
  const seat = new FakeElement('span', { class: '_itemIcon_4ub78_148' });
  seat.append(new FakeElement('svg', { viewBox: '0 0 16 16' }));
  const label = new FakeElement('span', { class: '_itemLabel_4ub78_12' });
  label.textContent = '下载 Session 日志';
  button.append(seat, label);
  wrap.append(button);
  viewport.append(wrap);
  list.append(new FakeElement('div', { 'aria-hidden': 'true', class: '_material_4ub78_3' }), viewport);
  root.append(trigger, list);
  header.append(root);
  return { root: header, header, trigger, viewport };
}

/** A document double over one fake tree; the build probe misses and stays pinned. */
function fakeDocument(tree: FakeElement): Document {
  const documentElement = new FakeElement('html');
  documentElement.append(tree);
  return {
    documentElement,
    querySelector: (selector: string) => documentElement.querySelector(selector),
  } as unknown as Document;
}

/** Mount against a stubbed observer and hand back a forced-pass callback. */
function mount(
  document: Document,
  row: Parameters<typeof mountSessionMenuRow>[1],
  report: (error: unknown) => void = error => { throw error; },
): { sync: () => void; dispose: () => void } {
  const original = globalThis.MutationObserver;
  FakeObserver.instances = [];
  globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
  try {
    const dispose = mountSessionMenuRow(document, row, report);
    return {
      sync: () => { FakeObserver.instances.at(-1)?.callback(); },
      dispose: () => {
        dispose();
        globalThis.MutationObserver = original;
      },
    };
  } catch (error) {
    globalThis.MutationObserver = original;
    throw error;
  }
}

test('the row leads the menu with this module\u2019s label', () => {
  const { header, trigger, viewport } = sessionMenu();
  const document = fakeDocument(header);
  const actions: string[] = [];
  const mounted = mount(document, {
    label: '打开侧边栏',
    wanted: () => true,
    act: () => { actions.push('expand'); },
  });
  try {
    const rows = viewport.querySelectorAll('[role="menuitem"]');
    assert.equal(rows.length, 2, 'this module\u2019s copy and the native row');
    const added = rows[0];
    assert.equal(added?.getAttribute(MENU_ROW_ATTRIBUTE), '');
    assert.equal(added?.parentElement?.getAttribute(MENU_ROW_ATTRIBUTE), '');
    assert.equal(added?.textContent, '打开侧边栏');
    /* The first row of the card is the row this module added: the host's own
       row keeps its place behind it. */
    assert.equal(viewport.children[0], added?.parentElement);
    assert.equal(viewport.children[1]?.querySelector('[role="menuitem"]')?.textContent, '下载 Session 日志');
    /* No artwork and no empty seat left behind it: one label per row. */
    assert.equal(added?.querySelector('svg'), null);
    assert.equal(added?.parentElement?.querySelector('svg'), null);
    assert.equal(added?.children.length, 1);

    added?.click();
    assert.deepEqual(actions, ['expand']);
    /* The menu's own toggle closes it: the trigger the reader opened it with. */
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    mounted.sync();
    assert.equal(viewport.querySelectorAll('[role="menuitem"]').length, 1, 'a closed menu holds no row');
  } finally {
    mounted.dispose();
  }
});

test('the row exists exactly while its predicate says so', () => {
  const { header, viewport } = sessionMenu();
  const document = fakeDocument(header);
  let wanted = false;
  const mounted = mount(document, { label: 'Open sidebar', wanted: () => wanted, act: () => {} });
  try {
    assert.equal(viewport.querySelectorAll('[role="menuitem"]').length, 1);
    wanted = true;
    mounted.sync();
    assert.equal(viewport.querySelectorAll('[role="menuitem"]').length, 2);
    wanted = false;
    mounted.sync();
    assert.equal(viewport.querySelectorAll('[role="menuitem"]').length, 1);
    /* A closed menu is no menu: the row goes with the list that held it. */
    wanted = true;
    mounted.sync();
    assert.equal(viewport.querySelectorAll('[role="menuitem"]').length, 2);
    mounted.sync();
    assert.equal(viewport.querySelectorAll('[role="menuitem"]').length, 2, 'one list, one row');
  } finally {
    mounted.dispose();
  }
});

test('the copy is never disabled by the state of the row it was taken from', () => {
  const { header, viewport } = sessionMenu();
  /* The data row is the log export, which is disabled while one runs. */
  viewport.querySelectorAll('[role="menuitem"]')[0]?.setAttribute('disabled', '');
  const mounted = mount(fakeDocument(header), { label: '打开侧边栏', wanted: () => true, act: () => {} });
  try {
    const added = viewport.querySelectorAll('[role="menuitem"]')[0];
    assert.equal(added?.getAttribute(MENU_ROW_ATTRIBUTE), '');
    assert.equal(added?.getAttribute('disabled'), null);
    assert.equal(added?.disabled, false);
  } finally {
    mounted.dispose();
  }
});

test('a row whose state changed under the open menu acts on nothing', () => {
  const { header, trigger, viewport } = sessionMenu();
  const actions: string[] = [];
  let wanted = true;
  const mounted = mount(fakeDocument(header), {
    label: '打开侧边栏',
    wanted: () => wanted,
    act: () => { actions.push('expand'); },
  });
  try {
    wanted = false;
    viewport.querySelectorAll('[role="menuitem"]')[0]?.click();
    assert.deepEqual(actions, []);
    /* The menu still closes: the reader chose the row they were shown. */
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  } finally {
    mounted.dispose();
  }
});

test('a menu with nothing to copy leaves the plugin out of it', () => {
  const { header, viewport } = sessionMenu();
  viewport.children = [];
  const mounted = mount(fakeDocument(header), { label: '打开侧边栏', wanted: () => true, act: () => {} });
  try {
    assert.deepEqual(viewport.children, []);
  } finally {
    mounted.dispose();
  }
});

test('a failing action is reported and still dismisses the menu', () => {
  const { header, trigger, viewport } = sessionMenu();
  const errors: unknown[] = [];
  const mounted = mount(
    fakeDocument(header),
    { label: '打开侧边栏', wanted: () => true, act: () => { throw new Error('no on-screen session'); } },
    error => { errors.push(error); },
  );
  try {
    viewport.querySelectorAll('[role="menuitem"]')[0]?.click();
    assert.equal(errors.length, 1);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  } finally {
    mounted.dispose();
  }
});

test('the observer and the row are released together', () => {
  const { header, viewport } = sessionMenu();
  const mounted = mount(fakeDocument(header), { label: '打开侧边栏', wanted: () => true, act: () => {} });
  mounted.dispose();
  assert.equal(FakeObserver.instances.at(-1)?.disconnected, true);
  assert.equal(viewport.querySelectorAll('[role="menuitem"]').length, 1);
});
