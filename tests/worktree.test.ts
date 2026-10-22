import assert from 'node:assert/strict';
import { test } from 'node:test';
import { symbols, type Context } from '@deepseek-ai/cordis';
import type { ConversationController } from '@deepseek-ai/dsh-client-ui-conversation/client';
import { mountWorktrees, worktreeAvailability } from '../src/host/worktree.ts';
import { WorktreeChoices } from '../src/client/compat/workspace-worktree.ts';
import { mountWorktreeSupport, showWorktreeProgress } from '../src/client/compat/workspace-worktree-port.ts';
import { readWorktreeResult, WORKTREE_PATH } from '../src/shared/worktree.ts';

const result = { path: '/repo/.agents/worktrees/test', branch: 'worktree-test', baseCommit: 'abc', repositoryRoot: '/repo' };

test('new-session choices are independent; concurrent sends and send retries share creation', async () => {
  const choices = new WorktreeChoices(() => 's1');
  choices.select('s1', 'w1', true);
  choices.select('s2', 'w2', false);
  let calls = 0;
  const create = async (workspace: string) => { assert.equal(workspace, 'w1'); calls++; return result; };
  await Promise.all([choices.prepare('s1', create), choices.prepare('s1', create), choices.prepare('s2', create)]);
  await choices.prepare('s1', create);
  assert.equal(calls, 1);
  choices.select('s1', 'w1', false);
  assert.equal(choices.selected('s1'), true, 'a created checkout is not undone by a pending toggle');
  choices.select('s3', 'w3', true);
  choices.setBase('s3', 'feature/base');
  await assert.rejects(choices.prepare('s3', async () => { throw new Error('denied'); }), /denied/);
  await choices.prepare('s3', async (workspace, from) => {
    assert.equal(workspace, 'w3');
    assert.equal(from, 'feature/base');
    return result;
  });
});

test('availability requires the optional runtime, a repository and a committed HEAD', async () => {
  const signal = new AbortController().signal;
  assert.equal(await worktreeAvailability('/repo', false, signal, async () => { throw new Error('must not run'); }), 'disabled');
  assert.equal(await worktreeAvailability('/repo', true, signal, async () => ''), 'ready');
  assert.equal(await worktreeAvailability('/repo', true, signal, async (_cwd, args) => {
    if (args.includes('--verify')) throw new Error('unborn');
    return '/repo';
  }), 'no-commit');
  assert.equal(await worktreeAvailability('/repo', true, signal, async () => {
    throw { stderr: 'fatal: not a git repository' };
  }), 'not-repo');
  assert.throws(() => readWorktreeResult({ path: '/repo' }), /Invalid/);
});

function hostFixture() {
  let handler!: (request: Request) => Promise<Response>;
  let calls = 0;
  let history = false;
  let source = '/repo';
  let enabled = true;
  let failure = false;
  let maintenance = false;
  let requested: unknown;
  const cleanups: Array<() => unknown> = [];
  const services: Record<string, unknown> = {
    connection: { fetch: { register(route: { path: string; fetch: typeof handler }) {
      assert.equal(route.path, WORKTREE_PATH); handler = route.fetch; return () => {};
    } } },
    workspaceRegistry: { get: (id: string) => id === 'w1' ? { path: '/repo', sessionIds: ['s1', 's2'] } : undefined },
    sessionController: {
      resolveAgent: async () => ({ agent: {
        async runMaintenance(task: (signal: AbortSignal) => Promise<unknown>) {
          maintenance = true;
          try { return await task(new AbortController().signal); } finally { maintenance = false; }
        },
      } }),
      inspect: async () => ({ meta: { cwd: source }, events: history ? [{ type: 'user/message' }] : [] }),
    },
    worktrees: { async create(_agent: unknown, request: unknown) {
      assert.equal(maintenance, true);
      requested = request;
      calls++;
      if (failure) throw new Error('sandbox refused');
      return result;
    } },
  };
  const ctx = {
    get: (name: string) => services[name],
    inject: (_names: string[], callback: (scope: Context) => void) => callback(ctx as unknown as Context),
    effect(effect: () => (() => unknown) | void) { const dispose = effect(); if (dispose) cleanups.push(dispose); },
  };
  mountWorktrees(ctx as unknown as Context, () => enabled);
  return {
    post: (body: unknown) => handler(new Request(`http://host${WORKTREE_PATH}`, { method: 'POST', body: JSON.stringify(body) })),
    calls: () => calls,
    requested: () => requested,
    history: () => { history = true; },
    source: () => { source = '/other'; },
    disable: () => { enabled = false; },
    fail: (value: boolean) => { failure = value; },
    runtimeOff: () => { cleanups[0]?.(); },
  };
}

test('Host validates ownership and serializes creation; lost responses reuse the result', async () => {
  const fixture = hostFixture();
  for (const body of [null, {}, { workspace: 'w1', session: 'other' }, { workspace: 'other', session: 's1' }, { path: '/etc', session: 's1' }]) {
    assert.ok((await fixture.post(body)).status >= 400);
  }
  const body = { workspace: 'w1', session: 's1' };
  const responses = await Promise.all([fixture.post(body), fixture.post(body)]);
  assert.deepEqual(await responses[0]!.json(), result);
  assert.deepEqual(await responses[1]!.json(), result);
  fixture.history();
  assert.deepEqual(await (await fixture.post(body)).json(), result);
  assert.equal(fixture.calls(), 1);
  assert.deepEqual(fixture.requested(), {}, 'default to HEAD and a native generated name');
  fixture.disable();
  assert.equal((await fixture.post(body)).status, 409);
});

test('Host passes the staged base to the native runtime without switching the source checkout', async () => {
  const fixture = hostFixture();
  const response = await fixture.post({ workspace: 'w1', session: 's1', from: 'feature/base' });
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.requested(), { from: 'feature/base' });
  assert.equal((await fixture.post({ workspace: 'w1', session: 's2', from: 123 })).status, 400);
});

test('Host refuses existing conversations, changed project identity and disabled runtime', async () => {
  for (const change of ['history', 'source', 'runtimeOff'] as const) {
    const fixture = hostFixture();
    fixture[change]();
    assert.equal((await fixture.post({ workspace: 'w1', session: 's1' })).status, 409);
    assert.equal(fixture.calls(), 0);
  }
  const fixture = hostFixture();
  fixture.fail(true);
  assert.match((await (await fixture.post({ workspace: 'w1', session: 's1' })).json()).error, /sandbox refused/);
  fixture.fail(false);
  assert.equal((await fixture.post({ workspace: 'w1', session: 's1' })).status, 200);
  assert.equal(fixture.calls(), 2);
});

test('composer waits for creation; failure returns native draft-recovery outcome without forwarding', async t => {
  const effects: Array<() => unknown> = [];
  const forwarded: unknown[][] = [];
  let notice: unknown = null;
  const input = {
    notify(level: string, text: string) { notice = { level, text }; },
    notices: { getSnapshot: () => notice, set(value: null) { notice = value; } },
  };
  const original = async (...args: unknown[]) => {
    assert.equal(notice, null, 'progress is removed before forwarding the message');
    forwarded.push(args); return { kind: 'success' as const };
  };
  const conversation = { sendSession: original, input: { for: () => input } } as unknown as ConversationController;
  const traced = new Proxy(conversation, { get(target, key, receiver) {
    if (key === symbols.original) return target;
    const value: unknown = Reflect.get(target, key, receiver);
    return typeof value === 'function' ? new Proxy(value, {}) : value;
  } });
  const scope = {
    conversation: traced,
    sessions: { binding: () => ({ ctx: {} }) },
    inject(_names: string[], callback: (scope: Context) => void) {
      callback(scope as unknown as Context);
      return { dispose() { effects.forEach(effect => effect()); } };
    },
    effect(effect: () => (() => unknown)) { effects.push(effect()); },
  };
  const document = { documentElement: { lang: 'zh-CN' } } as Document;
  const support = mountWorktreeSupport(scope as unknown as Context, document, () => {});
  t.after(() => support.dispose());
  support.choices.select('s1', 'w1', true);
  const session = { sessionId: 's1', getSnapshot: () => ({ blank: true }) } as Parameters<ConversationController['sendSession']>[0];
  const attachments = ['attachment-id'] as unknown as Parameters<ConversationController['sendSession']>[2];
  let calls = 0;
  let fail = true;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    assert.deepEqual(notice, { level: 'info', text: '正在创建工作树…' });
    assert.equal(forwarded.length, 0, 'creation must precede native sending');
    return Response.json(fail ? { error: 'sandbox refused' } : result, { status: fail ? 409 : 200 });
  });
  assert.deepEqual(await conversation.sendSession(session, 'draft', attachments, 'queue'), {
    kind: 'error', text: '创建工作树失败: sandbox refused',
  });
  assert.equal(forwarded.length, 0);
  assert.equal(notice, null, 'failed creation clears the progress notice before native draft recovery');
  fail = false;
  assert.deepEqual(await conversation.sendSession(session, 'draft', attachments, 'queue'), { kind: 'success' });
  assert.equal(calls, 2);
  assert.equal(forwarded[0]?.[0], session);
  assert.equal(forwarded[0]?.[2], attachments, 'native attachment identity is preserved');
  await conversation.sendSession(session, 'retry', attachments, 'queue');
  assert.equal(calls, 2, 'a rejected native send must reuse the checkout on retry');
  const existing = { sessionId: 's2', getSnapshot: () => ({ blank: false }) } as typeof session;
  support.choices.select('s2', 'w1', true);
  await conversation.sendSession(existing, 'existing conversation', attachments, 'queue');
  assert.equal(calls, 2, 'existing conversations bypass preparation');
  assert.equal(forwarded.length, 3);
  support.dispose();
  assert.equal(conversation.sendSession, original);
});

test('progress cleanup preserves newer notices and omits banners when clearing is unavailable', () => {
  let notice: unknown = null;
  const input = {
    notify(level: string, text: string) { notice = { level, text }; },
    notices: { getSnapshot: () => notice, set(value: null) { notice = value; } },
  };
  type Input = Parameters<typeof showWorktreeProgress>[0];
  const clear = showWorktreeProgress(input as unknown as Input, 'creating');
  input.notify('error', 'another operation failed');
  clear();
  assert.deepEqual(notice, { level: 'error', text: 'another operation failed' });
  showWorktreeProgress({ notify() { assert.fail('must not publish a permanent notice'); } } as unknown as Input, 'creating')();
});
