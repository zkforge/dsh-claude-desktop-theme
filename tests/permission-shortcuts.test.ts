import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountAgentPresetMenu, mountPermissionMenu } from '../src/client/compat/permission-menu.ts';

for (const [agent, withPlan] of [[false, false], [true, false], [false, true]]) test(`bare digits select ${agent ? 'Agent preset' : withPlan ? 'five mode' : 'permission'} rows only while the menu is open`, () => {
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
    querySelector: (selector: string) => selector === `[data-ccd-${agent ? 'agent' : 'permission'}-menu]` && open ? card : null,
    addEventListener(type: string, listener: typeof onKey) { if (type === 'keydown') onKey = listener; },
    removeEventListener(type: string, listener: typeof onKey) {
      if (type !== 'keydown') return;
      assert.equal(listener, onKey);
      onKey = undefined;
    },
  } as unknown as Document;
  const dispose = (agent ? mountAgentPresetMenu : mountPermissionMenu)(document, error => { throw error; },
    withPlan ? { read: () => null, set: async () => {}, subscribe: () => () => {} } : undefined);
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
    for (const key of withPlan ? ['1', '2', '3', '4', '5'] : ['1', '2', '3', '4']) assert.equal(press(key), true);
    assert.deepEqual(selected, (agent ? ['standard', 'ptc', 'minimal', 'cordis']
      : withPlan ? ['auto', 'read-only', 'workspace-write', 'plan', 'danger-full-access']
        : ['auto', 'read-only', 'workspace-write', 'danger-full-access'])
      .map(value => `[data-ccd-${agent ? 'agent' : 'permission'}-mode="${value}"]`));
    for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true },
      { shiftKey: true }, { repeat: true }, { isComposing: true },
      { target: { closest: () => ({}) } }]) assert.equal(press('1', extra), false);
    assert.equal(press(withPlan ? '6' : '5'), false);
    disabled = true;
    assert.equal(press('1'), false);
    assert.equal(selected.length, withPlan ? 5 : 4);
  } finally {
    dispose();
    globalThis.MutationObserver = original;
  }
  assert.equal(onKey, undefined, 'release removes the keyboard handler');
});
