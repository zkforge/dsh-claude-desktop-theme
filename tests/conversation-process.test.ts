import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountConversationProcess } from '../src/client/compat/conversation-process.ts';
import { ANCHOR } from '../src/client/compat/host-dom.ts';

test('process containers reopen after settlement and replacement without stealing input focus', async () => {
  const previous = globalThis.MutationObserver;
  let notify = () => {};
  let disconnected = false;
  globalThis.MutationObserver = class {
    constructor(callback: () => void) { notify = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  } as unknown as typeof MutationObserver;
  const errors: unknown[] = [];
  let focusOptions: FocusOptions | undefined;
  const composer = {
    isConnected: true,
    focus(options: FocusOptions) { focusOptions = options; doc.activeElement = composer; },
  };
  const makeButton = (expanded = 'false', disabled = false) => ({
    expanded, disabled, clicks: 0,
    getAttribute() { return this.expanded; },
    click() { this.clicks++; this.expanded = 'true'; doc.activeElement = this; },
    blur() { doc.activeElement = null; },
  });
  const turn = makeButton();
  const step = makeButton();
  const disabled = makeButton('false', true);
  let buttons = [turn, step, disabled];
  const doc = {
    body: {},
    activeElement: composer as unknown,
    querySelectorAll(selector: string) {
      assert.equal(selector, `${ANCHOR.turnProcess}, ${ANCHOR.stepProcessToggle}`);
      return buttons;
    },
  };
  let dispose = () => {};
  try {
    dispose = mountConversationProcess(doc as unknown as Document, error => errors.push(error));
    assert.equal(turn.clicks, 1);
    assert.equal(step.clicks, 1);
    assert.equal(disabled.clicks, 0);
    assert.equal(doc.activeElement, composer);
    assert.deepEqual(focusOptions, { preventScroll: true });
    notify();
    await Promise.resolve();
    assert.equal(turn.clicks, 1, 'expanded containers must not be toggled closed');
    turn.expanded = 'false'; // Host folds the turn when the response finishes.
    notify();
    notify();
    await Promise.resolve();
    assert.equal(turn.clicks, 2);
    const replacement = makeButton();
    buttons = [replacement];
    notify();
    await Promise.resolve();
    assert.equal(replacement.clicks, 1, 'new session/history containers are expanded');
    replacement.expanded = 'false';
    notify();
    dispose();
    await Promise.resolve();
    assert.equal(replacement.clicks, 1, 'queued work stops on feature disable');
    assert.ok(disconnected);
    assert.deepEqual(errors, []);
  } finally {
    dispose();
    globalThis.MutationObserver = previous;
  }
});
