import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedFilesTitle, mountChangedFiles } from '../src/client/compat/changed-files.ts';

class NodeFixture {
  readonly nodeType = 1;
  readonly attrs = new Map<string, string>();
  readonly children: NodeFixture[] = [];
  parentElement: NodeFixture | null = null;
  connected = false;
  disabled = false;
  type = '';
  lang = 'zh-CN';
  private text = '';
  onClick: (() => void) | undefined;
  readonly tagName: string;
  constructor(tagName = 'div', className = '') { this.tagName = tagName; if (className) this.attrs.set('class', className); }
  get isConnected(): boolean { return this.connected || this.parentElement?.isConnected === true; }
  get firstChild() { return this.children[0] ?? null; }
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.text = value; }
  get outerHTML(): string { return `<${this.tagName} ${JSON.stringify([...this.attrs])}>${this.text}${this.children.map(child => child.outerHTML).join('')}</${this.tagName}>`; }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  removeAttribute(name: string) { this.attrs.delete(name); }
  hasAttribute(name: string) { return this.attrs.has(name); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  matches(selector: string): boolean {
    if (selector === '[data-turn-tail] [data-changed-files]') return this.attrs.has('data-changed-files') && !!this.parentElement?.closest('[data-turn-tail]');
    const cls = selector.match(/^(\w+)?\[class\*="([^"]+)"\]$/u);
    if (cls) return (!cls[1] || cls[1] === this.tagName) && (this.getAttribute('class') ?? '').includes(cls[2]!);
    const attr = selector.match(/^\[([^\]]+)\]$/u);
    return attr ? this.attrs.has(attr[1]!) : selector === this.tagName;
  }
  closest(selector: string): NodeFixture | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
  querySelectorAll(selector: string): NodeFixture[] {
    return this.children.flatMap(child => [...child.matches(selector) ? [child] : [], ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  append(...nodes: NodeFixture[]) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node: NodeFixture, before: NodeFixture | null) {
    node.remove(); node.parentElement = this;
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node);
  }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceChildren(...nodes: NodeFixture[]) { for (const child of [...this.children]) child.remove(); this.text = ''; this.append(...nodes); }
  cloneNode(deep: boolean): NodeFixture {
    const clone = new NodeFixture(this.tagName);
    for (const [name, value] of this.attrs) clone.attrs.set(name, value);
    clone.text = this.text;
    if (deep) clone.append(...this.children.map(child => child.cloneNode(true)));
    return clone;
  }
  addEventListener(_name: string, callback: () => void) { this.onClick = callback; }
  click() { if (!this.disabled) this.onClick?.(); }
}

test('summary retains native actions, copies host icons/counts, follows updates and fully cleans up', async () => {
  const previousObserver = globalThis.MutationObserver;
  let notify: (records: unknown[]) => void = () => {};
  globalThis.MutationObserver = class {
    constructor(callback: typeof notify) { notify = callback; }
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;
  const root = new NodeFixture(), tail = new NodeFixture(), card = new NodeFixture();
  root.connected = true; root.append(tail); tail.append(card);
  tail.setAttribute('data-turn-tail', ''); card.setAttribute('data-changed-files', '');
  const header = new NodeFixture('button', 'host_header'), tile = new NodeFixture('span', 'host_tile');
  const icon = new NodeFixture('svg'), counts = new NodeFixture('span', 'host_statCounts');
  const nativeTitle = new NodeFixture('span', 'host_title'); nativeTitle.textContent = '已编辑 3 个文件';
  tile.append(icon); counts.textContent = '+4−4'; header.append(tile, nativeTitle, counts);
  const list = new NodeFixture('ul'), row = new NodeFixture('button', 'host_row'), path = new NodeFixture('span', 'host_path');
  path.textContent = 'README.md'; row.append(path); list.append(row); card.append(header, list);
  let reviews = 0, fileClicks = 0;
  header.onClick = () => reviews++; row.onClick = () => fileClicks++;
  header.setAttribute('aria-describedby', 'file-path');
  const description = new NodeFixture('span'); description.textContent = '/workspace/hello-20261021.txt';
  const document = { getElementById: () => description, body: root, documentElement: root, createElement: (tag: string) => new NodeFixture(tag) } as unknown as Document;
  const errors: unknown[] = [];
  const dispose = mountChangedFiles(document, error => errors.push(error));
  const deliver = async (target: NodeFixture = card) => {
    notify([{ target, addedNodes: [], type: 'childList' }]);
    await Promise.resolve();
  };
  try {
    const footer = card.querySelector('[data-ccd-changes-review]')!;
    assert.equal(card.querySelector('[data-ccd-changes-title]')?.textContent, '已编辑 3 个文件');
    assert.equal(nativeTitle.textContent, '已编辑 3 个文件');
    assert.equal(footer.textContent, '查看全部+4−4');
    assert.equal(footer.getAttribute('data-ccd-changes-tooltip'), '查看本轮更改');
    assert.equal(footer.getAttribute('aria-description'), '查看本轮更改');
    footer.click(); row.click();
    assert.equal(reviews, 1); assert.equal(fileClicks, 1);
    assert.equal(path.parentElement, row); assert.equal(header.parentElement, card);
    const copy = row.querySelector('[data-ccd-changes-icon]')!;
    assert.equal(copy.children[0]?.tagName, 'svg');
    assert.notEqual(copy.children[0], icon);
    assert.equal(copy.getAttribute('aria-hidden'), 'true');
    await deliver();
    assert.equal(row.querySelector('[data-ccd-changes-icon]'), copy);
    assert.equal(card.querySelector('[data-ccd-changes-review]'), footer);
    counts.textContent = '+8−2'; await deliver(counts);
    assert.equal(footer.textContent, '查看全部+8−2');
    header.disabled = true; await deliver(header);
    assert.equal(footer.disabled, true); footer.click(); assert.equal(reviews, 1);
    header.disabled = false; root.lang = 'en'; await deliver(root);
    assert.equal(footer.textContent, '查看全部+8−2');
    assert.equal(footer.getAttribute('data-ccd-changes-tooltip'), '查看本轮更改');
    row.remove(); await deliver(list);
    assert.equal(copy.parentElement, null);
    const hoverWrapper = new NodeFixture('span');
    list.remove(); hoverWrapper.append(header); card.insertBefore(hoverWrapper, card.firstChild);
    card.setAttribute('data-single', 'true'); await deliver();
    assert.equal(footer.parentElement, card);
    assert.equal(header.parentElement, hoverWrapper, 'native single-file hover wrapper is preserved');
    assert.equal(card.querySelector('[data-ccd-changes-heading]')?.textContent, '已编辑 1 个文件');
    assert.equal(header.querySelector('[data-ccd-changes-single-name]')?.textContent, 'hello-20261021.txt');
    assert.equal(header.querySelector('[data-ccd-changes-total]')?.textContent, '+8−2');
    assert.equal(card.querySelector('[data-ccd-changes-review]'), footer);
    footer.click(); assert.equal(reviews, 2);
    description.textContent = 'C:\\workspace\\renamed.txt'; counts.textContent = '+3−0';
    root.lang = 'zh-CN'; await deliver();
    assert.equal(card.querySelector('[data-ccd-changes-heading]')?.textContent, '已编辑 1 个文件');
    assert.equal(header.querySelector('[data-ccd-changes-single-name]')?.textContent, 'renamed.txt');
    assert.equal(header.querySelector('[data-ccd-changes-total]')?.textContent, '+3−0');
    assert.equal(footer.textContent, '查看全部+3−0');
    hoverWrapper.remove(); card.insertBefore(header, card.firstChild); card.append(list);
    card.setAttribute('data-single', 'false'); list.append(row); await deliver();
    assert.ok(card.querySelector('[data-ccd-changes-review]'));
    assert.equal(card.querySelector('[data-ccd-changes-heading]'), null);
    assert.equal(header.querySelector('[data-ccd-changes-single-name]'), null);
    dispose(); await deliver();
    assert.equal(card.querySelector('[data-ccd-changes-review]'), null);
    assert.equal(row.querySelector('[data-ccd-changes-icon]'), null);
    assert.equal(path.parentElement, row);
    assert.equal(nativeTitle.getAttribute('data-ccd-changes-title-source'), null);
    assert.equal(card.querySelector('[data-ccd-changes-title]'), null);
    assert.deepEqual(errors, []);
  } finally { dispose(); globalThis.MutationObserver = previousObserver; }
});


test('changed-file title normalization accepts only native count labels', () => {
  assert.equal(changedFilesTitle('已编辑 1 个文件'), '已编辑 1 个文件');
  assert.equal(changedFilesTitle('已编辑 12 个文件'), '已编辑 12 个文件');
  assert.equal(changedFilesTitle('Edited 3 files'), '已编辑 3 个文件');
  assert.equal(changedFilesTitle('已编辑 a.ts'), undefined);
});
