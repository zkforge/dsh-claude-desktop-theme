import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountPermissionConfirmation } from '../src/client/compat/permission-confirmation.ts';

for (const title of ['确认启用自动审查（实验）？', 'Enable Full access?', 'An unrelated risk dialog']) {
  test(`permission acknowledgement lifecycle: ${title}`, () => {
    const original = globalThis.MutationObserver;
    let update = () => {};
    let disconnected = false;
    globalThis.MutationObserver = class {
      constructor(callback: () => void) { update = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    } as unknown as typeof MutationObserver;
    let hidden = false;
    let clicks = 0;
    let focused = false;
    let confirmClicks = 0;
    const confirm = { disabled: true, click() { confirmClicks += 1; } };
    const input = {
      isConnected: true, checked: false, disabled: true,
      click() { clicks += 1; this.checked = !this.checked; },
    };
    const cancel = { focus() { focused = true; } };
    const label = {
      isConnected: true,
      querySelector: () => input,
      setAttribute() { hidden = true; },
      removeAttribute() { hidden = false; },
    };
    const dialog = {
      getAttribute: () => title,
      querySelector(selector: string) {
        if (selector.includes('acknowledgement')) return label;
        if (selector.includes('confirmAction')) return confirm;
        if (selector.includes('modalAction')) return cancel;
        return null;
      },
    };
    const document = {
      documentElement: { dataset: {} }, body: {}, activeElement: input,
      querySelector: () => null,
      querySelectorAll: () => [dialog],
    } as unknown as Document;
    try {
      const dispose = mountPermissionConfirmation(document, error => { throw error; });
      assert.equal(clicks, 0, 'disabled native controls are preserved');
      input.disabled = false;
      update();
      const matches = title !== 'An unrelated risk dialog';
      assert.equal(clicks, matches ? 1 : 0);
      assert.equal(hidden, false, 'keep the checkbox visible until React enables confirmation');
      confirm.disabled = false;
      update();
      update();
      assert.equal(clicks, matches ? 1 : 0, 'repeated mutations do not toggle acknowledgement again');
      assert.equal(hidden, matches);
      assert.equal(focused, matches, 'focus moves from the hidden checkbox to Cancel');
      assert.equal(confirmClicks, 0, 'the final action requires an explicit user click');
      dispose();
      assert.equal(disconnected, true);
      assert.equal(hidden, false);
      assert.equal(input.checked, false, 'disabling the plugin restores the acknowledgement');
    } finally {
      globalThis.MutationObserver = original;
    }
  });
}
