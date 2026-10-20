import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { readCnyBalance } from '../src/shared/balance.ts';
import { mountDeepSeekBalance, readBalanceKey } from '../src/host/balance.ts';

function host(config: Record<string, unknown> = {}, options: { disabled?: boolean; key?: string } = {}) {
  const refs: string[] = [];
  const services: Record<string, unknown> = {
    loader: { entries: () => [{ disabled: options.disabled ?? false,
      options: { name: '@deepseek-ai/dsh-llm-deepseek-api-key', config } }] },
    launchEnvironment: { get: () => undefined },
    credentials: { resolve: async (ref: string) => { refs.push(ref); return options.key ? { value: options.key } : undefined; } },
  };
  const ctx = { get: (name: string) => services[name] } as unknown as Context;
  return { ctx, services, refs };
}

test('CNY is selected without converting USD; zero and precise decimal balances are preserved', () => {
  assert.deepEqual(readCnyBalance({ is_available: false, balance_infos: [
    { currency: 'USD', total_balance: '9', granted_balance: '0', topped_up_balance: '9' },
    { currency: 'CNY', total_balance: '0.001', granted_balance: '0', topped_up_balance: '0.001' },
  ] }), { total: '0.001', granted: '0', toppedUp: '0.001' });
  assert.equal(readCnyBalance({ balance_infos: [{ currency: 'USD' }] }), null);
  for (const amount of [null, '', 'NaN', 'Infinity', '1e3', 42]) {
    assert.equal(readCnyBalance({ balance_infos: [{ currency: 'CNY', total_balance: amount,
      granted_balance: '0', topped_up_balance: '0' }] }), null);
  }
});

test('key resolution uses the official provider reference and follows changed credentials', async () => {
  const { ctx, services, refs } = host({ apiKeyEnv: 'MY_DEEPSEEK_KEY' }, { key: 'first-key' });
  assert.equal(await readBalanceKey(ctx), 'first-key');
  assert.deepEqual(refs, ['MY_DEEPSEEK_KEY']);
  services['credentials'] = { resolve: async () => ({ value: 'changed-key' }) };
  assert.equal(await readBalanceKey(ctx), 'changed-key');
});

test('disabled or custom endpoint providers never supply keys for official balance requests', async () => {
  for (const fixture of [host({}, { disabled: true, key: 'secret' }),
    host({ baseURL: 'https://example.com/anthropic' }, { key: 'secret' })]) {
    assert.equal(await readBalanceKey(fixture.ctx), undefined);
    assert.deepEqual(fixture.refs, []);
  }
});

test('authenticated route normalizes balances and contains upstream authentication errors', async t => {
  const { ctx, services } = host({}, { key: 'secret-key' });
  let handler: ((request: Request) => Promise<Response>) | undefined;
  services['connection'] = { fetch: { register: (route: { fetch: typeof handler }) => {
    handler = route.fetch; return async () => {};
  } } };
  Object.assign(ctx, { inject: (_: string[], callback: (ctx: Context) => void) => callback(ctx),
    effect: (effect: () => unknown) => effect() });
  mountDeepSeekBalance(ctx, () => true);
  assert.ok(handler);
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.deepseek.com/user/balance');
    assert.equal((init.headers as Record<string, string>)['authorization'], 'Bearer secret-key');
    assert.equal(init.redirect, 'error');
    return Response.json({ balance_infos: [{ currency: 'CNY', total_balance: '110.00',
      granted_balance: '10.00', topped_up_balance: '100.00' }] });
  });
  const response = await handler(new Request('https://local/api/ccd-deepseek-balance'));
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { state: 'ready', balance: { total: '110.00', granted: '10.00', toppedUp: '100.00' } });
  t.mock.method(globalThis, 'fetch', async () => new Response('secret upstream body', { status: 401 }));
  assert.deepEqual(await (await handler(new Request('https://local/api/ccd-deepseek-balance'))).json(),
    { state: 'unauthorized', balance: null });
});
