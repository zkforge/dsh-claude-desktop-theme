import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { checkoutBranch, listBranches, mountGitBranches, runGit, type GitRunner } from '../src/host/git.ts';
import {
  GIT_BRANCH_LIMIT, GIT_BRANCHES_PATH, GIT_CHECKOUT_PATH, readGitBranchView, readGitCheckoutResult,
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
  const services: Record<string, unknown> = {
    connection: { fetch: { register: (route: { path: string; fetch: typeof handler }) => {
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

test('checkout only ever names a verified local branch, never an option', async () => {
  for (const branch of ['', '-f', '--orphan=x', 'a\nb']) {
    const run = runner({ 'rev-parse': '', switch: '' });
    assert.equal((await checkoutBranch('/repo', branch, run)).state, 'invalid-branch', branch);
    assert.deepEqual(run.calls, []);
  }
  const missing = runner({ 'rev-parse': { code: 1 } });
  assert.equal((await checkoutBranch('/repo', 'gone', missing)).state, 'invalid-branch');
  assert.deepEqual(missing.calls, [['rev-parse', '--verify', '--quiet', 'refs/heads/gone']]);
  const run = runner({ 'rev-parse': 'abc\n', switch: '', status: ' M a.txt\n M b.txt\n' });
  assert.deepEqual(await checkoutBranch('/repo', 'feat/x', run), { state: 'switched', carried: 2, message: '' });
  assert.deepEqual(run.calls.map(call => call[0]), ['rev-parse', 'switch', 'status']);
  assert.deepEqual(run.calls[1], ['switch', 'feat/x']);
});

test('git refusals are reported, not forced', async () => {
  const refused = (stderr: string) => runner({ 'rev-parse': 'abc', switch: { code: 1, stderr } });
  assert.equal((await checkoutBranch('/r', 'b', refused('error: Your local changes to the following files would be overwritten by checkout:\n\ta.txt\nPlease commit your changes or stash them before you switch branches.'))).state, 'conflict');
  assert.equal((await checkoutBranch('/r', 'b', refused("fatal: 'b' is already used by worktree at '/w'"))).state, 'in-worktree');
  assert.deepEqual(await checkoutBranch('/r', 'b', refused('fatal: Unable to create index.lock: File exists.\nmore')),
    { state: 'error', carried: 0, message: 'Unable to create index.lock: File exists.' });
});

test('checkouts of one directory run one at a time', async () => {
  const order: string[] = [];
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  const run: GitRunner = async (_cwd, args) => {
    if (args[0] === 'switch') {
      order.push(`start ${args[1]}`);
      if (args[1] === 'a') await gate;
      order.push(`end ${args[1]}`);
    }
    return '';
  };
  const first = checkoutBranch('/same', 'a', run);
  const second = checkoutBranch('/same', 'b', run);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(order, ['start a']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start a', 'end a', 'start b', 'end b']);
});

test('the checkout route takes a Workspace id and a branch from the body', async () => {
  const handlers = new Map<string, (request: Request) => Promise<Response>>();
  const services: Record<string, unknown> = {
    connection: { fetch: { register: (route: { path: string; methods: string[]; fetch: (request: Request) => Promise<Response> }) => {
      assert.deepEqual(route.methods, route.path === GIT_CHECKOUT_PATH ? ['POST'] : ['GET']);
      handlers.set(route.path, route.fetch); return async () => {};
    } } },
    workspaceRegistry: { get: (id: string) => id === 'w1' ? { path: '/repo' } : undefined },
  };
  const ctx = {
    get: (name: string) => services[name],
    inject: (_: string[], callback: (ctx: Context) => void) => callback(ctx as unknown as Context),
    effect: (effect: () => unknown) => effect(),
  } as unknown as Context;
  const cwds: string[] = [];
  mountGitBranches(ctx, () => true, async (cwd, args) => { cwds.push(cwd); return args[0] === 'status' ? '' : 'x'; });
  const checkout = handlers.get(GIT_CHECKOUT_PATH);
  assert.ok(checkout);
  const post = (body: unknown) => checkout(new Request(`http://app${GIT_CHECKOUT_PATH}`, { method: 'POST', body: JSON.stringify(body) }));
  assert.deepEqual(readGitCheckoutResult(await (await post({ workspace: 'w1', branch: 'feat' })).json()),
    { state: 'switched', carried: 0, message: '' });
  assert.deepEqual(new Set(cwds), new Set(['/repo']));
  for (const body of [{ workspace: 'nope', branch: 'feat' }, { path: '/etc', branch: 'feat' }, 'junk']) {
    assert.equal((await (await post(body)).json()).state, 'unknown-workspace');
  }
});

test('the real runner switches, carries clean changes and refuses conflicting ones', async t => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); } catch { t.skip('git not installed'); return; }
  const dir = await mkdtemp(join(tmpdir(), 'ccd-git-switch-'));
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    await writeFile(join(dir, 'a.txt'), 'main\n');
    await writeFile(join(dir, 'b.txt'), 'shared\n');
    git('add', '.'); git('commit', '-q', '-m', 'init');
    git('switch', '-q', '-c', 'feat');
    await writeFile(join(dir, 'a.txt'), 'feat\n');
    git('commit', '-q', '-am', 'feat'); git('switch', '-q', 'main');

    // b.txt is the same on both branches, so its edit travels along.
    await writeFile(join(dir, 'b.txt'), 'edited\n');
    assert.deepEqual(await checkoutBranch(dir, 'feat', runGit), { state: 'switched', carried: 1, message: '' });
    assert.equal((await listBranches(dir, runGit, signal)).current, 'feat');
    assert.equal(await readFile(join(dir, 'b.txt'), 'utf8'), 'edited\n');

    // a.txt differs between the branches: git refuses and the edit survives.
    await writeFile(join(dir, 'a.txt'), 'mine\n');
    assert.equal((await checkoutBranch(dir, 'main', runGit)).state, 'conflict');
    assert.equal((await listBranches(dir, runGit, signal)).current, 'feat');
    assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'mine\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
