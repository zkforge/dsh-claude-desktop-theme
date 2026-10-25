import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PaletteSchedule, PaletteSession, SearchPaletteSnapshot } from '../src/client/contracts/ports.ts';
import {
  entryActions, matchRange, paletteCopy, paletteSections, paletteTabs, scheduleLabel, scheduleMeta, scheduleRuleLabel,
} from '../src/client/features/search-palette/model.ts';

const zh = paletteCopy('zh-CN');
const en = paletteCopy('en');
const now = new Date(2026, 9, 25, 12, 0);

const session = (id: string, title: string, updatedAt: number, extra: Partial<PaletteSession> = {}): PaletteSession => ({
  id, title, workspace: 'dsh-claude-desktop-theme', updatedAt, running: false, archived: false, pinned: false, ...extra,
});
const schedule = (id: string, title: string, lastRunAt: number | null, extra: Partial<PaletteSchedule> = {}): PaletteSchedule => ({
  id, sessionId: `s-${id}`, title, prompt: `${title} prompt`, rule: { kind: 'daily', time: '09:51:00.000' },
  active: true, lastRunAt, ...extra,
});

const snapshot: SearchPaletteSnapshot = {
  sessions: [
    session('a', '展开菜单样式调整', 900),
    session('b', '工作树按钮布局调整', 800),
    session('c', '你好', 700),
    session('d', '提交当前改动', 500),
    session('old', '已归档的菜单', 1000, { archived: true }),
  ],
  projects: [
    { id: 'w1', title: 'dsh-claude-desktop-theme', path: '/Users/me/code/dsh-claude-desktop-theme', sessions: 4 },
    { id: 'w2', title: 'notes', path: '/Users/me/菜单/notes', sessions: 1 },
  ],
  schedules: [schedule('t1', '喝水', 600), schedule('t2', '周报', null, { active: false })],
};

const keys = (sections: ReturnType<typeof paletteSections>) => sections.map(section => [section.id, section.entries.map(entry => entry.key)]);

test('the empty 全部 view mixes recent Sessions and run tasks above the New Session action', () => {
  const sections = paletteSections(snapshot, { query: '', tab: 'all', now }, zh);
  assert.deepEqual(keys(sections), [
    ['recent', ['session:a', 'session:b', 'session:c', 'schedule:t1', 'session:d']],
    ['actions', ['action:new']],
  ]);
  assert.deepEqual(sections.map(section => section.title), ['最近使用', '操作']);
});

test('type tabs list their own rows, and a build without schedules has no task tab', () => {
  assert.deepEqual(keys(paletteSections(snapshot, { query: '', tab: 'project', now }, zh)), [['projects', ['project:w1', 'project:w2']]]);
  assert.deepEqual(keys(paletteSections(snapshot, { query: '', tab: 'schedule', now }, zh)), [['schedules', ['schedule:t1', 'schedule:t2']]]);
  assert.deepEqual(paletteTabs({ ...snapshot, schedules: null }), ['all', 'session', 'project']);
  assert.deepEqual(keys(paletteSections({ ...snapshot, schedules: null }, { query: '', tab: 'schedule', now }, zh))[0]?.[0], 'recent');
});

test('a query ranks prefix matches first, keeps archived Sessions last and appends content hits', () => {
  const sections = paletteSections(snapshot, {
    query: ' 菜单 ', tab: 'all', now, content: new Map([['d', '…修改菜单的提交…'], ['a', 'duplicate']]),
  }, zh);
  assert.deepEqual(keys(sections), [
    ['sessions', ['session:a', 'session:old', 'session:d']],
    ['projects', ['project:w2']],
    ['actions', ['action:new']],
  ]);
  const [hit] = sections[0]!.entries;
  assert.equal(hit?.kind === 'session' && hit.match?.join(), '2,4');
  const content = sections[0]!.entries[2];
  assert.equal(content?.kind === 'session' ? content.snippet : null, '…修改菜单的提交…');
  const action = sections.at(-1)!.entries[0];
  assert.equal(action?.kind === 'action' ? action.prompt : null, '菜单');
});

test('the 全部 view caps each type while a type tab lists every match', () => {
  const many: SearchPaletteSnapshot = { ...snapshot, sessions: Array.from({ length: 9 }, (_, index) => session(`m${index}`, `menu ${index}`, index)) };
  assert.equal(paletteSections(many, { query: 'menu', tab: 'all', now }, en)[0]!.entries.length, 6);
  assert.equal(paletteSections(many, { query: 'menu', tab: 'session', now }, en)[0]!.entries.length, 9);
});

test('a leading slash lists the type filters by label or alias', () => {
  assert.deepEqual(keys(paletteSections(snapshot, { query: '/', tab: 'all', now }, zh)), [
    ['filters', ['filter:all', 'filter:session', 'filter:project', 'filter:schedule']],
  ]);
  assert.deepEqual(keys(paletteSections(snapshot, { query: '/项', tab: 'all', now }, zh)), [['filters', ['filter:project']]]);
  assert.deepEqual(keys(paletteSections(snapshot, { query: '/task', tab: 'all', now }, en)), [['filters', ['filter:schedule']]]);
});

test('schedule rules read like the reference', () => {
  assert.equal(scheduleLabel(snapshot.schedules![0]!, zh, now), '喝水 · 每天 9:51');
  assert.equal(scheduleRuleLabel({ kind: 'weekly', time: '18:05:00.000', weekdays: [1, 2, 3, 4, 5] }, zh, now), '工作日 18:05');
  assert.equal(scheduleRuleLabel({ kind: 'weekly', time: '08:00:00.000', weekdays: [3, 1] }, zh, now), '每周一、三 8:00');
  assert.equal(scheduleRuleLabel({ kind: 'weekly', time: '08:00:00.000', weekdays: [3, 1] }, en, now), 'Mon, Wed 8:00');
  assert.equal(scheduleRuleLabel({ kind: 'every', seconds: 3600 }, zh, now), '每小时');
  assert.equal(scheduleRuleLabel({ kind: 'every', seconds: 900 }, zh, now), '每 15 分钟');
  assert.equal(scheduleRuleLabel({ kind: 'every', seconds: 7200 }, en, now), 'Every 2 h');
  assert.equal(scheduleRuleLabel({ kind: 'once', at: new Date(2026, 10, 3, 7, 5).toISOString() }, zh, now), '11月3日 7:05');
  assert.equal(scheduleRuleLabel({ kind: 'cron', expression: '0 9 * * 1' }, en, now), 'Cron 0 9 * * 1');
  assert.equal(scheduleMeta(snapshot.schedules![0]!, { count: 3, more: false }, zh), '3 次运行');
  assert.equal(scheduleMeta(snapshot.schedules![0]!, { count: 100, more: true }, en), '100+ runs');
  assert.equal(scheduleMeta(snapshot.schedules![1]!, undefined, zh), '已结束');
});

test('row menus offer the host actions each kind supports', () => {
  const [recent] = paletteSections(snapshot, { query: '', tab: 'all', now }, zh);
  assert.deepEqual(entryActions(recent!.entries[0]!, zh).map(action => action.label), ['打开', '置顶', '创建分支', '归档']);
  const archived = paletteSections(snapshot, { query: '已归档', tab: 'session', now }, zh)[0]!.entries[0]!;
  assert.deepEqual(entryActions(archived, zh).map(action => action.id), ['open', 'pin', 'fork', 'unarchive']);
  assert.deepEqual(entryActions({ kind: 'action', key: 'action:new', prompt: '' }, zh), []);
  assert.equal(matchRange('Hello', ''), null);
  assert.deepEqual(matchRange('Hello World', 'world'), [6, 11]);
});
