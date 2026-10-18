import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountConversationProcess } from '../src/client/compat/conversation-process.ts';
import { ANCHOR } from '../src/client/compat/host-dom.ts';

/*
 * The transcript keeps every settled turn in the DOM. The module therefore
 * reads the observer's records instead of sweeping the document: an inserted
 * container is searched once, an attribute record names the one disclosure the
 * host folded, and a batch that concerns neither costs a predicate. These tests
 * deliver the records a browser would, and count what each batch costs.
 */

const SELECTOR = `${ANCHOR.turnProcess}, ${ANCHOR.stepProcessToggle}`;

/** One disclosure button, with the host's own attributes and click handler. */
function makeButton(expanded = 'false', disabled = false) {
  const button = {
    expanded, disabled, clicks: 0, nodeType: 1,
    getAttribute(name: string) { return name === 'aria-expanded' ? this.expanded : null; },
    /* A turn/step disclosure answers to the module's selector list. */
    matches(selector: string) { return selector === SELECTOR; },
    querySelectorAll() { return []; },
    click() { this.clicks += 1; this.expanded = 'true'; doc.activeElement = this; },
    blur() { doc.activeElement = null; },
  };
  return button;
}

/** A node that is not a disclosure (a paragraph, a tool card, a text node). */
function makePlain(nodeType = 1) {
  return { nodeType, matches: () => false, querySelectorAll: () => [] };
}

let doc: {
  body: unknown;
  activeElement: unknown;
  querySelectorAll(selector: string): unknown[];
};
let scans = 0;

/** A record as the observer delivers it. */
const attributeRecord = (target: unknown): MutationRecord =>
  ({ type: 'attributes', target, addedNodes: [] }) as unknown as MutationRecord;
const insertionRecord = (...nodes: unknown[]): MutationRecord =>
  ({ type: 'childList', target: {}, addedNodes: nodes }) as unknown as MutationRecord;

function fixture(buttons: unknown[]) {
  let notify: (records: MutationRecord[]) => void = () => {};
  let disconnected = false;
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { notify = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  } as unknown as typeof MutationObserver;

  const errors: unknown[] = [];
  let focusOptions: FocusOptions | undefined;
  const composer = {
    isConnected: true,
    focus(options: FocusOptions) { focusOptions = options; doc.activeElement = composer; },
  };
  scans = 0;
  doc = {
    body: {},
    activeElement: composer,
    querySelectorAll(selector: string) {
      assert.equal(selector, SELECTOR);
      scans += 1;
      return buttons;
    },
  };
  const dispose = mountConversationProcess(doc as unknown as Document, error => errors.push(error));
  return {
    dispose, errors, composer,
    get disconnected() { return disconnected; },
    get focusOptions() { return focusOptions; },
    get scans() { return scans; },
    deliver: (...records: MutationRecord[]) => notify(records),
    /** Wait for the queued pass (one microtask) to run. */
    settle: () => Promise.resolve(),
  };
}

test('process containers reopen after settlement and replacement without stealing input focus', async () => {
  const turn = makeButton();
  const step = makeButton();
  const disabled = makeButton('false', true);
  const f = fixture([turn, step, disabled]);
  try {
    /* The mount's own pass: whatever history is already on screen. */
    assert.equal(turn.clicks, 1);
    assert.equal(step.clicks, 1);
    assert.equal(disabled.clicks, 0);
    assert.equal(doc.activeElement, f.composer);
    assert.deepEqual(f.focusOptions, { preventScroll: true });

    /* A settled transcript batch concerns no disclosure. */
    f.deliver(insertionRecord(makePlain()));
    await f.settle();
    assert.equal(turn.clicks, 1, 'expanded containers must not be toggled closed');

    /* The host folds the finished turn: its attribute record names it. */
    turn.expanded = 'false';
    f.deliver(attributeRecord(turn));
    await f.settle();
    assert.equal(turn.clicks, 2);
    /* A second delivery in the same batch must not toggle it back. */
    f.deliver(attributeRecord(turn));
    await f.settle();
    assert.equal(turn.clicks, 2);

    /* A new session/history container arrives as an inserted node. */
    const replacement = makeButton();
    f.deliver(insertionRecord(replacement));
    await f.settle();
    assert.equal(replacement.clicks, 1, 'new session/history containers are expanded');

    replacement.expanded = 'false';
    f.deliver(attributeRecord(replacement));
    f.dispose();
    await f.settle();
    assert.equal(replacement.clicks, 1, 'queued work stops on feature disable');
    assert.ok(f.disconnected);
    assert.deepEqual(f.errors, []);
  } finally {
    f.dispose();
  }
});

test('a batch of unrelated mutations reads no disclosure and clicks nothing', async () => {
  const turn = makeButton('true');
  const f = fixture([turn]);
  try {
    const mountScans = f.scans;
    /* Attributes on elements that are not disclosures, and inserted nodes that
       carry none in their subtree: the batch names nothing to open. */
    f.deliver(
      attributeRecord(makePlain()),
      attributeRecord(makePlain()),
      insertionRecord(makePlain(), makePlain(3)),
    );
    await f.settle();
    assert.equal(turn.clicks, 0);
    assert.equal(f.scans, mountScans, 'the document is never swept after mount');
    assert.deepEqual(f.errors, []);
  } finally {
    f.dispose();
  }
});

test('a batch of already-expanded disclosures clicks none of them', async () => {
  const settled = [makeButton('true'), makeButton('true')];
  const f = fixture(settled);
  try {
    f.deliver(insertionRecord(...settled));
    await f.settle();
    assert.deepEqual(settled.map(button => button.clicks), [0, 0]);
    assert.deepEqual(f.errors, []);
  } finally {
    f.dispose();
  }
});

test('mixed menu and transcript mutations only click actual process disclosures', async () => {
  const menu = makeButton();
  menu.matches = () => false;
  const turn = makeButton();
  const f = fixture([]);
  try {
    // Closing one view-options row and inserting the next flyout arrive in
    // the same batch. The insertion must not make that menu row clickable.
    f.deliver(attributeRecord(menu), insertionRecord(makePlain()));
    await f.settle();
    assert.equal(menu.clicks, 0);

    // A real disclosure also makes a batch relevant. Unrelated attribute
    // records still need their own selector check in the direct pending path.
    f.deliver(insertionRecord(makePlain()));
    f.deliver(attributeRecord(menu), attributeRecord(turn));
    assert.equal(menu.clicks, 0);
    assert.equal(turn.clicks, 1);
    await f.settle();
    assert.deepEqual(f.errors, []);
  } finally {
    f.dispose();
  }
});

test('a frame that cannot observe reports once and touches no disclosure', () => {
  const previous = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor() {}
    observe() { throw new Error('no observers in this frame'); }
    disconnect() {}
  } as unknown as typeof MutationObserver;
  const turn = makeButton();
  const errors: unknown[] = [];
  try {
    const dispose = mountConversationProcess({
      body: {},
      activeElement: null,
      querySelectorAll: () => [turn],
    } as unknown as Document, error => errors.push(error));
    assert.equal(errors.length, 1);
    assert.equal(turn.clicks, 0, 'the mount did not claim the disclosures');
    dispose();
  } finally {
    globalThis.MutationObserver = previous;
  }
});

test('a replacement delivered while a pass is already queued is not dropped', async () => {
  const turn = makeButton('true');
  const f = fixture([turn]);
  try {
    /* One batch queued the pass; the next arrives before it runs. A `pending`
       flag alone would discard the replacement container it carries. */
    f.deliver(attributeRecord(makePlain()));
    const replacement = makeButton();
    f.deliver(insertionRecord(replacement));
    assert.equal(replacement.clicks, 1, 'the late batch runs directly');
    await f.settle();
    assert.equal(replacement.clicks, 1, 'and is not replayed by the queued pass');
    assert.deepEqual(f.errors, []);
  } finally {
    f.dispose();
  }
});
