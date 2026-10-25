import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { mountMoreCardRows, sidebarPanelsPort } from '../src/client/compat/sidebar-panels.ts';
import { createEditorState, createHiddenPanels, HIDDEN_PANELS_KEY } from '../src/client/features/sidebar-editor/state.ts';

function memory(initial: string | null = null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set(HIDDEN_PANELS_KEY, initial);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test('hidden panels are read from and written back to the window storage', () => {
  const storage = memory('["schedules","plugins",3]');
  const hidden = createHiddenPanels(storage);
  assert.deepEqual([...hidden.ids()], ['schedules', 'plugins']);
  let notified = 0;
  hidden.subscribe(() => { notified += 1; });
  const before = hidden.ids();
  hidden.set('schedules', true);
  assert.equal(notified, 0, 'an unchanged choice notifies nobody');
  assert.equal(hidden.ids(), before);
  hidden.set('schedules', false);
  hidden.set('ccd-theme', true);
  assert.equal(notified, 2);
  assert.notEqual(hidden.ids(), before, 'each change is a new snapshot');
  assert.equal(storage.values.get(HIDDEN_PANELS_KEY), '["plugins","ccd-theme"]');
  hidden.set('plugins', false);
  hidden.set('ccd-theme', false);
  assert.equal(storage.values.has(HIDDEN_PANELS_KEY), false, 'an empty choice leaves no entry behind');
});

test('an unreadable or unavailable storage hides nothing and still follows the session', () => {
  assert.equal(createHiddenPanels(memory('{not json')).ids().size, 0);
  assert.equal(createHiddenPanels(memory('{"a":1}')).ids().size, 0);
  const broken = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('denied'); },
    removeItem: () => { throw new Error('denied'); },
  };
  const hidden = createHiddenPanels(broken);
  hidden.set('plugins', true);
  assert.equal(hidden.has('plugins'), true);
  const absent = createHiddenPanels(undefined);
  absent.set('plugins', true);
  assert.equal(absent.has('plugins'), true);
});

test('the dialog state notifies only when it changes', () => {
  const state = createEditorState();
  let notified = 0;
  state.subscribe(() => { notified += 1; });
  assert.equal(state.isOpen(), false);
  state.open();
  state.open();
  assert.equal(state.isOpen(), true);
  state.close();
  assert.equal(state.isOpen(), false);
  assert.equal(notified, 2);
});

function fakeContext(lang: string) {
  const selected: string[] = [];
  const registered: Array<Record<string, unknown>> = [];
  const entries = [
    { options: { id: 'ccd-theme', order: 20, label: () => '主题' } },
    { options: { id: 'schedules', order: 10, label: '自动化任务' } },
    { options: { id: 'third', order: 10, label: 'Third' } },
    { options: { id: 'plugins', order: 0, label: () => '插件' } },
    { options: { order: 5 } },
  ];
  const ctx = {
    slots: {
      entriesOfSlot: (key: string) => (key === 'sidebar.panellist' ? entries : []),
      subscribe: () => () => {},
      inject: (_name: string, register: () => () => void) => register(),
      register: (options: Record<string, unknown>) => { registered.push(options); return () => {}; },
    },
    layout: {
      selectPanel: (id: string) => { selected.push(id); },
      panelInfo: { getSnapshot: () => ({ activePanelId: 'schedules' }), subscribe: () => () => {} },
    },
  } as unknown as Context;
  const document = { documentElement: { lang } } as unknown as Document;
  return { ctx, document, selected, registered };
}

test('the port lists panels in the column order under the names the rows show', () => {
  const zh = fakeContext('zh-CN');
  const port = sidebarPanelsPort(zh.ctx, zh.document);
  assert.deepEqual(port.panels(), [
    { id: 'plugins', label: '自定义' },
    { id: 'schedules', label: '定时任务' },
    { id: 'third', label: 'Third' },
    { id: 'ccd-theme', label: '主题' },
  ]);
  assert.equal(port.active(), 'schedules');
  port.select('ccd-theme');
  assert.deepEqual(zh.selected, ['ccd-theme']);
  const en = fakeContext('en');
  assert.deepEqual(sidebarPanelsPort(en.ctx, en.document).panels().map(panel => panel.label), ['Customize', 'Scheduled tasks', 'Third', '主题']);
});

test('More card rows register ahead of the host rows', () => {
  const fake = fakeContext('zh');
  const face = { hidden: true };
  mountMoreCardRows(fake.ctx, { id: 'ccd-hidden-panels', order: -10, inject: () => face }, () => null);
  assert.equal(fake.registered.length, 1);
  const [options] = fake.registered;
  assert.equal(options?.name, 'sidebar.panellist.actions');
  assert.equal(options?.id, 'ccd-hidden-panels');
  assert.equal(options?.order, -10);
  assert.equal((options?.inject as () => unknown)(), face);
});
