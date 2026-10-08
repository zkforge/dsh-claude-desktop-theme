import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountEmptyGroups } from '../src/client/compat/empty-groups.ts';

/*
 * The empty-group rule's contract.
 *
 * `显示空分组` is off by default, so a Workspace whose rows are all filtered away
 * is kept out of the sidebar. DSH has no such setting and draws no per-group
 * empty state, so the answer is read from the rows themselves: a Session row
 * keeps its group (unless the plugin already hides that row as a provisional New
 * Session), the `overflow:` row keeps it because it says there are more, a
 * nested group's Sessions count because the test walks the subtree, and the
 * current Session keeps its group unconditionally.
 */

/** One element of the fake tree, with the selector support the module needs. */
class FakeElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;

  constructor(tagName: string, attributes: Record<string, string> = {}) {
    this.tagName = tagName;
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }

  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }

  removeAttribute(name: string): void { this.attributes.delete(name); }

  hasAttribute(name: string): boolean { return this.attributes.has(name); }

  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parent = this;
      this.children.push(child);
    }
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

  querySelectorAll(selector: string): FakeElement[] {
    const found: FakeElement[] = [];
    const visit = (element: FakeElement) => {
      for (const child of element.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
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

/** One group container: its Workspace row, then whatever the test adds. */
function group(key: string, ...rows: FakeElement[]): FakeElement {
  const container = new FakeElement('div', { class: '_7514NG_groupSection' });
  container.append(new FakeElement('div', { 'data-row-key': `workspace:${key}` }), ...rows);
  return container;
}

/** One Session row, keyed the way `ui-workspace` keys its rows. */
function session(id: string, attributes: Record<string, string> = {}): FakeElement {
  return new FakeElement('div', { 'data-row-key': `session:${id}`, ...attributes });
}

/** A document double over one fake tree. */
function fakeDocument(...groups: FakeElement[]): { document: Document; body: FakeElement } {
  const documentElement = new FakeElement('html');
  const body = new FakeElement('body');
  body.append(...groups);
  documentElement.append(body);
  return {
    document: {
      documentElement,
      body,
      querySelector: (selector: string) => documentElement.querySelectorAll(selector)[0] ?? null,
      querySelectorAll: (selector: string) => documentElement.querySelectorAll(selector),
    } as unknown as Document,
    body,
  };
}

/** Mount against a stubbed observer; the module's own pass runs at mount. */
function mount(document: Document, hideEmpty: boolean): { dispose: () => void } {
  const original = globalThis.MutationObserver;
  FakeObserver.instances = [];
  globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
  try {
    return { dispose: mountEmptyGroups(document, hideEmpty, error => { throw error; }) };
  } finally {
    globalThis.MutationObserver = original;
  }
}

test('a group with a Session row keeps its place, an empty one does not', () => {
  const full = group('with-sessions', session('a'));
  const empty = group('without-sessions');
  const { document } = fakeDocument(full, empty);
  const mounted = mount(document, true);
  try {
    assert.equal(full.hasAttribute('data-ccd-empty-group'), false);
    assert.equal(empty.hasAttribute('data-ccd-empty-group'), true);
  } finally {
    mounted.dispose();
  }
});

test('hidden placeholders never keep a group, while overflow and durable current rows do', () => {
  const placeholder = group('provisional', session('new', { 'data-ccd-blank-session': '' }));
  const overflow = group('more-behind-the-button', new FakeElement('button', { 'data-row-key': 'overflow:more' }));
  const current = group('current', session('now', { 'aria-selected': 'true', 'data-ccd-blank-session': '' }));
  const { document } = fakeDocument(placeholder, overflow, current);
  const mounted = mount(document, true);
  try {
    /* A provisional New Session is a row this plugin already keeps out, so a
       Workspace holding nothing else has nothing to show. */
    assert.equal(placeholder.hasAttribute('data-ccd-empty-group'), true);
    assert.equal(overflow.hasAttribute('data-ccd-empty-group'), false);
    assert.equal(current.hasAttribute('data-ccd-empty-group'), true);
  } finally {
    mounted.dispose();
  }
});

test('catalog membership hides empty collapsed groups and updates without expanding them', () => {
  const empty = group('empty');
  const full = group('full');
  for (const node of [empty, full]) node.children[0]!.setAttribute('aria-expanded', 'false');
  const { document } = fakeDocument(empty, full);
  let populated = new Set(['full']);
  let listener: () => void = () => {};
  let released = false;
  const original = globalThis.MutationObserver;
  globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
  const dispose = mountEmptyGroups(document, true, error => { throw error; }, {
    source: {
      hasHistory: () => true,
      populatedGroups: () => populated,
      subscribe(notify) { listener = notify; return () => { released = true; }; },
    },
  });
  globalThis.MutationObserver = original;
  try {
    assert.equal(empty.hasAttribute('data-ccd-empty-group'), true);
    assert.equal(full.hasAttribute('data-ccd-empty-group'), false);
    populated = new Set(); listener();
    assert.equal(full.hasAttribute('data-ccd-empty-group'), true);
  } finally { dispose(); }
  assert.equal(released, true);
});

test('a nested group’s Sessions keep the parent on screen', () => {
  const child = group('child', session('b'));
  const parent = group('parent');
  const nesting = new FakeElement('div', { role: 'group' });
  nesting.append(child);
  parent.append(nesting);
  const alone = group('parent-without-children');
  const nestingAlone = new FakeElement('div', { role: 'group' });
  nestingAlone.append(alone);
  const childless = group('top');
  childless.append(nestingAlone);
  const { document } = fakeDocument(parent, childless);
  const mounted = mount(document, true);
  try {
    assert.equal(parent.hasAttribute('data-ccd-empty-group'), false);
    assert.equal(childless.hasAttribute('data-ccd-empty-group'), true);
  } finally {
    mounted.dispose();
  }
});

test('collapsed Workspaces remain reachable until expansion reveals their membership', () => {
  const collapsed = group('collapsed');
  collapsed.children[0]!.setAttribute('aria-expanded', 'false');
  const parent = group('parent', collapsed);
  const { document } = fakeDocument(parent);
  const mounted = mount(document, true);
  try {
    assert.equal(collapsed.hasAttribute('data-ccd-empty-group'), false);
    assert.equal(parent.hasAttribute('data-ccd-empty-group'), false);
    // Once expanded with no rows, the workspace can safely be classified empty.
    collapsed.children[0]!.setAttribute('aria-expanded', 'true');
    FakeObserver.instances[0]!.callback();
    assert.equal(collapsed.hasAttribute('data-ccd-empty-group'), true);
    assert.equal(parent.hasAttribute('data-ccd-empty-group'), true);
  } finally {
    mounted.dispose();
  }
});

test('the switch off means the sidebar is left exactly as the host drew it', () => {
  const empty = group('without-sessions');
  const { document } = fakeDocument(empty);
  const mounted = mount(document, false);
  try {
    assert.equal(empty.hasAttribute('data-ccd-empty-group'), false);
  } finally {
    mounted.dispose();
  }
});

test('a released rule takes every marker back', () => {
  const empty = group('without-sessions');
  const { document } = fakeDocument(empty);
  const mounted = mount(document, true);
  assert.equal(empty.hasAttribute('data-ccd-empty-group'), true);
  mounted.dispose();
  assert.equal(empty.hasAttribute('data-ccd-empty-group'), false);
});
