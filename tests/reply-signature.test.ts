import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountReplySignature, REPLY_SIGNATURE_SEAT } from '../src/client/compat/reply-signature.ts';

for (const style of ['whale', 'claude'] as const) {
  test(`${style} signature follows only the latest settled reply and stays decorative and is cleaned up on removal`, async () => {
    const previous = globalThis.MutationObserver;
    let notify = () => {};
    let disconnected = false;
    globalThis.MutationObserver = class {
      constructor(callback: () => void) { notify = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    } as unknown as typeof MutationObserver;
    const buttons: ReturnType<typeof makeButton>[] = [];
    const makeButton = () => ({
      className: '', hidden: '',
      parentElement: null as unknown,
      setAttribute(name: string, value: string) { assert.equal(name, 'aria-hidden'); this.hidden = value; },
      remove() { this.parentElement = null; },
    });
    const makeSeat = () => ({ append(button: ReturnType<typeof makeButton>) { button.parentElement = this; } });
    const first = makeSeat();
    let seat: ReturnType<typeof makeSeat> | null = first;
    const doc = {
      documentElement: { lang: 'zh-CN' },
      querySelector(selector: string) { assert.equal(selector, REPLY_SIGNATURE_SEAT); return seat; },
      createElement(tag: string) { assert.equal(tag, 'span'); const button = makeButton(); buttons.push(button); return button; },
    };
    const errors: unknown[] = [];
    let dispose = () => {};
    try {
      dispose = mountReplySignature(doc as unknown as Document, error => errors.push(error), style);
      const button = buttons[0]!;
      assert.equal(button.parentElement, first);
      assert.equal(button.hidden, 'true');
      assert.equal('onclick' in button, false);
      assert.equal('tabIndex' in button, false);
      assert.ok(button.className.includes(`ccd-reply-signature-${style}`));
      notify();
      await Promise.resolve();
      assert.equal(buttons.length, 1, 'unrelated DOM updates preserve the button');
      seat = null; // Host clears always-revealed state as the next turn begins.
      notify();
      await Promise.resolve();
      assert.equal(button.parentElement, null);
      seat = makeSeat(); // The next reply has completed.
      notify();
      await Promise.resolve();
      const next = buttons[1]!;
      assert.equal(next.parentElement, seat);
      notify();
      dispose();
      await Promise.resolve();
      assert.equal(next.parentElement, null);
      assert.ok(disconnected);
      assert.equal(buttons.length, 2, 'queued sync cannot recreate a disposed button');
      assert.deepEqual(errors, []);
    } finally {
      dispose();
      globalThis.MutationObserver = previous;
    }
  });
}
