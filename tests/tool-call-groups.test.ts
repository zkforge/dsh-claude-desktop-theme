import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consecutiveToolGroups, mountToolCallGroups, toolGroupLabel, type ToolGroupEntry } from '../src/client/compat/tool-call-groups.ts';

const entry = (value: string, kind: ToolGroupEntry<string>['kind'] = 'command',
  settled = true, turn = '1'): ToolGroupEntry<string> => ({ value, kind, settled, turn, failed: false });

test('text splits three commands and two commands into independent runs', () => {
  assert.deepEqual(consecutiveToolGroups([
    entry('date'), entry('pwd'), entry('status'), entry('reply', 'barrier'), entry('log'), entry('branch'),
  ]).map(run => run.map(item => item.value)), [['date', 'pwd', 'status'], ['log', 'branch']]);
});

test('mixed tool kinds keep chronological order while the label counts each category', () => {
  const runs = consecutiveToolGroups([
    entry('skill', 'tool'), entry('pdf', 'read'), entry('tex', 'read'), entry('shell'),
  ]);
  assert.deepEqual(runs[0]?.map(item => item.value), ['skill', 'pdf', 'tex', 'shell']);
  assert.equal(toolGroupLabel(['tool', 'read', 'read', 'command']), 'Read 2 files, ran a command, used a tool');
  assert.equal(toolGroupLabel(['command', 'command', 'command']), 'Ran 3 commands');
  assert.equal(toolGroupLabel(['command']), 'Ran 1 command');
});

test('live calls and new turns never disappear inside an earlier collapsed group', () => {
  assert.deepEqual(consecutiveToolGroups([
    entry('done'), entry('approval', 'command', false), entry('after'), entry('next-turn', 'command', true, '2'),
  ]).map(run => run.map(item => item.value)), [['done'], ['after'], ['next-turn']]);
});

test('reasoning joins consecutive tools without inflating tool counts or crossing replies', () => {
  const kinds: ToolGroupEntry<string>[] = [
    entry('thought-1', 'reasoning'), entry('tool-1', 'tool'), entry('thought-2', 'reasoning'),
    entry('read', 'read'), entry('reply', 'barrier'), entry('shell'),
  ];
  assert.deepEqual(consecutiveToolGroups(kinds).map(run => run.map(item => item.value)), [
    ['thought-1', 'tool-1', 'thought-2', 'read'], ['shell'],
  ]);
  assert.equal(toolGroupLabel(['reasoning', 'tool', 'reasoning', 'tool']), 'Thought, used 2 tools');
  assert.equal(toolGroupLabel(['reasoning', 'read', 'command']), 'Thought, read a file, ran a command');
});

/** Minimal DOM double: assert identity and ownership without launching a browser. */
class ElementDouble {
  readonly nodeType = 1;
  tagName = 'DIV';
  readonly attrs = new Map<string, string>();
  readonly children: ElementDouble[] = [];
  parentElement: ElementDouble | null = null;
  textContent = '';
  type = '';
  connectedRoot = false;
  readonly listeners = new Map<string, () => void>();
  get isConnected(): boolean { return this.connectedRoot || this.parentElement?.isConnected === true; }
  get nextElementSibling(): ElementDouble | null {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  setAttribute(key: string, value: string) { this.attrs.set(key, value); }
  getAttribute(key: string) { return this.attrs.get(key) ?? null; }
  hasAttribute(key: string) { return this.attrs.has(key); }
  removeAttribute(key: string) { this.attrs.delete(key); }
  matches(selector: string): boolean {
    return selector.split(',').some(part => {
      const match = part.trim().match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      return !!match && (match[2] === undefined ? this.hasAttribute(match[1]!) : this.getAttribute(match[1]!) === match[2]);
    });
  }
  closest(selector: string): ElementDouble | null {
    return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string): ElementDouble[] {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  append(...children: ElementDouble[]) { for (const child of children) this.insertBefore(child, null); }
  insertBefore(child: ElementDouble, before: ElementDouble | null) {
    child.remove();
    this.children.splice(before === null ? this.children.length : this.children.indexOf(before), 0, child);
    child.parentElement = this;
  }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  addEventListener(type: string, callback: () => void) { this.listeners.set(type, callback); }
  click() { this.listeners.get('click')?.(); }
}

const node = (attrs: Record<string, string> = {}) => {
  const element = new ElementDouble();
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
};
function call(name = 'bash', state = 'ok') {
  const flow = node({ 'data-chat-flow-kind': 'tool-call', 'data-chat-turn': '1' });
  const atomic = node({ 'data-chat-call-id': String(Math.random()) });
  const row = node({ 'data-tool': name, 'data-state': state });
  atomic.append(row);
  flow.append(atomic);
  return { flow, atomic, row };
}

test('DOM mixed groups retain native reasoning and leave streaming or mixed response seats visible', async () => {
  const nativeObserver = globalThis.MutationObserver;
  let notify: (records: MutationRecord[]) => void = () => {};
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;
  const body = node(), parent = node();
  body.connectedRoot = true;
  body.append(parent);
  const thinking = () => {
    const flow = node({ 'data-chat-flow-kind': 'assistant-step', 'data-chat-group-part': 'reasoning', 'data-chat-turn': '1' });
    const row = node({ 'data-variant': 'think', 'data-state': 'ok' });
    flow.append(row);
    return { flow, row };
  };
  const first = thinking(), second = thinking(), command = call(), read = call('read');
  const response = node({ 'data-chat-flow-kind': 'assistant-step', 'data-chat-group-part': 'response', 'data-chat-turn': '1' });
  // Even a response with a reasoning descendant must never be hidden as thought.
  response.append(node({ 'data-variant': 'think', 'data-state': 'ok' }));
  const last = thinking();
  parent.append(first.flow, command.flow, second.flow, read.flow, response, last.flow);
  const errors: unknown[] = [];
  const dispose = mountToolCallGroups({ body, createElement: () => node() } as unknown as Document, error => errors.push(error));
  const deliver = async (target: ElementDouble) => {
    notify([{ target, addedNodes: [], type: 'attributes' }] as unknown as MutationRecord[]);
    await Promise.resolve();
  };
  try {
    const toggle = parent.querySelectorAll('[data-ccd-tool-group-toggle]')[0]!;
    assert.equal(parent.querySelectorAll('[data-ccd-tool-group-toggle]').length, 1);
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Thought, read a file, ran a command');
    assert.equal(first.flow.getAttribute('data-ccd-tool-group-member'), 'closed');
    assert.equal(second.flow.getAttribute('data-ccd-tool-group-member'), 'closed');
    assert.equal(response.hasAttribute('data-ccd-tool-group-member'), false);
    assert.equal(last.flow.hasAttribute('data-ccd-tool-group-member'), false);
    toggle.click();
    assert.equal(first.flow.getAttribute('data-ccd-tool-group-member'), 'open');
    assert.equal(first.row.parentElement, first.flow);
    assert.equal(first.flow.parentElement, parent);
    second.row.setAttribute('data-state', 'running');
    await deliver(second.row);
    assert.equal(second.flow.hasAttribute('data-ccd-tool-group-member'), false);
    second.row.setAttribute('data-state', 'ok');
    await deliver(second.row);
    assert.equal(second.flow.getAttribute('data-ccd-tool-group-member'), 'open');
    assert.equal(parent.querySelectorAll('[data-ccd-tool-group-toggle]').length, 1);
    assert.deepEqual(errors, []);
  } finally {
    dispose();
    globalThis.MutationObserver = nativeObserver;
  }
  assert.equal(first.flow.hasAttribute('data-ccd-tool-group-member'), false);
  assert.equal(first.row.parentElement, first.flow);
});

test('DOM grouping preserves native parents, toggles independently, follows updates and fully cleans up', async () => {
  const nativeObserver = globalThis.MutationObserver;
  let notify: (records: MutationRecord[]) => void = () => {};
  let disconnected = false;
  let observedAttributes: string[] = [];
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe(_target: Node, options: MutationObserverInit) { observedAttributes = options.attributeFilter ?? []; }
    disconnect() { disconnected = true; }
  } as unknown as typeof MutationObserver;
  const body = node();
  body.connectedRoot = true;
  const parent = node();
  body.append(parent);
  const first = call(), second = call(), third = call();
  const reply = node({ 'data-chat-flow-kind': 'assistant-step' });
  const fourth = call('read'), live = call('bash', 'running');
  parent.append(first.flow, second.flow, third.flow, reply, fourth.flow, live.flow);
  const errors: unknown[] = [];
  const dispose = mountToolCallGroups({ body, createElement: () => node() } as unknown as Document, error => errors.push(error));
  const deliver = async (target: ElementDouble) => {
    notify([{ target, addedNodes: [], type: 'childList' }] as unknown as MutationRecord[]);
    await Promise.resolve();
  };
  try {
    const toggles = parent.querySelectorAll('[data-ccd-tool-group-toggle]');
    assert.deepEqual(toggles.map(button => button.children[0]?.children[0]?.textContent), ['Ran 3 commands', 'bash']);
    assert.equal(first.flow.getAttribute('data-ccd-tool-group-member'), 'closed');
    assert.equal(live.flow.getAttribute('data-ccd-tool-group-member'), 'closed', 'live calls share the single rolling disclosure');
    assert.equal(toggles[1]!.hasAttribute('data-ccd-tool-live'), true);
    toggles[0]!.click();
    assert.equal(third.flow.getAttribute('data-ccd-tool-group-member'), 'open');
    assert.equal(fourth.flow.getAttribute('data-ccd-tool-group-member'), 'closed');
    assert.equal(first.flow.parentElement, parent);
    assert.equal(first.row.parentElement, first.atomic);

    live.row.setAttribute('data-state', 'ok');
    await deliver(live.row);
    assert.equal(toggles[1]!.children[0]!.children[0]!.textContent, 'Read a file, ran a command');
    assert.equal(toggles[0]!.getAttribute('aria-expanded'), 'true', 'unrelated settlement retains the reader’s open state');

    // A newly inserted reply splits an existing run and gives the later calls their own disclosure.
    const inserted = node({ 'data-chat-flow-kind': 'assistant-step' });
    parent.insertBefore(inserted, second.flow);
    await deliver(parent);
    assert.deepEqual(parent.querySelectorAll('[data-ccd-tool-group-toggle]').map(button => button.children[0]?.children[0]?.textContent),
      ['Ran 1 command', 'Ran 2 commands', 'Read a file, ran a command']);
    second.row.setAttribute('data-state', 'error');
    await deliver(second.row);
    assert.equal(second.flow.getAttribute('data-ccd-tool-group-member'), 'open', 'a newly failed group reveals its error');
    assert.equal(first.row.getAttribute('data-state'), 'ok');

    const childCall = node({ 'data-chat-call-id': 'nested' });
    const childRow = node({ 'data-tool': 'bash', 'data-state': 'running' });
    childCall.append(childRow);
    third.atomic.append(childCall);
    await deliver(third.atomic);
    assert.equal(third.flow.getAttribute('data-ccd-tool-group-member'), null, 'an active nested call cannot be hidden with its settled parent');
    childRow.setAttribute('data-state', 'ok');
    await deliver(childRow);
    assert.equal(third.flow.getAttribute('data-ccd-tool-group-member'), 'open');
    assert.equal(parent.querySelectorAll('[data-ccd-tool-group-toggle]')[1]!.children[0]!.children[0]!.textContent, 'Ran 2 commands', 'nested calls are not counted twice');

    const specialParent = node();
    const present = call('present');
    const cordis = call('cordis_run');
    cordis.row.setAttribute('data-cordis-status', 'awaiting-approval');
    const schedule = call('schedule_create');
    schedule.row.removeAttribute('data-state');
    specialParent.append(present.flow, cordis.flow, schedule.flow);
    body.append(specialParent);
    await deliver(specialParent);
    assert.equal(present.flow.getAttribute('data-ccd-tool-group-member'), 'closed');
    assert.equal(cordis.flow.getAttribute('data-ccd-tool-group-member'), null, 'Cordis approval remains visible even after its tool call returns');
    assert.equal(schedule.flow.getAttribute('data-ccd-tool-group-member'), null, 'a pending schedule has no success evidence');
    assert.ok(observedAttributes.includes('data-cordis-status'));
    cordis.row.setAttribute('data-cordis-status', 'idle');
    await deliver(cordis.row);
    assert.equal(specialParent.querySelectorAll('[data-ccd-tool-group-toggle]')[0]!.children[0]!.children[0]!.textContent, 'Used 2 tools');
    const openTask = node({ 'aria-label': 'Open created task' });
    openTask.tagName = 'BUTTON';
    let opened = 0;
    openTask.addEventListener('click', () => { opened++; });
    schedule.row.append(openTask);
    await deliver(schedule.row);
    assert.equal(specialParent.querySelectorAll('[data-ccd-tool-group-toggle]')[0]!.children[0]!.children[0]!.textContent, 'Used 3 tools');
    openTask.click();
    assert.equal(opened, 1, 'the host task-navigation handler is retained');
    assert.equal(openTask.parentElement, schedule.row);
    openTask.remove();
    schedule.row.append(node()); // Raw fallback alone must not be mistaken for success.
    await deliver(schedule.row);
    assert.equal(schedule.flow.getAttribute('data-ccd-tool-group-member'), null);
    cordis.row.setAttribute('data-cordis-status', 'failed');
    await deliver(cordis.row);
    assert.equal(present.flow.getAttribute('data-ccd-tool-group-member'), 'open', 'a Cordis business failure reveals the group');
    assert.deepEqual(errors, []);
  } finally {
    dispose();
    globalThis.MutationObserver = nativeObserver;
  }
  assert.equal(disconnected, true);
  assert.equal(parent.querySelectorAll('[data-ccd-tool-group-toggle]').length, 0);
  assert.equal(parent.querySelectorAll('[data-ccd-tool-group-member]').length, 0);
  assert.equal(parent.querySelectorAll('[data-ccd-tool-group-kind]').length, 0);
  assert.equal(first.flow.parentElement, parent);
});

test('consecutive live tools reuse one rolling line, animate vertically and retain native details', async () => {
  const nativeObserver = globalThis.MutationObserver;
  let notify = (_records: MutationRecord[]) => {};
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  const body = node(), parent = node();
  body.connectedRoot = true; body.append(parent);
  const first = call('bash', 'running'); first.row.textContent = 'Checking git status';
  const second = call('read', 'running'); second.row.textContent = 'Reading README.md';
  parent.append(first.flow);
  const motions: { frames: Keyframe[]; cancelled: boolean; onfinish?: () => void }[] = [];
  const errors: unknown[] = [];
  const document = { body, createElement: () => Object.assign(node(), {
    animate(frames: Keyframe[]) {
      const motion = { frames, cancelled: false, cancel() { this.cancelled = true; } };
      motions.push(motion);
      return motion;
    },
  }) } as unknown as Document;
  const deliver = async () => {
    notify([{ target: parent, addedNodes: [], type: 'childList' }] as unknown as MutationRecord[]);
    await Promise.resolve();
  };
  const release = mountToolCallGroups(document, error => errors.push(error));
  try {
    const toggle = parent.querySelector('[data-ccd-tool-group-toggle]')!;
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Checking git status');
    first.row.setAttribute('data-state', 'ok');
    parent.append(second.flow);
    await deliver();
    assert.equal(parent.querySelectorAll('[data-ccd-tool-group-toggle]').length, 1);
    assert.equal(parent.querySelector('[data-ccd-tool-group-toggle]'), toggle);
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Reading README.md');
    assert.equal(first.flow.getAttribute('data-ccd-tool-group-member'), 'closed');
    assert.equal(second.flow.getAttribute('data-ccd-tool-group-member'), 'closed');
    assert.equal(first.flow.parentElement, parent);
    assert.equal(second.row.parentElement, second.atomic);
    assert.equal(motions[0]!.frames[1]!.transform, 'translateY(-100%)');
    assert.equal(motions[1]!.frames[0]!.transform, 'translateY(100%)');
    second.row.setAttribute('data-state', 'ok');
    await deliver();
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Read a file, ran a command');
    assert.equal(toggle.hasAttribute('data-ccd-tool-live'), false);
    assert.equal(motions[0]!.cancelled, true, 'new switches cancel earlier in-flight layers');
    toggle.click();
    assert.equal(first.flow.getAttribute('data-ccd-tool-group-member'), 'open');
    assert.equal(second.flow.getAttribute('data-ccd-tool-group-member'), 'open');
    assert.deepEqual(errors, []);
  } finally { release(); globalThis.MutationObserver = nativeObserver; }
  assert.equal(parent.querySelectorAll('[data-ccd-tool-group-toggle]').length, 0);
  assert.ok(motions.every(motion => motion.cancelled));
  assert.equal(first.flow.hasAttribute('data-ccd-tool-group-member'), false);
  assert.equal(second.row.parentElement, second.atomic);
});
