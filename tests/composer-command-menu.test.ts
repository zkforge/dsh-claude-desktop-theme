import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountComposerCommandMenu } from '../src/client/compat/composer-command-menu.ts';
import { commandMenuDescription, mountCommandMenuDetails } from '../src/client/compat/command-menu-details.ts';

test('skill hints preserve catalog descriptions in either language and fall back only when absent', () => {
  assert.equal(commandMenuDescription('review', 'skill', '  Review code for bugs.  '), 'Review code for bugs.');
  assert.equal(commandMenuDescription('review', 'skill', '检查代码中的问题'), '检查代码中的问题');
  assert.equal(commandMenuDescription('review', 'skill', '  '), '运行「review」技能');
  assert.equal(commandMenuDescription('model', 'command', 'Select a model'), '选择当前会话使用的模型');
});

// Narrow DOM double: exercise mixed native candidates and cleanup, not layout.
test('typed slash preserves command and skill candidates, groups skill-only results and restores decorations', () => {
  const original = globalThis.MutationObserver;
  const callbacks: (() => void)[] = [];
  globalThis.MutationObserver = class {
    constructor(callback: () => void) { callbacks.push(callback); }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  class Node {
    id = ''; textContent = ''; isConnected = true;
    attrs = new Map<string, string>();
    children: Node[] = [];
    parent: Node | null = null;
    alias: Node | null = null;
    name: Node | null = null;
    setAttribute(key: string, value: string) { this.attrs.set(key, value); }
    getAttribute(key: string) { return this.attrs.get(key) ?? null; }
    hasAttribute(key: string) { return this.attrs.has(key); }
    removeAttribute(key: string) { this.attrs.delete(key); }
    append(node: Node) { this.children.push(node); node.parent = this; }
    contains(node: Node): boolean { return node === this || this.children.some(child => child.contains(node)); }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
      this.parent = null; this.isConnected = false;
    }
    before(node: Node) {
      node.remove(); node.isConnected = true; node.parent = this.parent;
      this.parent?.children.splice(this.parent.children.indexOf(this), 0, node);
    }
    get previousElementSibling(): Node | null { return this.parent?.children[(this.parent?.children.indexOf(this) ?? 0) - 1] ?? null; }
    querySelector(selector: string) { return selector.includes('_itemAlias') ? this.alias : this.name; }
    querySelectorAll(selector: string) {
      return this.children.filter(child => child.id.startsWith(selector.includes('command-') ? 'dsh-slash-option-command-' : 'dsh-slash-option-'));
    }
  }
  const menu = new Node(), command = new Node(), skill = new Node();
  command.id = 'dsh-slash-option-command-0'; skill.id = 'dsh-slash-option-skill-0';
  command.alias = new Node(); command.alias.textContent = 'plan';
  command.name = new Node(); command.name.textContent = '计划';
  skill.name = new Node(); skill.name.textContent = 'review';
  menu.append(command); menu.append(skill);
  const addTip = new Node(), otherTip = new Node();
  addTip.textContent = '添加文件或调用指令';
  otherTip.textContent = '其他提示';
  const events = new Map<string, unknown>();
  const doc = {
    body: {}, defaultView: { addEventListener() {}, removeEventListener() {} },
    querySelectorAll: (selector: string) => selector === '[role="tooltip"]' ? [addTip, otherTip] : [menu],
    createElement: () => new Node(),
    addEventListener: (type: string, listener: unknown) => events.set(type, listener),
    removeEventListener: (type: string) => events.delete(type),
  } as unknown as Document;
  const disposers: (() => void)[] = [];
  const sync = () => callbacks.forEach(callback => callback());
  try {
    disposers.push(mountComposerCommandMenu(doc, error => { throw error; }));
    disposers.push(mountCommandMenuDetails(doc, error => { throw error; }));
    assert.equal(addTip.hasAttribute('data-ccd-add-tooltip'), true, 'add tooltip is suppressed without data-portal');
    assert.equal(otherTip.hasAttribute('data-ccd-add-tooltip'), false);
    addTip.textContent = 'Add files or run commands'; sync();
    assert.equal(addTip.hasAttribute('data-ccd-add-tooltip'), true);
    assert.deepEqual(menu.children.map(node => node.id || node.textContent), ['命令', command.id, '技能', skill.id]);
    assert.equal(command.children[0]?.textContent, 'plan');
    assert.equal(command.name.textContent, '计划', 'native labels stay intact');
    assert.equal(skill.children.length, 0, 'native skill contents and handlers stay intact');
    command.alias.textContent = 'compact'; sync();
    assert.equal(command.children[0]?.textContent, 'compact');
    command.remove(); sync();
    assert.deepEqual(menu.children.map(node => node.id || node.textContent), ['技能', skill.id]);
    assert.equal(menu.hasAttribute('data-ccd-command-menu'), true, 'skill-only results keep slash styling');
  } finally {
    disposers.reverse().forEach(dispose => dispose());
    globalThis.MutationObserver = original;
  }
  assert.deepEqual(menu.children, [skill]);
  assert.equal(menu.hasAttribute('data-ccd-command-menu'), false);
  assert.equal(events.size, 0);
  assert.equal(addTip.hasAttribute('data-ccd-add-tooltip'), false);
});
