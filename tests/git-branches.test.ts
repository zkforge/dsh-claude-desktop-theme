import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { listBranches, mountGitBranches, runGit, type GitRunner } from '../src/host/git.ts';
import {
  GIT_BRANCH_LIMIT, GIT_BRANCHES_PATH, readGitBranchView,
} from '../src/shared/git.ts';

const signal = new AbortController().signal;

/** A runner answering each git subcommand from a table. */
function runner(answers: Record<string, string | { code: unknown; stderr?: string }>): GitRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const run = async (_cwd: string, args: readonly string[]) => {
    calls.push([...args]);
    const answer = answers[args[0] ?? ''];
    if (answer === undefined) throw Object.assign(new Error('unexpected'), { code: 1 });
    if (typeof answer !== 'string') throw Object.assign(new Error('failed'), answer);
    return answer;
  };
  return Object.assign(run, { calls });
}

test('current branch leads the list, the rest keep the recency order', async () => {
  const run = runner({ 'for-each-ref': 'feat/a\nmain\nwip/b\n', 'symbolic-ref': 'main\n' });
  assert.deepEqual(await listBranches('/repo', run, signal), {
    state: 'ready', current: 'main', detached: false, branches: ['main', 'feat/a', 'wip/b'], truncated: false,
  });
  assert.deepEqual(run.calls[0]?.slice(0, 2), ['for-each-ref', '--sort=-committerdate']);
});

test('an unborn branch is still named and a detached HEAD reports its commit', async () => {
  assert.deepEqual((await listBranches('/repo', runner({ 'for-each-ref': '', 'symbolic-ref': 'main\n' }), signal)).branches, ['main']);
  const detached = await listBranches('/repo', runner({
    'for-each-ref': 'main\n', 'symbolic-ref': { code: 1 }, 'rev-parse': 'abc1234\n',
  }), signal);
  assert.equal(detached.current, 'abc1234');
  assert.equal(detached.detached, true);
  assert.deepEqual(detached.branches, ['main']);
});

test('non-repositories, a missing git and other failures are told apart', async () => {
  assert.equal((await listBranches('/x', runner({
    'for-each-ref': { code: 128, stderr: 'fatal: not a git repository (or any of the parent directories): .git' },
  }), signal)).state, 'not-repo');
  assert.equal((await listBranches('/x', runner({ 'for-each-ref': { code: 'ENOENT' } }), signal)).state, 'no-git');
  assert.equal((await listBranches('/x', runner({ 'for-each-ref': { code: 128, stderr: 'fatal: bad object' } }), signal)).state, 'error');
});

test('long lists are cut at the limit and flagged', async () => {
  const names = Array.from({ length: GIT_BRANCH_LIMIT + 1 }, (_, index) => `b${index}`);
  const view = await listBranches('/repo', runner({ 'for-each-ref': names.join('\n'), 'symbolic-ref': 'b0' }), signal);
  assert.equal(view.branches.length, GIT_BRANCH_LIMIT);
  assert.equal(view.truncated, true);
});

test('the route resolves registered Workspaces only and never takes a path', async () => {
  let handler: ((request: Request) => Promise<Response>) | undefined;
  let path = '';
  const routes: string[] = [];
  const services: Record<string, unknown> = {
    connection: { fetch: { register: (route: { path: string; methods: readonly string[]; fetch: typeof handler }) => {
      routes.push(route.path);
      assert.deepEqual(route.methods, ['GET']);
      if (route.path === GIT_BRANCHES_PATH) { path = route.path; handler = route.fetch; }
      return async () => {};
    } } },
    workspaceRegistry: { get: (id: string) => id === 'w1' ? { path: '/repo' } : undefined },
  };
  const ctx = {
    get: (name: string) => services[name],
    inject: (_: string[], callback: (ctx: Context) => void) => callback(ctx as unknown as Context),
    effect: (effect: () => unknown) => effect(),
  } as unknown as Context;
  const seen: string[] = [];
  mountGitBranches(ctx, () => true, async (cwd, args) => {
    seen.push(cwd);
    return args[0] === 'for-each-ref' ? 'main\n' : 'main\n';
  });
  assert.equal(path, GIT_BRANCHES_PATH);
  assert.deepEqual(routes, [GIT_BRANCHES_PATH], 'only the read-only branch listing is registered');
  assert.ok(handler);
  const ready = await (await handler(new Request(`http://app${GIT_BRANCHES_PATH}?workspace=w1`))).json();
  assert.deepEqual(readGitBranchView(ready).branches, ['main']);
  assert.deepEqual(new Set(seen), new Set(['/repo']));
  for (const query of ['?workspace=nope', '?path=/etc', '']) {
    const body = await (await handler(new Request(`http://app${GIT_BRANCHES_PATH}${query}`))).json();
    assert.equal(body.state, 'unknown-workspace');
  }
});

test('the client accepts only a well-formed view', () => {
  assert.equal(readGitBranchView({ state: 'ready', current: 1, branches: [] }).state, 'error');
  assert.equal(readGitBranchView({ state: 'ready', current: 'main', branches: ['main', 2] }).state, 'error');
  assert.equal(readGitBranchView({ state: 'weird' }).state, 'error');
  assert.equal(readGitBranchView({ state: 'not-repo', branches: ['x'] }).branches.length, 0);
});

test('the real runner reads a scratch repository', async t => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { t.skip('git not installed'); return; }
  const dir = await mkdtemp(join(tmpdir(), 'ccd-git-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init');
    git('branch', 'feat/x');
    const view = await listBranches(dir, runGit, signal);
    assert.equal(view.current, 'main');
    assert.deepEqual([...view.branches].sort(), ['feat/x', 'main']);
    assert.equal(view.branches[0], 'main');
    const outside = await mkdtemp(join(tmpdir(), 'ccd-nogit-'));
    try {
      // Under the user's locale git localises the message; the runner pins it to C.
      const plain = await listBranches(outside, runGit, signal);
      assert.ok(plain.state === 'not-repo' || plain.state === 'ready', plain.state);
    } finally { await rm(outside, { recursive: true, force: true }); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
