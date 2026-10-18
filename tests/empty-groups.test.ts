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

  prepend(...children: FakeElement[]): void {
    for (const child of children) child.parent = this;
    this.children.unshift(...children);
  }

  remove(): void {
    if (this.parent === null) return;
    this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }

  get className(): string { return this.attributes.get('class') ?? ''; }

  set className(value: string) { this.attributes.set('class', value); }

  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }

  set textContent(value: string) { this.children = []; this.text = value; }

  private text = '';

  /** The module writes one SVG block's markup; the fixture does not parse it. */
  set innerHTML(_value: string) { this.children = []; }

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

  /** The containment the batch predicate asks a measured region for. */
  contains(candidate: object): boolean {
    if (candidate === this) return true;
    return this.children.some(child => child.contains(candidate));
  }

  get isConnected(): boolean { return true; }
}

/** Observer double recording the last instance so a test can force a pass. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly callback: (records: MutationRecord[]) => void;
  disconnected = false;
  constructor(callback: (records: MutationRecord[]) => void) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }
  observe(): void {}
  disconnect(): void { this.disconnected = true; }
  /** Deliver one batch, as a browser would. */
  deliver(...targets: FakeElement[]): void {
    this.callback(targets.map(target => ({
      type: 'childList', target, addedNodes: [target], removedNodes: [],
    }) as unknown as MutationRecord));
  }
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

/** A document double over one fake tree.
 *
 * The rows live inside the browser's list area, the way the host draws them:
 * the module reads that area to filter batches and judges only what is under
 * it. The sidebar's search box and header live beside it in the same body. */
function fakeDocument(...groups: FakeElement[]) {
  const documentElement = new FakeElement('html');
  const body = new FakeElement('body');
  const area = new FakeElement('div', { class: '_7514NG_listArea' });
  const elsewhere = new FakeElement('div', { class: '_7514NG_sectionHeader' });
  area.append(...groups);
  body.append(elsewhere, area);
  documentElement.append(body);
  /* Every pass starts by listing the groups it judges, so counting those
     queries is counting passes. */
  let passes = 0;
  const findAll = (selector: string) => {
    if (selector.includes('groupSection')) passes += 1;
    return documentElement.querySelectorAll(selector);
  };
  /* The pass lists groups from the tree it found, not from the document. */
  const findAllInArea = area.querySelectorAll.bind(area);
  area.querySelectorAll = (selector: string) => {
    if (selector.includes('groupSection')) passes += 1;
    return findAllInArea(selector);
  };
  return {
    elsewhere,
    /* A reader, not a field: destructuring a getter would freeze the count. */
    passes: () => passes,
    document: {
      documentElement,
      body,
      querySelector: (selector: string) => findAll(selector)[0] ?? null,
      querySelectorAll: findAll,
      /* The empty state is the module's own markup; the fixture only needs a
         node it can attach, mark and remove. */
      createElement: (tagName: string) => new FakeElement(tagName),
      createElementNS: (_namespace: string, tagName: string) => new FakeElement(tagName),
    } as unknown as Document,
    body,
    area,
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
    FakeObserver.instances[0]!.deliver(collapsed);
    assert.equal(collapsed.hasAttribute('data-ccd-empty-group'), true);
    assert.equal(parent.hasAttribute('data-ccd-empty-group'), true);
  } finally {
    mounted.dispose();
  }
});

test('a batch from another pane scans no groups', () => {
  const empty = group('without-sessions');
  const { document, elsewhere, passes } = fakeDocument(empty);
  const mounted = mount(document, true);
  const after = passes();
  try {
    const observer = FakeObserver.instances[0]!;
    /* A streaming transcript, the right pane, the Composer: none of them can
       change which Workspace groups are empty. */
    for (let index = 0; index < 20; index += 1) observer.deliver(elsewhere);
    assert.equal(passes(), after, 'unrelated batches judge nothing');
    /* A row changing inside the tree still reaches the pass. */
    observer.deliver(empty);
    assert.equal(passes(), after + 1);
  } finally {
    mounted.dispose();
  }
});

test('a catalog answer is walked once until its own subscription publishes', () => {
  const empty = group('empty');
  const full = group('full');
  for (const node of [empty, full]) node.children[0]!.setAttribute('aria-expanded', 'false');
  const { document } = fakeDocument(empty, full);
  let walked = 0;
  let populated = new Set(['full']);
  let publish: () => void = () => {};
  const original = globalThis.MutationObserver;
  FakeObserver.instances = [];
  globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
  const dispose = mountEmptyGroups(document, true, error => { throw error; }, {
    source: {
      hasHistory: () => true,
      populatedGroups: () => { walked += 1; return populated; },
      subscribe(notify) { publish = notify; return () => {}; },
    },
  });
  globalThis.MutationObserver = original;
  try {
    assert.equal(walked, 1, 'the mount reads the catalogs once');
    const observer = FakeObserver.instances[0]!;
    /* Sidebar churn — a row arriving, a group expanding — cannot change what
       the catalogs say, so the walk is not repeated. */
    observer.deliver(full);
    observer.deliver(empty);
    assert.equal(walked, 1);
    populated = new Set();
    publish();
    assert.equal(walked, 2, 'a catalog publish is what invalidates the answer');
    assert.equal(full.hasAttribute('data-ccd-empty-group'), true);
  } finally { dispose(); }
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
