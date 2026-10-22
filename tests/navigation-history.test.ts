import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { createNavigationHistory, type NavigationTarget } from '../src/client/compat/navigation-history.ts';
import { navigationHistoryPort } from '../src/client/compat/navigation-history-port.ts';

const session = (id: string): NavigationTarget => ({ kind: 'session', id });
const panel = (id: string): NavigationTarget => ({ kind: 'panel', id });

function fixture() {
  let current: NavigationTarget | null = session('a');
  let notify = () => {};
  const unavailable = new Set<string>();
  const errors: unknown[] = [];
  const opened: NavigationTarget[] = [];
  let fail = false;
  let changes = 0;
  const history = createNavigationHistory({
    current: () => current,
    available: target => !unavailable.has(target.id),
    open(target) {
      if (fail) throw new Error('panel removed');
      // Emulate retain/release and panel updates within one navigation.
      current = null; notify(); current = target; notify(); opened.push(target);
    },
    subscribe(listener) { notify = listener; return () => { notify = () => {}; }; },
  }, () => { changes += 1; }, error => errors.push(error));
  return {
    history, unavailable, opened, errors,
    current: () => current,
    changes: () => changes,
    fail: () => { fail = true; },
    async visit(target: NavigationTarget | null) { current = target; notify(); await Promise.resolve(); },
    async refresh() { notify(); await Promise.resolve(); },
  };
}

test('back/forward visits and a new branch discard only the forward stack', async () => {
  const f = fixture();
  assert.equal(f.history.canGo(-1), false);
  await f.visit(session('b')); await f.visit(session('c'));
  f.history.go(-1); assert.deepEqual(f.current(), session('b'));
  f.history.go(-1); assert.deepEqual(f.current(), session('a'));
  assert.equal(f.history.canGo(-1), false);
  f.history.go(1); assert.deepEqual(f.current(), session('b'));
  await f.visit(session('d'));
  assert.equal(f.history.canGo(1), false);
  f.history.go(-1); assert.deepEqual(f.current(), session('b'));
  f.history.dispose();
});

test('global pages and repeat visits retain their position; updates do not create visits', async () => {
  const f = fixture();
  await f.visit(panel('plugins')); await f.visit(panel('schedule')); await f.visit(session('a'));
  await f.refresh(); await f.refresh();
  f.history.go(-1); assert.deepEqual(f.current(), panel('schedule'));
  f.history.go(-1); assert.deepEqual(f.current(), panel('plugins'));
  f.history.go(-1); assert.deepEqual(f.current(), session('a'));
  assert.equal(f.history.canGo(-1), false);
  f.history.go(1); assert.deepEqual(f.current(), panel('plugins'));
  f.history.dispose();
});

test('removed visits are pruned and clearing the active session still goes back to the nearest survivor', async () => {
  const f = fixture();
  await f.visit(session('b')); await f.visit(session('c'));
  f.unavailable.add('c');
  await f.visit(null);
  f.history.go(-1); assert.deepEqual(f.current(), session('b'));
  assert.equal(f.history.canGo(1), false);
  f.unavailable.add('a'); await f.refresh();
  assert.equal(f.history.canGo(-1), false);
  f.history.dispose();
});

test('a removed global panel is discarded on failure without moving the active visit', async () => {
  const f = fixture();
  await f.visit(panel('plugins')); await f.visit(session('b'));
  f.fail(); f.history.go(-1);
  assert.deepEqual(f.current(), session('b'));
  assert.equal(f.errors.length, 1);
  assert.equal(f.history.canGo(1), false);
  assert.equal(f.history.canGo(-1), true);
  f.history.dispose();
});

test('notifications coalesce and a queued notification cannot run after disposal', async () => {
  const f = fixture();
  const transient = f.visit(session('temporary'));
  const final = f.visit(session('b'));
  await Promise.all([transient, final]);
  f.history.go(-1); assert.deepEqual(f.current(), session('a'));
  assert.equal(f.history.canGo(-1), false);
  const pending = f.visit(session('c'));
  f.history.dispose(); const changes = f.changes();
  await pending;
  assert.equal(f.changes(), changes);
  assert.equal(f.history.canGo(-1), false);
});

test('the stack bounds retained history to 100 visits', async () => {
  const f = fixture();
  for (let i = 0; i < 110; i += 1) await f.visit(session(String(i)));
  let count = 0;
  while (f.history.canGo(-1)) { f.history.go(-1); count += 1; }
  assert.equal(count, 99);
  assert.deepEqual(f.current(), session('10'));
  f.history.dispose();
});

test('host port uses authoritative selection, skips archived targets and cancels pending navigation', () => {
  let panelId: string | null = null;
  let phase = 'ready';
  const listeners = new Set<() => void>();
  let releases = 0;
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { releases += 1; }; };
  const calls: unknown[] = [];
  const address = { sessionId: 'child', parentSessionId: 'a' };
  const port = navigationHistoryPort({
    sessions: {
      list: { getSnapshot: () => ({ phase, byId: { a: { id: 'a', retainedBy: { mainView: 1 } } } }), subscribe },
      subagentAddress: () => address,
    },
    workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: ['archived'] }), subscribe } },
    layout: {
      panelInfo: { getSnapshot: () => ({ activePanelId: panelId }), subscribe },
      beginNavigation: () => { calls.push('cancel'); },
      selectPanel: (id: string) => { calls.push(id); },
    },
    uiWorkspace: { openSession: (target: unknown) => { calls.push(target); } },
  } as unknown as Context);
  assert.deepEqual(port.current(), session('a'));
  panelId = 'plugins'; assert.deepEqual(port.current(), panel('plugins'));
  assert.equal(port.available(session('a')), true);
  assert.equal(port.available(session('missing')), false);
  assert.equal(port.available(session('archived')), false);
  phase = 'loading'; assert.equal(port.available(session('missing')), true);
  port.open(session('child')); port.open(panel('schedule'));
  assert.deepEqual(calls, ['cancel', address, 'cancel', 'schedule']);
  const off = port.subscribe(() => {}); off(); assert.equal(releases, 3);
});
