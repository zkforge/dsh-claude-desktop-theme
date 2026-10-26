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
  private text = '';
  get textContent(): string { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { for (const child of [...this.children]) child.remove(); this.text = value; }
  type = '';
  connectedRoot = false;
  scrollHeight = 0;
  clientHeight = 0;
  scrollTop = 0;
  readonly listeners = new Map<string, () => void>();
  get isConnected(): boolean { return this.connectedRoot || this.parentElement?.isConnected === true; }
  get nextElementSibling(): ElementDouble | null {
    const siblings = this.parentElement?.children ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
  getBoundingClientRect() {
    const text = this.children.length ? this.children.filter(child => !child.hasAttribute('data-ccd-tool-roll-out'))
      .map(child => child.textContent).join('') : this.textContent;
    return { width: text.length * 7 };
  }
  setAttribute(key: string, value: string) { this.attrs.set(key, value); }
  getAttribute(key: string) { return this.attrs.get(key) ?? null; }
  hasAttribute(key: string) { return this.attrs.has(key); }
  removeAttribute(key: string) { this.attrs.delete(key); }
  matches(selector: string): boolean {
    return selector.split(',').some(part => {
      const name = part.trim().match(/^\.([\w-]+)$/);
      if (name) return this.getAttribute('class')?.split(' ').includes(name[1]!) === true;
      const contains = part.trim().match(/^\[([^\]]+)\*="([^"]*)"\]$/);
      if (contains) return this.getAttribute(contains[1]!)?.includes(contains[2]!) === true;
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
  after(child: ElementDouble) { this.parentElement!.insertBefore(child, this.nextElementSibling); }
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

test('DOM mixed groups retain native reasoning and leave mixed response seats visible', async () => {
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
    const running = node({ 'data-chat-running': '' });
    body.append(running);
    second.row.setAttribute('data-state', 'running');
    await deliver(second.row);
    assert.equal(second.flow.getAttribute('data-ccd-tool-group-member'), 'open',
      'a streaming thought stays inside the run');
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Thinking');
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
  // A call or thought only runs while the host shows its running row.
  const running = node({ 'data-chat-running': '' });
  body.append(running);
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
    running.remove();
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

test('a fold that leaves the reader on the floor hands bottom-follow back to the host', async () => {
  const nativeObserver = globalThis.MutationObserver;
  let notify: (records: MutationRecord[]) => void = () => {};
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;
  // ChatView: [data-conversation-scroll] > frame > root > scroll > column, with
  // the jump-to-bottom slot beside root while the host is off the tail.
  const body = node(), scroller = node({ 'data-conversation-scroll': '' }), frame = node(), root = node();
  const list = node({ class: 'icaHSq_scroll' }), parent = node();
  body.connectedRoot = true;
  body.append(scroller);
  scroller.append(frame);
  frame.append(root);
  root.append(list);
  list.append(parent);
  const slot = node({ class: 'icaHSq_toBottomSlot' }), toBottom = node({ class: 'icaHSq_toBottom' });
  slot.append(toBottom);
  let pressed = 0;
  toBottom.addEventListener('click', () => { pressed++; });
  const first = call(), second = call();
  parent.append(first.flow, second.flow);
  const errors: unknown[] = [];
  const dispose = mountToolCallGroups({ body, createElement: () => node() } as unknown as Document, error => errors.push(error));
  const atFloor = () => { scroller.scrollHeight = 900; scroller.clientHeight = 600; scroller.scrollTop = 300; };
  try {
    const toggle = parent.querySelector('[data-ccd-tool-group-toggle]')!;
    toggle.click();
    assert.equal(first.flow.getAttribute('data-ccd-tool-group-member'), 'open');

    // Following the tail: the host renders no control, and no geometry is read.
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => assert.fail('measured while following') });
    toggle.click();
    assert.equal(pressed, 0);
    delete (scroller as { scrollHeight?: number }).scrollHeight;
    toggle.click();

    // Off the tail, but the fold clamped the reader onto the floor.
    frame.append(slot);
    atFloor();
    toggle.click();
    assert.equal(first.flow.getAttribute('data-ccd-tool-group-member'), 'closed');
    assert.equal(pressed, 1, 'the host control resumes following');

    // Expanding never presses it; a fold that leaves content below does not either.
    toggle.click();
    assert.equal(pressed, 1);
    scroller.scrollTop = 120;
    toggle.click();
    assert.equal(pressed, 1, 'a reader above the floor keeps their position');

    // A streamed call folding into the closed run shrinks the transcript too.
    atFloor();
    const third = call();
    parent.append(third.flow);
    notify([{ target: parent, addedNodes: [third.flow], type: 'childList' }] as unknown as MutationRecord[]);
    await Promise.resolve();
    assert.equal(third.flow.getAttribute('data-ccd-tool-group-member'), 'closed');
    assert.equal(pressed, 2);

    // A content update that folds nothing new leaves the host alone.
    third.row.setAttribute('data-tool', 'read');
    notify([{ target: third.row, addedNodes: [], type: 'attributes' }] as unknown as MutationRecord[]);
    await Promise.resolve();
    assert.equal(pressed, 2);
    assert.deepEqual(errors, []);
  } finally {
    dispose();
    globalThis.MutationObserver = nativeObserver;
  }
});

test('live tool labels coalesce rapid updates, settle gently and retain native details', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const nativeObserver = globalThis.MutationObserver;
  let notify = (_records: MutationRecord[]) => {};
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  const body = node(), parent = node();
  body.connectedRoot = true; body.append(parent);
  // A call or thought only runs while the host shows its running row.
  const running = node({ 'data-chat-running': '' });
  body.append(running);
  const first = call('bash', 'running'); first.row.textContent = 'Checking git status';
  const second = call('read', 'running'); second.row.textContent = 'Reading README.md';
  parent.append(first.flow);
  const motions: { frames: Keyframe[]; options: KeyframeAnimationOptions; cancelled: boolean; onfinish?: () => void }[] = [];
  const errors: unknown[] = [];
  let reducedMotion = false;
  const document = { body, defaultView: { matchMedia: () => ({ matches: reducedMotion }) }, createElement: () => Object.assign(node(), {
    animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
      const motion = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
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
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Checking git status', 'keep a readable dwell');
    second.row.textContent = 'Reading latest README.md';
    await deliver();
    context.mock.timers.tick(500);
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Checking git status', 'do not switch at the former fast cadence');
    context.mock.timers.tick(400);
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Reading latest README.md', 'only the latest state is shown');
    assert.equal(first.flow.getAttribute('data-ccd-tool-group-member'), 'closed');
    assert.equal(second.flow.getAttribute('data-ccd-tool-group-member'), 'closed');
    assert.equal(first.flow.parentElement, parent);
    assert.equal(second.row.parentElement, second.atomic);
    assert.equal(motions[0]!.frames[1]!.transform, 'translateY(-4px)');
    assert.equal(motions[1]!.frames[0]!.transform, 'translateY(4px)');
    assert.equal(motions[1]!.options.delay, 40, 'the handoff avoids a blank pause');
    assert.equal(motions[1]!.options.fill, 'backwards', 'no flash of the incoming text during its delay');
    assert.deepEqual(motions[2]!.frames, [{ width: '168px' }, { width: '168px' }], 'a longer incoming line has its full width from the start');
    assert.equal(motions[2]!.options.delay, 180, 'the seat only shrinks once the outgoing line has faded');
    second.row.setAttribute('data-state', 'ok');
    running.remove();
    await deliver();
    assert.equal(motions[0]!.cancelled, false, 'rapid updates do not interrupt the current transition');
    context.mock.timers.tick(900);
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Read a file, ran a command');
    assert.equal(motions[3]!.frames[1]!.transform, 'translateY(0)', 'completion only fades');
    assert.equal(motions[4]!.frames[0]!.transform, 'translateY(0)');
    assert.equal(toggle.hasAttribute('data-ccd-tool-live'), false);
    assert.equal(motions[0]!.cancelled, true, 'new switches cancel earlier in-flight layers');
    toggle.click();
    assert.equal(first.flow.getAttribute('data-ccd-tool-group-member'), 'open');
    assert.equal(second.flow.getAttribute('data-ccd-tool-group-member'), 'open');
    second.row.setAttribute('data-state', 'running');
    second.row.textContent = 'Another pending update';
    await deliver();
    second.row.setAttribute('data-state', 'error');
    const beforeFailure = motions.length;
    await deliver();
    assert.equal(motions.length, beforeFailure, 'failure reveals immediately without a decorative transition');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'failure details open immediately');
    assert.equal(second.flow.getAttribute('data-ccd-tool-group-member'), 'open');
    reducedMotion = true;
    body.append(running);
    second.row.setAttribute('data-state', 'running');
    second.row.textContent = 'Reduced motion activity';
    await deliver();
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Reduced motion activity');
    assert.equal(motions.length, beforeFailure, 'reduced motion skips both text and width animation');
    release();
    context.mock.timers.tick(1000);
    assert.equal(parent.querySelector('[data-ccd-tool-group-toggle]'), null, 'disposal cancels pending refresh');
    assert.deepEqual(errors, []);
  } finally { release(); globalThis.MutationObserver = nativeObserver; }
  assert.equal(parent.querySelectorAll('[data-ccd-tool-group-toggle]').length, 0);
  assert.ok(motions.every(motion => motion.cancelled));
  assert.equal(first.flow.hasAttribute('data-ccd-tool-group-member'), false);
  assert.equal(second.row.parentElement, second.atomic);
});

test('a working turn keeps rolling each call and only summarises once the reply follows', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const nativeObserver = globalThis.MutationObserver;
  let notify = (_records: MutationRecord[]) => {};
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  const body = node(), parent = node();
  body.connectedRoot = true; body.append(parent);
  const first = call('bash', 'running'); first.row.textContent = 'First call';
  const second = call('bash', 'running'); second.row.textContent = 'Second call';
  // The host seats the running row beside the flow rows while a turn is open.
  const running = node({ 'data-chat-running': '' });
  body.append(running);
  parent.append(first.flow);
  const errors: unknown[] = [];
  const document = { body, createElement: () => node() } as unknown as Document;
  const deliver = async () => {
    notify([{ target: parent, addedNodes: [], type: 'childList' }] as unknown as MutationRecord[]);
    await Promise.resolve();
  };
  const release = mountToolCallGroups(document, error => errors.push(error));
  try {
    const toggle = parent.querySelector('[data-ccd-tool-group-toggle]')!;
    context.mock.timers.tick(1000); // Let the first description pass its dwell.
    first.row.setAttribute('data-state', 'ok');
    parent.append(second.flow);
    await deliver();
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Second call');
    second.row.setAttribute('data-state', 'ok');
    await deliver();
    context.mock.timers.tick(10000);
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Second call',
      'a settled run keeps its current call until the next one starts');
    assert.equal(toggle.hasAttribute('data-ccd-tool-live'), true,
      'the waiting call stays the turn’s current activity');
    // The next call joins the same run and takes over the rolling line.
    const third = call('read', 'running'); third.row.textContent = 'Reading a file';
    parent.append(third.flow);
    await deliver();
    assert.equal(parent.querySelectorAll('[data-ccd-tool-group-toggle]').length, 1,
      'consecutive calls stay one disclosure');
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Reading a file');
    third.row.setAttribute('data-state', 'ok');
    await deliver();
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Reading a file',
      'the last call stays on screen after it settles');
    // Reply text after the run is what folds it into its counts summary.
    const reply = node({ 'data-chat-flow-kind': 'assistant-step', 'data-chat-group-part': 'response' });
    reply.textContent = 'Here is the answer';
    parent.append(reply);
    await deliver();
    context.mock.timers.tick(1000);
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Read a file, ran 2 commands',
      'the summary appears once the reply follows the run');
    assert.equal(toggle.hasAttribute('data-ccd-tool-live'), false);
    // A second run starts after the reply, so it owns its own disclosure.
    const again = call('bash', 'running'); again.row.textContent = 'Running again';
    parent.append(again.flow);
    await deliver();
    const last = parent.querySelectorAll('[data-ccd-tool-group-toggle]')[1]!;
    assert.equal(last.children[0]!.children[0]!.textContent, 'Running again');
    // A trailing thought is not a reply: it belongs to the same working turn.
    const thought = node({ 'data-chat-flow-kind': 'assistant-step', 'data-chat-group-part': 'reasoning' });
    thought.textContent = 'Thinking again';
    parent.append(thought);
    await deliver();
    assert.equal(last.children[0]!.children[0]!.textContent, 'Running again',
      'a trailing thought does not end the run');
    again.row.setAttribute('data-state', 'ok');
    await deliver();
    assert.equal(last.children[0]!.children[0]!.textContent, 'Running again',
      'the settled call keeps its line until the turn answers');
    // A response seat that only carries a thought has not answered the run.
    const thoughtSeat = node({ 'data-chat-flow-kind': 'assistant-step', 'data-chat-group-part': 'response' });
    const thoughtBlock = node({ 'data-variant': 'think', 'data-state': 'running' });
    thoughtBlock.textContent = 'Considering the next step';
    thoughtSeat.append(thoughtBlock);
    parent.append(thoughtSeat);
    await deliver();
    assert.equal(last.children[0]!.children[0]!.textContent, 'Running again',
      'a thought inside the reply seat is not body text');
    thoughtBlock.setAttribute('data-state', 'ok');
    const streamed = node({ 'data-streaming': '' });
    streamed.textContent = 'The answer';
    thoughtSeat.append(streamed);
    await deliver();
    context.mock.timers.tick(1000);
    assert.equal(last.children[0]!.children[0]!.textContent, 'Ran 1 command',
      'streamed body text outside the thought ends the run');
    assert.deepEqual(errors, []);
  } finally { release(); globalThis.MutationObserver = nativeObserver; }
});

test('a streaming thought after a call rolls in the same line instead of opening below it', async () => {
  const nativeObserver = globalThis.MutationObserver;
  let notify = (_records: MutationRecord[]) => {};
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  const body = node(), parent = node();
  body.connectedRoot = true; body.append(parent);
  body.append(node({ 'data-chat-running': '' }));
  const first = call('bash', 'ok'); first.row.textContent = 'Find composer references';
  const seat = node({ 'data-chat-flow-kind': 'assistant-step', 'data-chat-group-part': 'reasoning', 'data-chat-turn': '1' });
  const thought = node({ 'data-variant': 'think', 'data-state': 'running' });
  thought.textContent = 'Thinking';
  seat.append(thought);
  parent.append(first.flow, seat);
  const errors: unknown[] = [];
  const release = mountToolCallGroups({ body, createElement: () => node() } as unknown as Document,
    error => errors.push(error));
  const deliver = async () => {
    notify([{ target: parent, addedNodes: [], removedNodes: [], type: 'childList' }] as unknown as MutationRecord[]);
    await Promise.resolve();
  };
  try {
    const label = () => parent.querySelector('[data-ccd-tool-group-toggle]')!.children[0]!.children[0]!.textContent;
    assert.equal(parent.querySelectorAll('[data-ccd-tool-group-toggle]').length, 1);
    assert.equal(seat.getAttribute('data-ccd-tool-group-member'), 'closed', 'the thought folds into the run');
    assert.equal(label(), 'Thinking');
    thought.setAttribute('data-state', 'ok');
    await deliver();
    assert.equal(seat.getAttribute('data-ccd-tool-group-member'), 'closed');
    assert.equal(label(), 'Find composer references', 'a settled thought hands the line back to the call');
    // Some replies open with their thought inside the response seat.
    const reply = node({ 'data-chat-flow-kind': 'assistant-step', 'data-chat-group-part': 'response', 'data-chat-turn': '1' });
    const replyThought = node({ 'data-variant': 'think', 'data-state': 'running' });
    replyThought.textContent = 'Thinking';
    reply.append(replyThought);
    parent.append(reply);
    await deliver();
    assert.equal(reply.getAttribute('data-ccd-tool-group-member'), 'closed');
    assert.equal(label(), 'Thinking');
    const streamed = node({ 'data-streaming': '' });
    streamed.textContent = 'The answer';
    reply.append(streamed);
    await deliver();
    assert.equal(reply.hasAttribute('data-ccd-tool-group-member'), false, 'body text keeps the reply visible');
    assert.deepEqual(errors, []);
  } finally { release(); globalThis.MutationObserver = nativeObserver; }
});

test('removing the running row folds the last run into its summary', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const nativeObserver = globalThis.MutationObserver;
  let notify = (_records: MutationRecord[]) => {};
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  const body = node(), parent = node();
  body.connectedRoot = true; body.append(parent);
  const running = node({ 'data-chat-running': '' });
  body.append(running);
  const only = call('bash', 'running'); only.row.textContent = 'Still working';
  parent.append(only.flow);
  const errors: unknown[] = [];
  const release = mountToolCallGroups({ body, createElement: () => node() } as unknown as Document,
    error => errors.push(error));
  const deliver = async (record: Record<string, unknown> = {}) => {
    notify([{ target: parent, addedNodes: [], removedNodes: [], type: 'childList', ...record }] as unknown as MutationRecord[]);
    await Promise.resolve();
  };
  try {
    const toggle = parent.querySelector('[data-ccd-tool-group-toggle]')!;
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Still working');
    only.row.setAttribute('data-state', 'ok');
    await deliver({});
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Still working',
      'the working turn keeps its call on screen');
    // The host drops the running row when the turn closes.
    running.remove();
    await deliver({ target: body, removedNodes: [running] });
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Ran 1 command',
      'a closed turn summarises its last run');
    assert.equal(toggle.hasAttribute('data-ccd-tool-live'), false);
    assert.deepEqual(errors, []);
  } finally { release(); globalThis.MutationObserver = nativeObserver; }
});

test('a finished reply folds its run even while another transcript is still running', async () => {
  const nativeObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor(_callback: (records: MutationRecord[]) => void) {}
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  const body = node(), parent = node(), other = node();
  body.connectedRoot = true; body.append(parent, other);
  // A second mounted transcript keeps its own running row inside its list.
  other.append(node({ 'data-chat-running': '' }));
  const only = call('bash', 'ok'); only.row.textContent = 'Check client access';
  // The reply opened with a thought and has stopped streaming.
  const reply = node({ 'data-chat-flow-kind': 'assistant-step', 'data-chat-group-part': 'response', 'data-chat-turn': '1' });
  const thought = node({ 'data-variant': 'think', 'data-state': 'ok' });
  thought.textContent = 'Thought';
  const markdown = node();
  markdown.textContent = 'The answer';
  reply.append(thought, markdown);
  parent.append(only.flow, reply);
  const errors: unknown[] = [];
  const release = mountToolCallGroups({ body, createElement: () => node() } as unknown as Document,
    error => errors.push(error));
  try {
    const toggle = parent.querySelector('[data-ccd-tool-group-toggle]')!;
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Ran 1 command');
    assert.equal(toggle.hasAttribute('data-ccd-tool-live'), false);
    assert.deepEqual(errors, []);
  } finally { release(); globalThis.MutationObserver = nativeObserver; }
});

test('an interrupted thought left running stops rolling once the turn has ended', async () => {
  const nativeObserver = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor(_callback: (records: MutationRecord[]) => void) {}
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  const body = node(), parent = node();
  body.connectedRoot = true; body.append(parent);
  const only = call('bash', 'ok'); only.row.textContent = 'Check client access';
  // The user aborted mid-thought; the host never settled the reasoning row.
  const seat = node({ 'data-chat-flow-kind': 'assistant-step', 'data-chat-group-part': 'reasoning', 'data-chat-turn': '1' });
  const thought = node({ 'data-variant': 'think', 'data-state': 'running' });
  thought.textContent = 'Thinking';
  seat.append(thought);
  parent.append(only.flow, seat);
  const errors: unknown[] = [];
  const release = mountToolCallGroups({ body, createElement: () => node() } as unknown as Document,
    error => errors.push(error));
  try {
    const toggle = parent.querySelector('[data-ccd-tool-group-toggle]')!;
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Thought, ran a command');
    assert.equal(toggle.hasAttribute('data-ccd-tool-live'), false);
    assert.deepEqual(errors, []);
  } finally { release(); globalThis.MutationObserver = nativeObserver; }
});

test('a run inside a host step group folds once a reply follows the group', async () => {
  const nativeObserver = globalThis.MutationObserver;
  let notify = (_records: MutationRecord[]) => {};
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  const body = node(), list = node();
  body.connectedRoot = true; body.append(list);
  // ChatGroupSeat: root > body > content, with the calls inside the content.
  const group = node({ 'data-step-process': '' }), groupBody = node(), content = node();
  group.append(groupBody); groupBody.append(content);
  const only = call('bash', 'ok'); only.row.textContent = 'Count changed files';
  content.append(only.flow);
  const reply = node({ 'data-chat-flow-kind': 'assistant-step', 'data-chat-group-part': 'response', 'data-chat-turn': '1' });
  // The turn is still running.
  list.append(group, reply, node({ 'data-chat-running': '' }));
  const errors: unknown[] = [];
  const release = mountToolCallGroups({ body, createElement: () => node() } as unknown as Document,
    error => errors.push(error));
  try {
    const toggle = content.querySelector('[data-ccd-tool-group-toggle]')!;
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Count changed files', 'an empty reply seat has not answered yet');
    // Streaming text only reports the reply seat, which lives beside the group.
    reply.textContent = 'Typecheck passes.';
    notify([{ target: reply, addedNodes: [], removedNodes: [], type: 'characterData' }] as unknown as MutationRecord[]);
    await Promise.resolve();
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Ran 1 command');
    assert.equal(toggle.hasAttribute('data-ccd-tool-live'), false);
    assert.deepEqual(errors, []);
  } finally { release(); globalThis.MutationObserver = nativeObserver; }
});

test('file groups use native header metadata, update totals and restore titles without replacing controls', async () => {
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
  const file = call('write'), command = call();
  const header = node({ 'data-disclosure-row': '', 'aria-expanded': 'false' });
  const title = node({ class: 'host_title' }), link = node({ class: 'host_fileLink' });
  const added = node({ class: 'host_diffAdded' }), removed = node({ class: 'host_diffRemoved' });
  title.textContent = '写入'; link.textContent = 'test.txt';
  added.textContent = '+2'; removed.textContent = '-0';
  header.append(title, link, added, removed);
  file.row.append(header);
  parent.append(file.flow, command.flow);
  const errors: unknown[] = [];
  const dispose = mountToolCallGroups({ body, createElement: () => node() } as unknown as Document, error => errors.push(error));
  const deliver = async () => {
    notify([{ target: file.row, addedNodes: [] }] as unknown as MutationRecord[]);
    await Promise.resolve();
  };
  try {
    const toggle = parent.querySelector('[data-ccd-tool-group-toggle]')!;
    assert.equal(toggle.children[0]!.children[0]!.textContent, 'Wrote test.txt, Ran 1 command+2−0');
    assert.equal(file.row.querySelector('[data-ccd-file-action]')?.textContent, 'Wrote');
    assert.equal(title.textContent, '写入');
    assert.equal(title.getAttribute('data-ccd-file-title-source'), '');
    assert.equal(link.parentElement, header);
    toggle.click();
    assert.equal(header.getAttribute('aria-expanded'), 'false');
    added.textContent = '+15';
    await deliver();
    assert.ok(toggle.children[0]!.children[0]!.textContent.endsWith('+15−0'));
    assert.equal(file.row.querySelectorAll('[data-ccd-file-action]').length, 1);
    file.row.setAttribute('data-tool', 'edit');
    await deliver();
    assert.equal(file.row.querySelector('[data-ccd-file-action]')?.textContent, 'Edited');
    file.row.setAttribute('data-state', 'error');
    await deliver();
    assert.equal(file.row.hasAttribute('data-ccd-file-row'), false);
    assert.equal(title.hasAttribute('data-ccd-file-title-source'), false);
    assert.equal(file.row.querySelector('[data-ccd-file-action]'), null);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    file.row.setAttribute('data-state', 'ok');
    await deliver();
    assert.equal(file.row.hasAttribute('data-ccd-file-row'), true);
  } finally {
    dispose();
    globalThis.MutationObserver = nativeObserver;
  }
  assert.equal(title.hasAttribute('data-ccd-file-title-source'), false);
  assert.equal(file.row.hasAttribute('data-ccd-file-row'), false);
  assert.equal(link.parentElement, header);
  assert.deepEqual(errors, []);
});
