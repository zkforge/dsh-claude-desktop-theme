import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DRIVING_ATTRIBUTE, OPEN_ATTRIBUTE, createViewOptionsDriver,
} from '../src/client/compat/view-options.ts';

/*
 * The view-options driver's contract.
 *
 * DSH publishes no way to read or write the three view settings, so this module
 * drives the host's own menu: opening the trigger opens that card off screen,
 * reads its three groups, and closes it again; choosing an option clicks the
 * host's own row. These tests pin the four facts the rest of the plugin leans
 * on — the trigger's own click is intercepted (the reader never sees the host's
 * card), the values come back in the host's order with the host's own words, a
 * card that is not the pinned shape hands the click back to DSH, and a released
 * driver leaves the trigger exactly as it found it.
 *
 * The double models React's own delegation: the host's click handler sits on an
 * ancestor, so stopping propagation on the button is what keeps it from running.
 */

/** One element of the fake tree, with the selector support the module needs. */
class FakeElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  readonly listeners = new Map<string, ((event: FakeEvent) => void)[]>();
  text = '';

  constructor(tagName: string, attributes: Record<string, string> = {}) {
    this.tagName = tagName;
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
  }

  get parentElement(): FakeElement | null { return this.parent; }

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    // Browsers notify even when setAttribute writes the value already present.
    FakeObserver.attributeChanged(this, name);
  }

  removeAttribute(name: string): void { this.attributes.delete(name); }

  hasAttribute(name: string): boolean { return this.attributes.has(name); }

  get textContent(): string {
    return this.children.length === 0 ? this.text : this.children.map(child => child.textContent).join('');
  }

  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }

  append(...children: FakeElement[]): void {
    for (const child of children) {
      child.parent?.children.splice(child.parent.children.indexOf(child), 1);
      child.parent = this;
      this.children.push(child);
    }
  }

  remove(): void {
    if (this.parent === null) return;
    this.parent.children = this.parent.children.filter(child => child !== this);
    this.parent = null;
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter(entry => entry !== listener));
  }

  /** One click, bubbling from here to the root and honouring `stopPropagation`. */
  click(): void {
    const event = new FakeEvent();
    let node: FakeElement | null = this;
    while (node !== null) {
      for (const listener of node.listeners.get('click') ?? []) listener(event);
      if (event.stopped) return;
      node = node.parent;
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

/** The one event shape the module touches. */
class FakeEvent {
  stopped = false;
  stopPropagation(): void { this.stopped = true; }
}

/** Observer double recording the last instance so a test can force a pass. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly callback: () => void;
  disconnected = false;
  target: FakeElement | null = null;
  filter: readonly string[] = [];
  pending = false;
  constructor(callback: () => void) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }
  observe(target: FakeElement, options: MutationObserverInit): void {
    this.target = target;
    this.filter = options.attributeFilter ?? [];
  }
  disconnect(): void { this.disconnected = true; this.pending = false; }
  static attributeChanged(target: FakeElement, name: string): void {
    for (const observer of FakeObserver.instances) {
      if (!observer.disconnected && observer.target === target && observer.filter.includes(name)) {
        observer.pending = true;
      }
    }
  }
  static flush(): void {
    for (let pass = 0; pass < 10; pass += 1) {
      const pending = FakeObserver.instances.filter(observer => observer.pending);
      if (pending.length === 0) return;
      for (const observer of pending) {
        observer.pending = false;
        observer.callback();
      }
    }
    assert.fail('attribute notifications never settle; the renderer event loop would starve');
  }
}

/** One row of the host's card: the wrapper, the button and its label seat. */
function row(label: string, selected: boolean): FakeElement {
  const wrap = new FakeElement('div', { class: '_itemWrap_4ub78_90' });
  const button = new FakeElement('button', { type: 'button', role: 'menuitem', class: '_item_4ub78_90' });
  const seat = new FakeElement('span', { class: '_itemLabel_4ub78_190' });
  seat.textContent = label;
  button.append(seat);
  if (selected) button.append(new FakeElement('svg', { class: '_check_4ub78_179' }));
  wrap.append(button);
  return wrap;
}

/** The host's own card, in the pinned shape: three headings, one check each. */
function hostCard(): FakeElement {
  const list = new FakeElement('div', {
    role: 'menu', class: '_list_4ub78_7 _7514NG_viewOptionsMenu', 'data-menu-material': 'translucent',
  });
  const viewport = new FakeElement('div', { role: 'presentation', class: '_viewport_4ub78_19' });
  const groups: readonly (readonly [string, readonly (readonly [string, boolean])[]])[] = [
    ['分组方式', [['按工作区', true], ['按工作区树', false], ['单列表', false]]],
    ['排序方式', [['手动排序', false], ['最近更新', true]]],
    ['筛选会话', [['隐藏已归档', true], ['全部对话（显示已归档）', false], ['仅显示已归档', false]]],
  ];
  for (const [heading, rows] of groups) {
    const title = new FakeElement('div', { role: 'presentation', class: '_label_4ub78_129' });
    title.textContent = heading;
    viewport.append(title, ...rows.map(([label, selected]) => row(label, selected)));
  }
  list.append(viewport);
  return list;
}

/** The sidebar's section header, its view-options trigger, and the host's menu. */
function sidebar(batchedSelection = false): {
  header: FakeElement; trigger: FakeElement; body: FakeElement; document: Document;
  mounted: () => boolean; clicked: string[];
} {
  const documentElement = new FakeElement('html', { 'data-dsh-ccd-style': 'true' });
  const body = new FakeElement('body');
  const header = new FakeElement('div', { class: '_7514NG_sectionHeader' });
  const trigger = new FakeElement('button', {
    type: 'button', class: '_7514NG_iconButton _7514NG_wide', 'aria-label': '视图选项',
  });
  header.append(trigger);
  body.append(header);
  documentElement.append(body);
  const document = {
    documentElement,
    body,
    querySelector: (selector: string) => documentElement.querySelector(selector),
    querySelectorAll: (selector: string) => documentElement.querySelectorAll(selector),
  } as unknown as Document;
  /* The host's own handler, on an ancestor: React delegates at the root, so a
     listener that stops propagation on the button never reaches this one. */
  const card = hostCard();
  let nativeOpen = false;
  body.addEventListener('click', () => {
    nativeOpen = !nativeOpen;
    if (nativeOpen && card.parentElement === null) body.append(card);
    else if (!nativeOpen) card.remove();
  });
  /* What the host's own rows were chosen with, in the order they were clicked. */
  const clicked: string[] = [];
  for (const row of card.querySelectorAll('[role="menuitem"]')) {
    row.addEventListener('click', event => {
      clicked.push(row.textContent); event.stopPropagation();
      if (batchedSelection) {
        nativeOpen = false;
        setTimeout(() => { if (!nativeOpen) card.remove(); }, 0);
      }
    });
  }
  return { header, trigger, body, document, mounted: () => card.parentElement !== null, clicked };
}

/** Mount against a stubbed observer; the driver's own pass runs at mount. */
function mount(document: Document): ReturnType<typeof createViewOptionsDriver> {
  const original = globalThis.MutationObserver;
  FakeObserver.instances = [];
  globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
  try {
    return createViewOptionsDriver(document, error => { throw error; });
  } finally {
    globalThis.MutationObserver = original;
  }
}

/** Let the driver's asynchronous read finish; its own steps are microtasks. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
}

test('mount and host ARIA updates settle without starving the renderer', async () => {
  const { trigger, document } = sidebar();
  const driver = mount(document);
  try {
    FakeObserver.flush();
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    trigger.click();
    await settle();
    FakeObserver.flush();
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    // A late host write must be corrected once, then stop notifying itself.
    trigger.setAttribute('aria-expanded', 'false');
    FakeObserver.flush();
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    driver.port.close();
    FakeObserver.flush();
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  } finally {
    driver.dispose();
  }
});

test('show-all selection waits for the host commit instead of reopening its native menu', async () => {
  const { document, mounted, clicked } = sidebar(true);
  const driver = mount(document);
  try {
    assert.equal(await driver.port.choose(2, 1), true);
    assert.deepEqual(clicked, ['全部对话（显示已归档）']);
    assert.equal(mounted(), false, 'React’s delayed removal must not cause another toggle');
    assert.equal(document.documentElement.hasAttribute(DRIVING_ATTRIBUTE), false);
    assert.equal(driver.settings.getSnapshot()?.groups[2]?.selected, 1);
  } finally { driver.dispose(); }
});

test('the trigger opens this plugin’s card and the host’s own menu stays unseen', async () => {
  const { trigger, document, mounted } = sidebar();
  const driver = mount(document);
  try {
    trigger.click();
    await settle();
    const snapshot = driver.port.getSnapshot();
    assert.equal(snapshot.open, true, 'the card is up');
    assert.equal(snapshot.anchor, trigger);
    assert.equal(mounted(), false, 'the host’s card was read and put away again');
    assert.equal(document.documentElement.hasAttribute(DRIVING_ATTRIBUTE), false);
    assert.equal(trigger.getAttribute(OPEN_ATTRIBUTE), '');
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  } finally {
    driver.dispose();
  }
});

test('the values come back in the host’s order, in the host’s own words', async () => {
  const { trigger, document } = sidebar();
  const driver = mount(document);
  try {
    trigger.click();
    await settle();
    const values = driver.port.getSnapshot().values;
    assert.ok(values !== null, 'the read must answer');
    assert.deepEqual(values.groups.map(group => group.label), ['分组方式', '排序方式', '筛选会话']);
    assert.deepEqual(values.groups.map(group => group.labels), [
      ['按工作区', '按工作区树', '单列表'],
      ['手动排序', '最近更新'],
      ['隐藏已归档', '全部对话（显示已归档）', '仅显示已归档'],
    ]);
    assert.deepEqual(values.groups.map(group => group.selected), [0, 1, 0]);
  } finally {
    driver.dispose();
  }
});

test('choosing an option clicks the host’s own row, and the card steps aside', async () => {
  const { trigger, document, clicked } = sidebar();
  const driver = mount(document);
  try {
    trigger.click();
    await settle();
    const applied = await driver.port.choose(2, 2);
    assert.equal(applied, true);
    assert.deepEqual(clicked, ['仅显示已归档'], 'the host’s own third filter row');
    assert.equal(driver.settings.getSnapshot()?.groups[2]?.selected, 2, 'empty-group rules receive the applied native filter');
    assert.equal(document.documentElement.hasAttribute(DRIVING_ATTRIBUTE), false);
  } finally {
    driver.dispose();
  }
});

test('initial inspection reads persisted settings without opening the plugin menu', async () => {
  const { document, mounted, trigger } = sidebar();
  const driver = mount(document);
  let notifications = 0;
  const off = driver.settings.subscribe(() => { notifications += 1; });
  try {
    await driver.inspect();
    FakeObserver.flush();
    assert.equal(driver.settings.getSnapshot()?.groups[2]?.selected, 0);
    assert.equal(driver.port.getSnapshot().open, false);
    assert.equal(mounted(), false);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(notifications, 1);
    await driver.inspect();
    assert.equal(notifications, 1, 'unchanged preferences do not churn observers');
  } finally { off(); driver.dispose(); }
});

test('a card that is not the pinned shape hands the click back to DSH', async () => {
  const { trigger, document, body, mounted } = sidebar();
  /* The host's card, as a later build might draw it: two groups, no headings. */
  const other = new FakeElement('div', { role: 'menu', class: '_7514NG_viewOptionsMenu' });
  const viewport = new FakeElement('div', { role: 'presentation' });
  viewport.append(row('按工作区', true), row('手动排序', true));
  other.append(viewport);
  body.append(other);
  const driver = mount(document);
  try {
    trigger.click();
    await settle();
    assert.equal(driver.port.getSnapshot().open, false, 'this plugin draws no card');
    assert.equal(driver.port.getSnapshot().values, null);
    assert.equal(document.documentElement.hasAttribute(DRIVING_ATTRIBUTE), false);
    /* The host's own handler ran on the pass-through click, so its menu is the
       one on screen — the interface stays usable. */
    assert.equal(mounted(), true);
  } finally {
    driver.dispose();
  }
});

test('a released driver leaves the trigger as it found it', async () => {
  const { trigger, document } = sidebar();
  const driver = mount(document);
  trigger.click();
  await settle();
  assert.equal(trigger.getAttribute(OPEN_ATTRIBUTE), '');
  driver.dispose();
  assert.equal(trigger.getAttribute(OPEN_ATTRIBUTE), null);
  assert.equal(trigger.getAttribute('aria-expanded'), null);
  assert.equal(document.documentElement.hasAttribute(DRIVING_ATTRIBUTE), false);
});
