import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountReplySignature, REPLY_SIGNATURE_SEAT } from '../src/client/compat/reply-signature.ts';

test('signature follows only the latest settled reply and cancels interaction on removal', async () => {
  const previous = globalThis.MutationObserver;
  let notify = () => {};
  let disconnected = false;
  globalThis.MutationObserver = class {
    constructor(callback: () => void) { notify = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  } as unknown as typeof MutationObserver;
  let plays = 0;
  let cancels = 0;
  let reduced = false;
  const buttons: ReturnType<typeof makeButton>[] = [];
  const makeButton = () => ({
    type: '', className: '', title: '', label: '',
    parentElement: null as unknown,
    onclick: null as (() => void) | null,
    setAttribute(name: string, value: string) { assert.equal(name, 'aria-label'); this.label = value; },
    remove() { this.parentElement = null; },
    animate() { plays++; return { cancel() { cancels++; } }; },
  });
  const makeSeat = () => ({ append(button: ReturnType<typeof makeButton>) { button.parentElement = this; } });
  const first = makeSeat();
  let seat: ReturnType<typeof makeSeat> | null = first;
  const doc = {
    documentElement: { lang: 'zh-CN' },
    defaultView: { matchMedia() { return { matches: reduced }; } },
    querySelector(selector: string) { assert.equal(selector, REPLY_SIGNATURE_SEAT); return seat; },
    createElement(tag: string) { assert.equal(tag, 'button'); const button = makeButton(); buttons.push(button); return button; },
  };
  const errors: unknown[] = [];
  let dispose = () => {};
  try {
    dispose = mountReplySignature(doc as unknown as Document, error => errors.push(error));
    const button = buttons[0]!;
    assert.equal(button.parentElement, first);
    assert.equal(button.label, '晃晃鲸鱼尾巴');
    button.onclick!();
    button.onclick!();
    assert.equal(plays, 2, 'repeated clicks restart the wiggle');
    assert.equal(cancels, 1);
    notify();
    await Promise.resolve();
    assert.equal(buttons.length, 1, 'unrelated DOM updates preserve the button');
    seat = null; // Host clears always-revealed state as the next turn begins.
    notify();
    await Promise.resolve();
    assert.equal(button.parentElement, null);
    assert.equal(button.onclick, null);
    assert.equal(cancels, 2);
    seat = makeSeat(); // The next reply has completed.
    notify();
    await Promise.resolve();
    const next = buttons[1]!;
    assert.equal(next.parentElement, seat);
    reduced = true;
    next.onclick!();
    assert.equal(plays, 2, 'reduced motion suppresses rotation');
    doc.documentElement.lang = 'en';
    notify();
    await Promise.resolve();
    assert.equal(next.label, 'Wiggle the whale tail');
    notify();
    dispose();
    await Promise.resolve();
    assert.equal(next.parentElement, null);
    assert.equal(next.onclick, null);
    assert.ok(disconnected);
    assert.equal(buttons.length, 2, 'queued sync cannot recreate a disposed button');
    assert.deepEqual(errors, []);
  } finally {
    dispose();
    globalThis.MutationObserver = previous;
  }
});
