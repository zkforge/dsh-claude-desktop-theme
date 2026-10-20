import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adoptConfig, resolveConfig } from '../src/shared/config.ts';
import { mountRunningStatus, runningDuration, runningPhase } from '../src/client/compat/running-status.ts';

test('running presentation is independent, defaults to Claude and validates stored choices', () => {
  assert.equal(adoptConfig({}).personalization.runningStyle, 'claude');
  assert.equal(resolveConfig({ personalization: { runningStyle: 'claude' } }).personalization.runningStyle, 'claude');
  assert.equal(adoptConfig({ personalization: { runningStyle: 'bad' } }).personalization.runningStyle, 'claude');
  assert.throws(() => resolveConfig({ personalization: { runningStyle: 'bad' } }), /runningStyle/);
  assert.doesNotThrow(() => mountRunningStatus({} as Document, 'whale', () => {} )());
});

test('native elapsed time survives English, Chinese, compound units and unknown labels', () => {
  assert.equal(runningDuration('Deep diving for 12s ···'), '12s');
  assert.equal(runningDuration('深度求索中，用时 1分 23秒 ···'), '1分 23秒');
  assert.equal(runningDuration('Deep diving for 2m 3s ···'), '2m 3s');
  assert.equal(runningDuration('Deep diving'), '');
});

test('approval and live tools take precedence; reasoning and actual streamed text are distinct', () => {
  let approval = false, tool = false, thought = false, text = '';
  const root = {
    querySelector(selector: string) {
      return selector.includes('awaiting-approval') ? approval : selector.includes('tool-call') ? tool : thought;
    },
    querySelectorAll() { return [{ closest: () => null, textContent: text }]; },
  } as unknown as Element;
  assert.equal(runningPhase(root), 'waiting');
  text = '  ';
  assert.equal(runningPhase(root), 'waiting');
  text = 'Hello';
  assert.equal(runningPhase(root), 'responding');
  thought = true;
  assert.equal(runningPhase(root), 'thinking');
  tool = true;
  assert.equal(runningPhase(root), 'tool');
  approval = true;
  assert.equal(runningPhase(root), 'approval');
});

test('presentation follows native clock ticks without replacing native nodes and cleans up', async () => {
  class Node {
    nodeType = 1;
    className = '';
    textContent = '';
    isConnected = true;
    parentElement: Node | null = null;
    children: Node[] = [];
    attrs = new Map<string, string>();
    append(...nodes: Node[]) { nodes.forEach(node => { node.parentElement = this; this.children.push(node); }); }
    setAttribute(name: string, value: string) { this.attrs.set(name, value); }
    removeAttribute(name: string) { this.attrs.delete(name); }
    closest() { return null; }
    querySelector(selector: string) { return selector === 'svg' && this === native ? {} : null; }
    querySelectorAll() { return []; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
  }
  const nativeObserver = globalThis.MutationObserver;
  let notify = (_records: MutationRecord[]) => {};
  let disconnected = false;
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  } as unknown as typeof MutationObserver;
  const seat = new Node(), native = new Node(), root = new Node();
  root.append(seat); seat.append(native);
  native.textContent = 'Deep diving for 2s ···';
  const errors: unknown[] = [];
  const document = { body: root, createElement: () => new Node(), querySelectorAll: () => seat.isConnected ? [seat] : [] } as unknown as Document;
  try {
    const release = mountRunningStatus(document, 'claude', error => errors.push(error));
    const view = seat.children[1]!;
    assert.equal(view.children[1]?.textContent, '2s · ');
    assert.equal(view.children[2]?.textContent, 'Waiting for Claude…');
    native.textContent = 'Deep diving for 3s ···';
    notify([{ target: native }] as unknown as MutationRecord[]);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    assert.equal(seat.children[0], native);
    assert.equal(seat.children[1], view);
    assert.equal(view.children[1]?.textContent, '3s · ');
    seat.isConnected = false;
    notify([{ target: root }] as unknown as MutationRecord[]);
    await new Promise<void>(resolve => queueMicrotask(resolve));
    assert.deepEqual(seat.children, [native]);
    assert.equal(seat.attrs.has('data-ccd-running-style'), false);
    release();
    assert.equal(disconnected, true);
    assert.deepEqual(errors, []);
  } finally { globalThis.MutationObserver = nativeObserver; }
});
