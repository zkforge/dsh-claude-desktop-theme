import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountPermissionMenu } from '../src/client/compat/permission-menu.ts';

test('bare digits select native permission rows only while the menu is open', () => {
  const original = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;
  let onKey: ((event: KeyboardEvent) => void) | undefined;
  let open = false;
  let disabled = false;
  const selected: string[] = [];
  const card = {
    querySelector(selector: string) {
      return { disabled, getAttribute: () => null, click: () => selected.push(selector) };
    },
  };
  const document = {
    documentElement: { lang: 'en' }, body: {},
    querySelector: (selector: string) => selector === '[data-ccd-permission-menu]' && open ? card : null,
    addEventListener(_type: string, listener: typeof onKey) { onKey = listener; },
    removeEventListener(_type: string, listener: typeof onKey) {
      assert.equal(listener, onKey);
      onKey = undefined;
    },
  } as unknown as Document;
  const dispose = mountPermissionMenu(document, error => { throw error; });
  const press = (key: string, extra: Record<string, unknown> = {}) => {
    let prevented = false;
    const event = {
      key, target: null, preventDefault() { prevented = true; }, stopPropagation() {}, ...extra,
    } as unknown as KeyboardEvent;
    onKey?.(event);
    return prevented;
  };
  try {
    assert.equal(press('1'), false);
    open = true;
    for (const key of ['1', '2', '3', '4']) assert.equal(press(key), true);
    assert.deepEqual(selected, ['read-only', 'workspace-write', 'danger-full-access', 'auto']
      .map(value => `[data-ccd-permission-mode="${value}"]`));
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true },
      { shiftKey: true }, { repeat: true }, { isComposing: true },
      { target: { closest: () => ({}) } }]) assert.equal(press('1', extra), false);
    assert.equal(press('5'), false);
    disabled = true;
    assert.equal(press('1'), false);
    assert.equal(selected.length, 4);
  } finally {
    dispose();
    globalThis.MutationObserver = original;
  }
  assert.equal(onKey, undefined, 'release removes the keyboard handler');
});
