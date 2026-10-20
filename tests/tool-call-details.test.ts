import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandSegments, mountToolCallDetails, writeCommandClipboard } from '../src/client/compat/tool-call-details.ts';

test('command highlighting preserves quoted arguments, redirects, newlines and incomplete input', () => {
  for (const command of [
    'git status --short', 'cat "a b.txt" > out.txt && pwd\nprintf \'中文\\n\'',
    'echo "unterminated', 'printf a\\ b', '',
  ]) assert.equal(commandSegments(command).map(segment => segment.text).join(''), command);
  assert.deepEqual(commandSegments('git status --short').map(segment => [segment.text, segment.tone]), [
    ['git', 'command'], [' ', 'plain'], ['status', 'argument'], [' ', 'plain'], ['--short', 'argument'],
  ]);
  assert.equal(commandSegments('cat a > b').at(-1)?.tone, 'argument');
  assert.equal(commandSegments('pwd && git status').find(segment => segment.text === 'git')?.tone, 'command');
});

/** A small DOM fixture exercises ownership and observer updates without a browser. */
class ElementFixture {
  readonly nodeType = 1;
  tagName = 'DIV';
  onClick: (() => void) | null = null;
  listener: (() => void | Promise<void>) | null = null;
  readonly attrs = new Map<string, string>();
  readonly children: ElementFixture[] = [];
  parentElement: ElementFixture | null = null;
  connectedRoot = false;
  private text = '';
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.text = value; }
  get isConnected(): boolean { return this.connectedRoot || this.parentElement?.isConnected === true; }
  get nextElementSibling(): ElementFixture | null {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  setAttribute(name: string, value: string) { this.attrs.set(name, value); }
  getAttribute(name: string) { return this.attrs.get(name) ?? null; }
  hasAttribute(name: string) { return this.attrs.has(name); }
  removeAttribute(name: string) { this.attrs.delete(name); }
  addEventListener(_name: string, callback: (event: { stopPropagation(): void }) => void | Promise<void>) {
    this.listener = () => callback({ stopPropagation() {} });
  }
  click() { this.onClick?.(); return this.listener?.(); }
  matches(selector: string): boolean {
    const attr = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/u);
    return attr ? attr[2] === undefined ? this.hasAttribute(attr[1]!) : this.getAttribute(attr[1]!) === attr[2]
      : this.tagName.toLowerCase() === selector;
  }
  closest(selector: string): ElementFixture | null {
    return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string): ElementFixture[] {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  append(...children: ElementFixture[]) {
    for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); }
  }
  after(child: ElementFixture) {
    const parent = this.parentElement!;
    child.remove();
    parent.children.splice(parent.children.indexOf(this) + 1, 0, child);
    child.parentElement = parent;
  }
  replaceChildren(...children: ElementFixture[]) {
    for (const child of [...this.children]) child.remove();
    this.text = '';
    this.append(...children);
  }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
}

test('detail enhancement keeps native command nodes, follows updates and restores them on disposal', async () => {
  const nativeObserver = globalThis.MutationObserver;
  let notify: (records: MutationRecord[]) => void = () => {};
  let disconnected = false;
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  } as unknown as typeof MutationObserver;
  const body = new ElementFixture();
  body.connectedRoot = true;
  const group = new ElementFixture(), terminal = new ElementFixture(), source = new ElementFixture();
  group.setAttribute('data-ccd-tool-group-member', 'open');
  terminal.setAttribute('data-terminal', '');
  source.setAttribute('data-command-text', 'true');
  source.textContent = 'git status --short';
  body.append(group); group.append(terminal); terminal.append(source);
  const errors: unknown[] = [];
  const notifyChange = async (target: ElementFixture) => {
    notify([{ target, addedNodes: [] }] as unknown as MutationRecord[]);
    await new Promise<void>(resolve => queueMicrotask(resolve));
  };
  const dispose = mountToolCallDetails({ body, createElement: () => new ElementFixture() } as unknown as Document,
    error => errors.push(error));
  try {
    const view = source.nextElementSibling!;
    assert.equal(source.parentElement, terminal);
    assert.equal(source.textContent, 'git status --short');
    assert.equal(view.textContent, source.textContent);
    source.textContent = 'pwd';
    await notifyChange(source);
    assert.equal(source.nextElementSibling, view);
    assert.equal(view.textContent, 'pwd');
    // An unchanged observer delivery must not replace the highlighted nodes.
    const token = view.children[0];
    await notifyChange(terminal);
    assert.equal(view.children[0], token);
    group.removeAttribute('data-ccd-tool-group-member');
    await notifyChange(group);
    assert.equal(source.nextElementSibling, null);
    assert.equal(source.attrs.has('data-ccd-command-source'), false);
    group.setAttribute('data-ccd-tool-group-member', 'open');
    await notifyChange(group);
    assert.equal(terminal.children[1]?.textContent, 'pwd');
    assert.deepEqual(errors, []);
  } finally {
    dispose();
    globalThis.MutationObserver = nativeObserver;
  }
  assert.equal(disconnected, true);
  assert.equal(source.nextElementSibling, null);
  assert.equal(source.attrs.has('data-ccd-command-source'), false);
  assert.equal(source.textContent, 'pwd');
});

test('file previews reveal every returned line once, become keyboard scrollable and restore native state', async () => {
  const nativeObserver = globalThis.MutationObserver;
  let notify: (records: MutationRecord[]) => void = () => {};
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;
  const body = new ElementFixture();
  body.connectedRoot = true;
  const group = new ElementFixture(), read = new ElementFixture(), banner = new ElementFixture();
  const content = new ElementFixture(), expand = new ElementFixture();
  group.setAttribute('data-ccd-tool-group-member', 'open');
  read.setAttribute('data-read', '');
  content.setAttribute('tabindex', '-1');
  expand.tagName = 'BUTTON';
  expand.setAttribute('aria-expanded', 'false');
  let clicks = 0;
  let renderedLines = 8;
  expand.onClick = () => {
    clicks++;
    const open = expand.getAttribute('aria-expanded') !== 'true';
    expand.setAttribute('aria-expanded', String(open));
    renderedLines = open ? 80 : 8;
  };
  body.append(group); group.append(read); read.append(banner, content); content.append(expand);
  const errors: unknown[] = [];
  const dispose = mountToolCallDetails({ body, createElement: () => new ElementFixture() } as unknown as Document,
    error => errors.push(error));
  try {
    assert.equal(renderedLines, 80);
    assert.equal(clicks, 1);
    assert.equal(read.hasAttribute('data-ccd-read-scroll'), true);
    assert.equal(content.getAttribute('tabindex'), '0');
    assert.equal(content.getAttribute('role'), 'region');
    assert.equal(content.getAttribute('aria-label'), 'File contents');
    notify([{ target: expand, addedNodes: [] }] as unknown as MutationRecord[]);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    assert.equal(clicks, 1);
    assert.equal(content.parentElement, read);
    assert.equal(expand.parentElement, content);
    assert.deepEqual(errors, []);
  } finally {
    dispose();
    globalThis.MutationObserver = nativeObserver;
  }
  assert.equal(clicks, 2);
  assert.equal(renderedLines, 8);
  assert.equal(read.hasAttribute('data-ccd-read-scroll'), false);
  assert.equal(content.getAttribute('tabindex'), '-1');
  assert.equal(content.getAttribute('role'), null);
  assert.equal(content.getAttribute('aria-label'), null);
});

test('skill previews number the unchanged source, retain blank lines, follow updates and clean up', async () => {
  const nativeObserver = globalThis.MutationObserver;
  let notify: (records: MutationRecord[]) => void = () => {};
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;
  const body = new ElementFixture(), group = new ElementFixture(), skill = new ElementFixture();
  const section = new ElementFixture(), source = new ElementFixture();
  body.connectedRoot = true;
  group.setAttribute('data-ccd-tool-group-member', 'open');
  skill.setAttribute('data-tool', 'skill');
  source.tagName = 'PRE';
  const text = '<skill_content>\n\n# 中文技能\n</skill_content>\n';
  source.textContent = text;
  body.append(group); group.append(skill); skill.append(section); section.append(source);
  const errors: unknown[] = [];
  const dispose = mountToolCallDetails({ body, createElement: () => new ElementFixture() } as unknown as Document,
    error => errors.push(error));
  try {
    const view = source.nextElementSibling!;
    assert.equal(view.getAttribute('tabindex'), '0');
    assert.equal(view.getAttribute('role'), 'region');
    assert.equal(source.textContent, text);
    assert.equal(source.parentElement, section);
    assert.equal(view.children.map(row => row.children[1]?.textContent).join('\n'), text);
    assert.deepEqual(view.children.map(row => row.children[0]?.textContent), ['1', '2', '3', '4', '5']);
    assert.ok(view.children.every(row => row.children[0]?.getAttribute('aria-hidden') === 'true'));
    source.textContent = 'updated';
    notify([{ target: source, addedNodes: [] }] as unknown as MutationRecord[]);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    assert.equal(source.nextElementSibling, view);
    assert.equal(view.children.length, 1);
    assert.equal(view.children[0]?.children[1]?.textContent, 'updated');
    assert.deepEqual(errors, []);
  } finally {
    dispose();
    globalThis.MutationObserver = nativeObserver;
  }
  assert.equal(source.hasAttribute('data-ccd-skill-source'), false);
  assert.equal(source.nextElementSibling, null);
  assert.equal(source.textContent, 'updated');
});

test('command copy writes the actual command, confirms only success and restores native controls', async () => {
  const nativeObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor() {}
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;
  const body = new ElementFixture(), group = new ElementFixture(), terminal = new ElementFixture();
  const header = new ElementFixture(), nativeCopy = new ElementFixture(), source = new ElementFixture();
  body.connectedRoot = true;
  group.setAttribute('data-ccd-tool-group-member', 'open');
  terminal.setAttribute('data-terminal', '');
  source.setAttribute('data-command-text', '');
  source.textContent = 'git status --short';
  nativeCopy.tagName = 'BUTTON';
  body.append(group); group.append(terminal); terminal.append(header); header.append(source, nativeCopy);
  const errors: unknown[] = [];
  let copied = '';
  let resolveWrite: (() => void) | undefined;
  let rejectWrite: ((error: Error) => void) | undefined;
  const dispose = mountToolCallDetails({ body, createElement: () => new ElementFixture() } as unknown as Document,
    error => errors.push(error), text => {
      copied = text;
      return new Promise<void>((resolve, reject) => { resolveWrite = resolve; rejectWrite = reject; });
    });
  try {
    const copy = header.querySelectorAll('[data-ccd-command-copy]')[0]!;
    assert.equal(nativeCopy.hasAttribute('data-ccd-native-copy'), true);
    const pending = copy.click();
    assert.equal(copied, 'git status --short');
    assert.equal(copy.getAttribute('data-ccd-copy-state'), 'idle');
    resolveWrite!();
    await pending;
    assert.equal(copy.getAttribute('data-ccd-copy-state'), 'copied');
    assert.equal(copy.getAttribute('aria-label'), 'Copied');
    source.textContent = 'pwd';
    const failing = copy.click();
    assert.equal(copied, 'pwd');
    rejectWrite!(new Error('clipboard denied'));
    await failing;
    assert.equal(copy.getAttribute('data-ccd-copy-state'), 'idle');
    assert.equal(copy.getAttribute('aria-label'), 'Copy failed');
    assert.equal(errors.length, 1);
  } finally {
    dispose();
    globalThis.MutationObserver = nativeObserver;
  }
  assert.equal(nativeCopy.hasAttribute('data-ccd-native-copy'), false);
  assert.equal(header.querySelectorAll('[data-ccd-command-copy]').length, 0);
});

test('clipboard fallback copies after async API rejection and cleans up on failure', async () => {
  let selected = false, removed = false, focused = false;
  const field = {
    value: '', style: { cssText: '' }, setAttribute() {},
    select() { selected = true; }, remove() { removed = true; },
  };
  let successful = true;
  const document = {
    defaultView: { navigator: { clipboard: { async writeText() { throw new Error('denied'); } } } },
    activeElement: { focus() { focused = true; } },
    createElement: () => field,
    body: { append() {} },
    execCommand(command: string) { assert.equal(command, 'copy'); return successful; },
  } as unknown as Document;
  await writeCommandClipboard(document, 'git status --short');
  assert.equal(field.value, 'git status --short');
  assert.ok(selected && removed && focused);
  successful = false;
  removed = false;
  await assert.rejects(writeCommandClipboard(document, 'pwd'), /Clipboard copy failed/u);
  assert.equal(removed, true);
});

test('glob expands all returned paths into a scroll region and copies paths without line numbers', async () => {
  const nativeObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor() {}
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;
  const body = new ElementFixture(), group = new ElementFixture(), search = new ElementFixture();
  const header = new ElementFixture(), summary = new ElementFixture(), nativeCopy = new ElementFixture();
  const content = new ElementFixture(), expand = new ElementFixture();
  body.connectedRoot = true;
  group.setAttribute('data-ccd-tool-group-member', 'open');
  search.setAttribute('data-search', 'paths');
  summary.textContent = 'Showing 100 of 285 paths';
  nativeCopy.tagName = 'BUTTON';
  expand.tagName = 'BUTTON';
  expand.setAttribute('aria-expanded', 'false');
  const paths = Array.from({ length: 100 }, (_, index) => `docs/file-${index + 1}.md`);
  const render = (values: string[]) => {
    content.replaceChildren(...values.map(path => {
      const row = new ElementFixture(); row.textContent = path; return row;
    }), expand);
  };
  render([...paths.slice(0, 4), ...paths.slice(-4)]);
  expand.onClick = () => {
    const open = expand.getAttribute('aria-expanded') !== 'true';
    expand.setAttribute('aria-expanded', String(open));
    render(open ? paths : [...paths.slice(0, 4), ...paths.slice(-4)]);
  };
  body.append(group); group.append(search); search.append(header, content); header.append(summary, nativeCopy);
  let copied = '';
  const errors: unknown[] = [];
  const dispose = mountToolCallDetails({ body, createElement: () => new ElementFixture() } as unknown as Document,
    error => errors.push(error), async text => { copied = text; });
  try {
    assert.equal(content.children.length, 101);
    assert.equal(search.hasAttribute('data-ccd-read-scroll'), true);
    assert.equal(content.getAttribute('tabindex'), '0');
    assert.equal(content.getAttribute('aria-label'), 'File paths');
    assert.equal(summary.textContent, 'Showing 100 of 285 paths');
    const copy = header.querySelectorAll('[data-ccd-paths-copy]')[0]!;
    assert.equal(nativeCopy.hasAttribute('data-ccd-native-copy'), true);
    await copy.click();
    assert.equal(copied, paths.join('\n'));
    assert.equal(copy.getAttribute('data-ccd-copy-state'), 'copied');
    assert.deepEqual(errors, []);
  } finally {
    dispose();
    globalThis.MutationObserver = nativeObserver;
  }
  assert.equal(content.children.length, 9);
  assert.equal(content.hasAttribute('tabindex'), false);
  assert.equal(nativeCopy.hasAttribute('data-ccd-native-copy'), false);
  assert.equal(header.querySelectorAll('[data-ccd-paths-copy]').length, 0);
});
