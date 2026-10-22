import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountComposerCommandMenu } from '../src/client/compat/composer-command-menu.ts';
import { HOST } from '../src/client/compat/host-dom.ts';

// Narrow event/DOM double: validates action routing and lifecycle, not layout.
function fixture() {
  const oldObserver = globalThis.MutationObserver;
  const callbacks: (() => void)[] = [];
  globalThis.MutationObserver = class {
    constructor(callback: () => void) { callbacks.push(callback); }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  const events = new Map<string, (event: any) => void>();
  const windowEvents = new Map<string, () => void>();
  let active: FakeNode | null = null;
  let popup: FakeNode | null = null;
  let fileClicks = 0, pluginClicks = 0, nativeClicks = 0;
  class FakeNode {
    attributes = new Map<string, string>();
    children: FakeNode[] = [];
    style: Record<string, string> = {};
    textContent = '';
    disabled = false;
    isConnected = true;
    parent: FakeNode | null = null;
    handlers = new Map<string, () => void>();
    type = ''; id = ''; innerHTML = '';
    getAttribute(name: string) { return this.attributes.get(name) ?? null; }
    hasAttribute(name: string) { return this.attributes.has(name); }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    append(...nodes: FakeNode[]) { for (const node of nodes) { this.children.push(node); node.parent = this; } }
    remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
    contains(node: FakeNode): boolean { return node === this || this.children.some(child => child.contains(node)); }
    querySelector(selector: string): FakeNode | null {
      if (this === card) return selector === 'input[type="file"]' ? file : null;
      if (this === commandRow) return selector.includes('_itemAlias') ? alias : name;
      if (this === menu) return commandRow;
      return this.children.find(node => selector === 'button' && node.type === 'button') ?? null;
    }
    querySelectorAll(): FakeNode[] { return this === menu ? [commandRow] : this.children.filter(node => node.type === 'button'); }
    closest(selector: string): FakeNode | null { return this === plus ? selector === HOST.composerAdd ? plus : selector === HOST.composerCard ? card : session : null; }
    getBoundingClientRect() { return { left: 40, top: 400, bottom: 424, width: 180, height: 80 }; }
    showPopover() {}
    focus() { active = this; }
    addEventListener(name: string, callback: () => void) { this.handlers.set(name, callback); }
    click() {
      if (this === plus) { clickPlus(); return; }
      this.handlers.get('click')?.();
    }
  }
  const plus = new FakeNode(), card = new FakeNode(), session = new FakeNode();
  plus.setAttribute('aria-expanded', 'false'); plus.setAttribute('aria-haspopup', 'listbox');
  session.setAttribute('data-conversation-session', 'a');
  const file = new FakeNode(), plugin = new FakeNode();
  file.click = () => { fileClicks++; }; plugin.click = () => { pluginClicks++; };
  const commandRow = new FakeNode(), menu = new FakeNode(), alias = new FakeNode(), name = new FakeNode();
  alias.textContent = 'plan'; name.textContent = '计划';
  const body = new FakeNode();
  body.append = (node: FakeNode) => { popup = node; };
  const doc = {
    body, documentElement: { lang: 'zh-CN' },
    get activeElement() { return active; },
    defaultView: { innerWidth: 800, innerHeight: 600,
      addEventListener: (name: string, callback: () => void) => windowEvents.set(name, callback),
      removeEventListener: (name: string) => windowEvents.delete(name),
    },
    createElement: () => new FakeNode(), createElementNS: () => new FakeNode(),
    querySelector: (selector: string) => selector === '[data-ccd-nav="plugins"]' ? plugin : null,
    querySelectorAll: () => [menu],
    addEventListener: (name: string, callback: (event: any) => void) => events.set(name, callback),
    removeEventListener: (name: string) => events.delete(name),
  } as unknown as Document;
  function clickPlus() {
    let stopped = false;
    events.get('click')?.({ target: plus, preventDefault() {}, stopImmediatePropagation() { stopped = true; } });
    if (!stopped) nativeClicks++;
  }
  const press = (key: string) => events.get('keydown')?.({ key, preventDefault() {}, stopImmediatePropagation() {} });
  const dispose = mountComposerCommandMenu(doc, error => { throw error; });
  return {
    plus, alias, commandRow, menu, name, session, events, windowEvents, clickPlus, press,
    get popup() { return popup; }, get active() { return active; },
    counts: () => [fileClicks, nativeClicks, pluginClicks],
    sync: () => callbacks[0]?.(),
    dispose: () => { dispose(); globalThis.MutationObserver = oldObserver; },
  };
}

test('add choices route to native file, command and plugin actions; keyboard and close restore the trigger', () => {
  const f = fixture();
  try {
    f.clickPlus();
    assert.deepEqual(f.popup?.children.map(row => row.children[1]?.textContent), ['添加文件或照片', '斜杠命令', '添加插件']);
    assert.deepEqual(f.counts(), [0, 0, 0], 'opening add does not launch a native command');
    assert.equal(f.plus.getAttribute('aria-haspopup'), 'menu');
    f.press('End'); assert.equal(f.active, f.popup?.children[2]);
    f.press('ArrowDown'); assert.equal(f.active, f.popup?.children[0]);
    f.press('Escape'); assert.equal(f.popup?.isConnected, false);
    assert.equal(f.plus.getAttribute('aria-expanded'), 'false');
    assert.equal(f.plus.getAttribute('aria-haspopup'), 'listbox');
    for (const index of [0, 1, 2]) { f.clickPlus(); f.popup?.children[index]?.click(); }
    assert.deepEqual(f.counts(), [1, 1, 1]);
    f.clickPlus(); f.session.setAttribute('data-conversation-session', 'b'); f.sync();
    assert.equal(f.popup?.isConnected, false, 'session replacement closes add');
  } finally { f.dispose(); }
  assert.equal(f.events.size, 0); assert.equal(f.windowEvents.size, 0);
});

test('slash tokens follow native candidate updates without rewriting labels and are removed on disposal', () => {
  const f = fixture();
  try {
    assert.equal(f.commandRow.children[0]?.textContent, 'plan');
    assert.equal(f.name.textContent, '计划');
    f.alias.textContent = 'compact'; f.sync();
    assert.equal(f.commandRow.children[0]?.textContent, 'compact');
    f.clickPlus();
  } finally { f.dispose(); }
  assert.equal(f.commandRow.children.length, 0);
  assert.equal(f.menu.hasAttribute('data-ccd-command-menu'), false);
  assert.equal(f.popup?.isConnected, false);
});
