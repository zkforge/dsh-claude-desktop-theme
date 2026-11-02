import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { instructionFilePath, readCardPreferences, sessionMetrics, showSessionInfo } from '../src/shared/session-info.ts';
import { applyPromptEvent, instructionHomes, readSessionEnvironment } from '../src/host/session-info.ts';

test('session metrics use disjoint cache buckets and weighted decode time', () => {
  assert.deepEqual(sessionMetrics({
    tokenUsage: { uncachedInputTokens: 100, cacheReadTokens: 800, cacheWriteTokens: 100, outputTokens: 200 },
    sessionStats: { decodeTokens: 300, decodeMs: 2000, llmMs: 9000 },
    ccdSessionInfo: { prompts: 7 },
  }), { input: 1000, output: 200, cacheHit: 0.8, prompts: 7, tps: 150 });
});

test('missing projections and zero denominators stay unavailable, not invented zeros', () => {
  assert.deepEqual(sessionMetrics({}), { input: null, output: null, cacheHit: null, prompts: null, tps: null });
  const zero = sessionMetrics({
    tokenUsage: { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 },
    sessionStats: { decodeTokens: 20, decodeMs: 0 }, ccdSessionInfo: { prompts: 0 },
  });
  assert.deepEqual(zero, { input: 0, output: 0, cacheHit: null, prompts: 0, tps: null });
  assert.equal(sessionMetrics({ tokenUsage: { outputTokens: NaN }, sessionStats: { decodeMs: -1 } }).tps, null);
});

test('the card rail closes before crowding chat, with a stable reopen threshold', () => {
  assert.equal(showSessionInfo(1000, 700, false), true);
  assert.equal(showSessionInfo(935, 700, true), false);
  assert.equal(showSessionInfo(950, 700, false), false);
  assert.equal(showSessionInfo(950, 700, true), true);
  assert.equal(showSessionInfo(1100, 399, true), false);
  assert.equal(showSessionInfo(960, 424, false), true);
  assert.equal(showSessionInfo(750, 700, false, true), true);
  assert.equal(showSessionInfo(331, 700, true, true), false);
  assert.equal(showSessionInfo(345, 700, false, true), false);
  assert.equal(showSessionInfo(345, 700, true, true), true);
  assert.equal(showSessionInfo(750, 399, true, true), false);
});

test('card preferences preserve valid order and discard invalid storage', () => {
  assert.deepEqual(readCardPreferences({ order: ['usage', 'usage', 'invalid'], collapsed: ['environment', 4] }), {
    order: ['usage', 'environment', 'context'], collapsed: ['environment'],
  });
  assert.deepEqual(readCardPreferences(null), { order: ['environment', 'context', 'usage'], collapsed: [] });
});

test('prompt count covers inherited human prompts and excludes machine messages', () => {
  const event = (kind: string) => ({ type: 'user/message', data: { source: { kind } } }) as SessionEvent;
  let state = { prompts: 0 };
  for (const kind of ['user', 'agent', 'model', 'user']) state = applyPromptEvent(state, event(kind));
  assert.equal(state.prompts, 2);
});

test('environment detects linked worktrees and detached HEAD without listing all branches', async () => {
  const calls: string[][] = [];
  const view = await readSessionEnvironment('/demo/worktree', new AbortController().signal, async (cwd, args) => {
    assert.equal(cwd, '/demo/worktree');
    calls.push([...args]);
    if (args.includes('--git-common-dir')) return '/demo/repo/.git/worktrees/demo\n/demo/repo/.git\n';
    if (args.includes('symbolic-ref')) throw new Error('detached');
    return 'a1b2c3d\n';
  });
  assert.deepEqual(view, { cwd: '/demo/worktree', git: 'ready', branch: 'a1b2c3d', detached: true, worktree: true });
  assert.equal(calls.length, 3);
  assert.equal(calls.some(args => args.includes('for-each-ref')), false);
});

test('non-repositories and Git errors have distinct empty states; cancellation propagates', async () => {
  const signal = new AbortController().signal;
  const absent = await readSessionEnvironment('/demo', signal, async () => { throw { stderr: 'fatal: not a git repository' }; });
  assert.equal(absent.git, 'not-repo');
  const failed = await readSessionEnvironment('/demo', signal, async () => { throw new Error('timeout'); });
  assert.equal(failed.git, 'error');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readSessionEnvironment('/demo', controller.signal, async () => { throw new Error('aborted'); }));
});

test('instruction display paths resolve against the session and the host homes', () => {
  const homes = { '~': '/home/me', $DSH_HOME: '/opt/dsh' };
  assert.equal(instructionFilePath('AGENTS.md', '/work/app/', homes), '/work/app/AGENTS.md');
  assert.equal(instructionFilePath('packages/ui/AGENTS.md', '/work/app', homes), '/work/app/packages/ui/AGENTS.md');
  assert.equal(instructionFilePath('~/.dsh/AGENTS.md', '/work/app', homes), '/home/me/.dsh/AGENTS.md');
  assert.equal(instructionFilePath('$DSH_HOME/AGENTS.md', '/work/app', homes), '/opt/dsh/AGENTS.md');
  assert.equal(instructionFilePath('/etc/AGENTS.md', '/work/app', homes), '/etc/AGENTS.md');
  assert.equal(instructionFilePath('C:\\work\\AGENTS.md', 'D:\\app', homes), 'C:\\work\\AGENTS.md');
  assert.equal(instructionFilePath('~/.dsh/AGENTS.md', '/work/app', {}), null);
  assert.equal(instructionFilePath('$DSH_AGENTS_HOME/AGENTS.md', '/work/app', homes), null);
  assert.deepEqual(instructionHomes({}, '/home/me'), { '~': '/home/me' });
  assert.deepEqual(instructionHomes({ DSH_HOME: '/opt/dsh', DSH_AGENTS_HOME: '/opt/agents' }, '/home/me'),
    { '~': '/home/me', $DSH_HOME: '/opt/dsh', $DSH_AGENTS_HOME: '/opt/agents' });
});
