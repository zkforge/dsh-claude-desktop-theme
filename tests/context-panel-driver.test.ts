import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  OPEN_ATTRIBUTE, OPEN_MARKER, createContextPanelDriver,
} from '../src/client/compat/context-panel.ts';
import type { ContextProjectionPort, ContextProjectionRead } from '../src/client/contracts/ports.ts';

/*
 * The context-panel driver's contract.
 *
 * DSH opens its own 264px breakdown panel from the ring's click and publishes
 * no face that reads or drives it, so this module owns the interaction: it
 * intercepts the trigger's click (the host's handler is React-delegated at the
 * root, so stopping the event on the button keeps the host's panel from ever
 * opening), reads the host's own projections off the session list, and holds
 * the open and expanded state the card draws.
 *
 * These tests pin the four facts the rest of the plugin leans on — the click is
 * intercepted, the reading is the host's, a trigger or a Session that goes away
 * closes the panel, and a released driver leaves the ring exactly as it found
 * it.
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

  closest(selector: string): FakeElement | null {
    let node: FakeElement | null = this;
    while (node !== null) {
      if (node.matchesChain(selector)) return node;
      node = node.parent;
    }
    return null;
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

/** The ring's own numbers, as the host's projections carry them. */
const READING: ContextProjectionRead = {
  window: 1000000,
  used: 112035,
  systemTokens: 1953,
  toolsTokens: 7492,
  messageTokens: 90461,
  breakdown: {
    tools: [['mcp__ccd__read', 4000], ['bash', 561]],
    files: [['AGENTS.md', 361]],
    skills: [['grilling', 438]],
    skillTokens: 438,
    fileTokens: 361,
    compaction: null,
  },
};

/** One Conversation page: a Session body holding the Composer's ring trigger. */
function page(session = 'session-a'): {
  trigger: FakeElement; body: FakeElement; document: Document; html: FakeElement;
  hostOpens: () => number; detach: () => void;
} {
  const html = new FakeElement('html', { 'data-dsh-ccd-style': 'true' });
  const body = new FakeElement('body');
  const sessionBody = new FakeElement('div', { 'data-conversation-session': session });
  const seat = new FakeElement('div', { class: 'yhfFVG_dock' });
  /* The host renders `aria-expanded` from its own open state, which is always
     false here: nothing but this plugin ever opens the panel. */
  const trigger = new FakeElement('button', {
    type: 'button', class: 'y0jqnG_trigger', 'aria-expanded': 'false', 'aria-haspopup': 'dialog',
  });
  seat.append(trigger);
  sessionBody.append(seat);
  body.append(sessionBody);
  html.append(body);
  const document = {
    documentElement: html,
    body,
    querySelector: (selector: string) => html.querySelector(selector),
    querySelectorAll: (selector: string) => html.querySelectorAll(selector),
  } as unknown as Document;
  /* The host's own handler, on an ancestor: React delegates at the root, so a
     listener that stops propagation on the button never reaches this one. */
  let opens = 0;
  body.addEventListener('click', () => { opens += 1; });
  return { trigger, body, document, html, hostOpens: () => opens, detach: () => { sessionBody.remove(); } };
}

/** Mount against a stubbed observer; the driver's own pass runs at mount. */
function mount(document: Document, projections: ContextProjectionPort): ReturnType<typeof createContextPanelDriver> {
  const original = globalThis.MutationObserver;
  FakeObserver.instances = [];
  globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
  try {
    return createContextPanelDriver(document, projections, error => { throw error; });
  } finally {
    globalThis.MutationObserver = original;
  }
}

/** A projection port over one session's readings, with a wake signal. */
function projectionsFor(readings: Map<string, ContextProjectionRead> = new Map([['session-a', READING]])): {
  port: ContextProjectionPort; wake: () => void; reads: string[];
} {
  const listeners = new Set<() => void>();
  const reads: string[] = [];
  return {
    port: {
      read(sessionId) { reads.push(sessionId); return readings.get(sessionId) ?? null; },
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
    wake: () => { for (const listener of listeners) listener(); },
    reads,
  };
}

test('the ring’s click opens this plugin’s panel and DSH’s own panel stays shut', () => {
  const { trigger, document, hostOpens } = page();
  const { port: projections } = projectionsFor();
  const driver = mount(document, projections);
  try {
    assert.equal(driver.port.getSnapshot().open, false);
    trigger.click();
    const snapshot = driver.port.getSnapshot();
    assert.equal(snapshot.open, true, 'the panel is up');
    assert.equal(snapshot.anchor, trigger);
    assert.equal(hostOpens(), 0, 'the host’s delegated handler never ran');
    assert.equal(document.documentElement.hasAttribute(OPEN_MARKER), true);
    assert.equal(trigger.getAttribute(OPEN_ATTRIBUTE), '');
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  } finally { driver.dispose(); }
});

test('the reading is the host’s own, with this plugin’s rows beside it', () => {
  const { trigger, document } = page();
  const { port: projections } = projectionsFor();
  const driver = mount(document, projections);
  try {
    trigger.click();
    const snapshot = driver.port.getSnapshot();
    const breakdown = snapshot.breakdown;
    assert.ok(breakdown !== null, 'the ring’s numbers must answer');
    assert.equal(breakdown.window, 1000000);
    assert.equal(breakdown.used, 112035);
    assert.equal(breakdown.percent, 11);
    assert.deepEqual(snapshot.files, [['AGENTS.md', 361]]);
    assert.deepEqual(snapshot.skills, [['grilling', 438]]);
    assert.deepEqual(snapshot.mcp.map(([name]) => name), ['mcp__ccd__read']);
    assert.deepEqual(snapshot.tools.map(([name]) => name), ['bash']);
    const keys = breakdown.slices.map(entry => entry.key);
    assert.deepEqual(keys, ['mcp', 'tools', 'system', 'skills', 'memory', 'messages', 'free']);
    assert.equal(breakdown.slices.reduce((sum, entry) => sum + entry.tokens, 0), 1000000 - breakdown.residual);
  } finally { driver.dispose(); }
});

test('the panel is collapsed until it is asked to expand, and folds back when it closes', () => {
  const { trigger, document } = page();
  const { port: projections } = projectionsFor();
  const driver = mount(document, projections);
  try {
    trigger.click();
    assert.equal(driver.port.getSnapshot().expanded, false, 'the reference opens collapsed');
    driver.port.toggleExpanded();
    assert.equal(driver.port.getSnapshot().expanded, true);
    driver.port.toggleExpanded();
    assert.equal(driver.port.getSnapshot().expanded, false);
    driver.port.toggleExpanded();
    driver.port.close();
    assert.equal(driver.port.getSnapshot().open, false);
    assert.equal(driver.port.getSnapshot().expanded, false, 'expansion lives only while the panel is open');
    assert.equal(document.documentElement.hasAttribute(OPEN_MARKER), false);
    trigger.click();
    assert.equal(driver.port.getSnapshot().expanded, false, 'a reopened panel starts collapsed again');
  } finally { driver.dispose(); }
});

test('a live projection frame reaches the open panel and nothing else', () => {
  const readings = new Map([['session-a', READING]]);
  const { trigger, document } = page();
  const { port: projections, wake, reads } = projectionsFor(readings);
  const driver = mount(document, projections);
  try {
    wake();
    assert.deepEqual(reads, [], 'a closed panel costs the list nothing');
    trigger.click();
    const before = driver.port.getSnapshot();
    readings.set('session-a', { ...READING, used: 500000, messageTokens: 400000 });
    wake();
    const after = driver.port.getSnapshot();
    assert.notEqual(after, before, 'the snapshot is replaced so React re-reads it');
    assert.equal(after.breakdown?.used, 500000);
    assert.equal(after.breakdown?.percent, 50);
  } finally { driver.dispose(); }
});

test('a Session change or a trigger that goes away closes the panel', () => {
  const { trigger, document, detach } = page();
  const { port: projections } = projectionsFor();
  const driver = mount(document, projections);
  try {
    trigger.click();
    assert.equal(driver.port.getSnapshot().open, true);
    /* The Conversation page keeps its body and swaps the Session under it. */
    trigger.closest('[data-conversation-session]')?.setAttribute('data-conversation-session', 'session-b');
    FakeObserver.flush();
    assert.equal(driver.port.getSnapshot().open, false, 'the reading belonged to the Session that left');
    assert.equal(document.documentElement.hasAttribute(OPEN_MARKER), false);

    trigger.click();
    assert.equal(driver.port.getSnapshot().open, true);
    detach();
    FakeObserver.flush();
    assert.equal(driver.port.getSnapshot().open, false);
    assert.equal(driver.port.getSnapshot().anchor, null);
  } finally { driver.dispose(); }
});

test('a session the list has no capacity for draws no reading at all', () => {
  const { trigger, document } = page('session-cold');
  const { port: projections } = projectionsFor(new Map());
  const driver = mount(document, projections);
  try {
    trigger.click();
    const snapshot = driver.port.getSnapshot();
    assert.equal(snapshot.open, true);
    assert.equal(snapshot.breakdown, null, 'the ring itself renders nothing without a capacity');
    assert.deepEqual(snapshot.mcp, []);
  } finally { driver.dispose(); }
});

test('mount and host ARIA updates settle without starving the renderer', () => {
  const { trigger, document } = page();
  const { port: projections } = projectionsFor();
  const driver = mount(document, projections);
  try {
    FakeObserver.flush();
    assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'a closed panel leaves the ring as DSH drew it');
    trigger.click();
    FakeObserver.flush();
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    /* The host re-renders the ring from its own state, which is still closed. */
    trigger.setAttribute('aria-expanded', 'false');
    FakeObserver.flush();
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    driver.port.close();
    FakeObserver.flush();
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  } finally { driver.dispose(); }
});

test('a released driver leaves the ring as it found it', () => {
  const { trigger, document } = page();
  const { port: projections } = projectionsFor();
  const driver = mount(document, projections);
  trigger.click();
  assert.equal(trigger.getAttribute(OPEN_ATTRIBUTE), '');
  assert.equal(document.documentElement.hasAttribute(OPEN_MARKER), true);
  driver.dispose();
  assert.equal(trigger.getAttribute(OPEN_ATTRIBUTE), null);
  assert.equal(trigger.getAttribute('aria-expanded'), null);
  assert.equal(document.documentElement.hasAttribute(OPEN_MARKER), false);
  /* The click goes back to DSH once nothing owns the control. */
  trigger.click();
  assert.equal(trigger.getAttribute('aria-expanded'), null);
});
