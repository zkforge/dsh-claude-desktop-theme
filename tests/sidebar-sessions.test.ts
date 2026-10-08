import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { createSidebarSessionsPort } from '../src/client/compat/adapter.ts';

function fixture() {
  const sessions = {
    phase: 'ready', ids: ['live', 'archive', 'blank', 'agent'],
    byId: {
      live: { blank: false }, archive: { blank: false },
      blank: { blank: true, retainedBy: { mainView: 1 } },
      agent: { blank: false, origin: 'subagent' },
    },
  };
  const workspaces = {
    phase: 'ready', archivedSessionIds: ['archive'],
    items: [
      { workspaceId: 'parent', path: '/code', sessionIds: [] },
      { workspaceId: 'live', path: '/code/live', sessionIds: ['live'] },
      { workspaceId: 'archive', path: '/archive', sessionIds: ['archive'] },
      { workspaceId: 'empty', path: '/empty', sessionIds: ['blank', 'agent'] },
      { workspaceId: 'similar', path: '/cod', sessionIds: [] },
    ],
  };
  const listeners = [new Set<() => void>(), new Set<() => void>()];
  const store = (snapshot: unknown, index: number) => ({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners[index]!.add(listener);
      return () => { listeners[index]!.delete(listener); };
    },
  });
  const ctx = { sessions: { list: store(sessions, 0) }, workspaces: { list: store(workspaces, 1) } } as unknown as Context;
  const port = createSidebarSessionsPort(ctx)!;
  return { sessions, workspaces, listeners, port };
}

test('collapsed membership follows Active, All and Archived while excluding provisional roots', () => {
  const { port } = fixture();
  assert.deepEqual([...port.populatedGroups(0, false)!], ['live']);
  assert.deepEqual([...port.populatedGroups(1, false)!], ['live', 'archive']);
  assert.deepEqual([...port.populatedGroups(2, false)!], ['archive']);
  assert.deepEqual([...port.populatedGroups(null, false)!], ['live', 'archive']);
});

test('tree mode keeps actual ancestors, with directory boundaries on macOS and Windows', () => {
  const { port, workspaces } = fixture();
  assert.deepEqual([...port.populatedGroups(0, true)!], ['live', 'parent']);
  workspaces.items[0]!.path = 'C:\\code';
  workspaces.items[1]!.path = 'C:\\code\\live';
  assert.deepEqual([...port.populatedGroups(0, true)!], ['live', 'parent']);
});

test('pending catalogs preserve unknown groups and both subscriptions release', () => {
  const { port, workspaces, sessions, listeners } = fixture();
  sessions.phase = 'pending';
  assert.equal(port.hasHistory(), null);
  assert.equal(port.populatedGroups(0, false), null);
  sessions.phase = 'ready'; workspaces.phase = 'pending';
  assert.equal(port.populatedGroups(0, false), null);
  let calls = 0;
  const off = port.subscribe(() => { calls += 1; });
  for (const source of listeners) for (const notify of source) notify();
  assert.equal(calls, 2);
  off();
  assert.deepEqual(listeners.map(source => source.size), [0, 0]);
});

test('history includes ungrouped and archived sessions but excludes provisional roots and subagents', () => {
  const { port, sessions, workspaces } = fixture();
  assert.equal(port.hasHistory(), true);
  workspaces.items = [];
  assert.deepEqual([...port.populatedGroups(0, false)!], ['']);
  assert.deepEqual([...port.populatedGroups(2, false)!], ['']);
  sessions.ids = ['blank', 'agent'];
  assert.equal(port.hasHistory(), false);
  assert.deepEqual([...port.populatedGroups(null, false)!], []);
});
