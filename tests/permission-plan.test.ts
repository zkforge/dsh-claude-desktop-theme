import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { permissionPlanPort } from '../src/client/compat/permission-plan-port.ts';
import { isPlanNotice } from '../src/client/compat/plan-notices.ts';
import { mountPermissionMenu } from '../src/client/compat/permission-menu.ts';

test('plan port folds pending targets and delegates to the real slash commands', async () => {
  const calls: unknown[][] = [];
  const values: { plan?: { active: boolean; pending?: boolean } } = {};
  let response: unknown = { ok: true, value: { result: { kind: 'success' } } };
  const port = permissionPlanPort({
    get: () => ({ commands: { execute: async (...args: unknown[]) => { calls.push(args); return response; } } }),
    sessions: { list: { getSnapshot: () => ({ projectionsBySession: { a: { values } } }), subscribe: () => () => {} } },
  } as unknown as Context);
  assert.equal(port.read('a'), null);
  values.plan = { active: false, pending: true };
  assert.deepEqual(port.read('a'), { active: true });
  values.plan = { active: true, pending: true };
  assert.deepEqual(port.read('a'), { active: false });
  values.plan = { active: true };
  assert.deepEqual(port.read('a'), { active: true });
  await port.set('a', true);
  await port.set('a', false);
  assert.deepEqual(calls, [['a', '/plan', []], ['a', '/plan off', []]]);
  response = { ok: true, value: { result: { kind: 'error', text: 'locked' } } };
  await assert.rejects(port.set('a', true), /locked/u);
  response = { ok: true };
  await assert.rejects(port.set('a', true), /unavailable/u);
  response = { ok: false, error: { message: 'disconnected' } };
  await assert.rejects(port.set('a', false), /disconnected/u);
});

for (const scenario of ['enter', 'leave', 'failure', 'switch', 'dispose', 'busy'] as const) {
  test(`plan menu command sequencing: ${scenario}`, async () => {
    const original = globalThis.MutationObserver;
    globalThis.MutationObserver = class { observe() {} disconnect() {} } as unknown as typeof MutationObserver;
    const listeners = new Map<string, (event: unknown) => void>();
    let session = 'a';
    let active = scenario !== 'enter';
    let nativeClicks = 0;
    let closes = 0;
    let finish!: () => void;
    let fail!: (reason: Error) => void;
    const calls: unknown[][] = [];
    const errors: unknown[] = [];
    const trigger = {
      querySelector: () => null,
      closest: () => ({ getAttribute: () => session }),
      setAttribute() {}, removeAttribute() {}, click() { closes += 1; },
    };
    const document = {
      documentElement: { lang: 'en' }, body: {},
      querySelector: (selector: string) => selector === '.wXeviG_trigger' ? trigger : null,
      addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name),
    } as unknown as Document;
    const row = {
      disabled: false, isConnected: scenario !== 'failure',
      getAttribute: (name: string) => name === 'data-ccd-permission-mode' ? scenario === 'enter' ? 'plan' : 'workspace-write' : null,
      click() { nativeClicks += 1; },
    };
    const event = { target: { closest: () => row }, preventDefault() {}, stopPropagation() {} };
    const dispose = mountPermissionMenu(document, error => errors.push(error), {
      read: () => ({ active }), subscribe: () => () => {},
      set: (id, enabled) => {
        calls.push([id, enabled]);
        return new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
      },
    });
    try {
      listeners.get('click')!(event);
      if (scenario === 'busy') listeners.get('click')!(event);
      assert.deepEqual(calls, [['a', scenario === 'enter']]);
      assert.equal(nativeClicks, 0, 'permission cannot change before /plan off succeeds');
      if (scenario === 'switch') session = 'b';
      if (scenario === 'dispose') dispose();
      if (scenario === 'failure') fail(new Error('rejected'));
      else { active = scenario === 'enter'; finish(); }
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(nativeClicks, scenario === 'leave' || scenario === 'busy' ? 1 : 0);
      assert.equal(closes, scenario === 'enter' ? 1 : 0);
      assert.equal(errors.length, scenario === 'failure' ? 1 : 0);
    } finally {
      dispose();
      globalThis.MutationObserver = original;
    }
    assert.equal(listeners.size, 0);
  });
}

test('plan notice recognition excludes task content and unrelated commands', () => {
  for (const text of ['planPlan mode on. Use /plan off to leave.', 'plan · Plan mode off.',
    'planEntering plan mode (applies from the next step). Use /plan off to leave.']) {
    assert.equal(isPlanNotice(text), true, text);
  }
  for (const text of ['Plan mode off.', 'compactPlan mode off.',
    'planMy implementation plan', 'planPlan mode off. Extra output']) {
    assert.equal(isPlanNotice(text), false, text);
  }
});

test('live plan face overrides stale catalog and notifies on model exit or slash commands', () => {
  let live: unknown = { active: true, pending: false };
  let onFace: (() => void) | undefined;
  let onList: (() => void) | undefined;
  let faceStopped = 0;
  let changes = 0;
  const face = {
    getSnapshot: () => live,
    subscribe: (listener: () => void) => { onFace = listener; return () => { faceStopped += 1; onFace = undefined; }; },
  };
  const port = permissionPlanPort({
    get: () => ({}),
    sessions: {
      binding: (id: string) => id === 'a' ? { session: { projections: { faceOf: () => face } } } : undefined,
      list: {
        getSnapshot: () => ({ projectionsBySession: { a: { values: { plan: { active: true } } } } }),
        subscribe: (listener: () => void) => { onList = listener; return () => { onList = undefined; }; },
      },
    },
  } as unknown as Context);
  assert.deepEqual(port.read('a'), { active: true });
  const stop = port.subscribe(() => { changes += 1; });
  live = { active: false, pending: false };
  onFace?.();
  assert.equal(changes, 1);
  assert.deepEqual(port.read('a'), { active: false }, 'model exit must override stale catalog');
  live = { active: false, pending: true };
  onFace?.();
  assert.deepEqual(port.read('a'), { active: true }, 'slash entry pending target');
  live = { active: true, pending: true };
  onFace?.();
  assert.deepEqual(port.read('a'), { active: false }, 'slash exit pending target');
  live = undefined;
  onFace?.();
  assert.equal(port.read('a'), null, 'absent live capability cannot fall back to stale active catalog');
  assert.equal(port.read('b'), null);
  assert.equal(faceStopped, 1, 'switching session disconnects old face');
  stop();
  assert.equal(onFace, undefined);
  assert.equal(onList, undefined);
});
