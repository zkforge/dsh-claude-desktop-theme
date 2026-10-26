import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountAccountBalance, type AccountBalanceCache } from '../src/client/compat/account-balance.ts';

function fixture() {
  class Element {
    children: Element[] = [];
    attributes = new Map<string, string>();
    listeners = new Map<string, (event: Event) => void>();
    ownerDocument = document;
    textContent = '';
    title = '';
    ariaDescription = '';
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    removeAttribute(key: string) { this.attributes.delete(key); }
    append(...nodes: Element[]) { this.children.push(...nodes); }
    after(node: Element) { menu.children.push(node); }
    remove() { menu.children = menu.children.filter(child => child !== this); }
    addEventListener(key: string, listener: (event: Event) => void) { this.listeners.set(key, listener); }
    querySelector() { return anchor; }
  }
  const document = {
    documentElement: { lang: 'zh-CN' }, hidden: false,
    createElement: () => new Element(),
    addEventListener() {}, removeEventListener() {},
  };
  const menu = new Element();
  const anchor = new Element();
  return { menu, mount: (cache: AccountBalanceCache) => mountAccountBalance(menu as unknown as HTMLElement, cache) };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const ready = (total: string) => Response.json({ state: 'ready', balance: { total, granted: '0', toppedUp: total } });

test('reopening retains the last balance while refreshing without a loading flash', async t => {
  const f = fixture();
  const cache: AccountBalanceCache = {};
  let complete: (response: Response) => void = () => {};
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { complete = resolve; }));
  // The reader must work with basic AbortController, without static signal APIs.
  t.mock.method(AbortSignal, 'any', () => { throw new Error('not available'); });
  t.mock.method(AbortSignal, 'timeout', () => { throw new Error('not available'); });
  let dispose = f.mount(cache);
  t.after(() => dispose());
  const first = f.menu.children[0]!;
  assert.equal(first.children[0]?.textContent, '余额');
  assert.equal(first.children[1]?.textContent, '—');
  complete(ready('12.34'));
  await flush();
  assert.equal(first.children[1]?.textContent, '¥12.34');
  assert.equal(cache.text, '¥12.34');
  assert.deepEqual(cache.balance?.balance, { total: '12.34', toppedUp: '12.34', granted: '0' });
  assert.equal(cache.balance?.today, '0.00');
  assert.equal(first.title, '');
  dispose();
  dispose = f.mount(cache);
  const reopened = f.menu.children[0]!;
  assert.equal(reopened.children[1]?.textContent, '¥12.34');
  assert.equal(reopened.title, '');
  complete(ready('12.30'));
  await flush();
  assert.equal(reopened.children[1]?.textContent, '¥12.30');
});

test('closing before completion does not overwrite the retained balance', async t => {
  const f = fixture();
  const cache: AccountBalanceCache = { text: '¥8.00', description: 'Previous balance' };
  let complete: (response: Response) => void = () => {};
  t.mock.method(globalThis, 'fetch', () => new Promise<Response>(resolve => { complete = resolve; }));
  const dispose = f.mount(cache);
  dispose();
  complete(ready('7.00'));
  await flush();
  assert.equal(cache.text, '¥8.00');
  assert.equal(f.menu.children.length, 0);
});

test('missing host endpoint provides a restart instruction', async t => {
  const f = fixture();
  t.mock.method(globalThis, 'fetch', async () => new Response('not found', { status: 404 }));
  const dispose = f.mount({});
  t.after(dispose);
  await flush();
  assert.match(f.menu.children[0]!.ariaDescription, /接口未就绪，请重启 DSH/);
});

test('an unsuccessful refresh clears cached breakdown amounts', async t => {
  const f = fixture();
  const cache: AccountBalanceCache = {
    text: '¥12.34', balance: { balance: { total: '12.34', toppedUp: '10.00', granted: '2.34' },
      today: '0.00', rate: null, rateDays: 0, days: null },
  };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ state: 'unauthorized' }));
  const dispose = f.mount(cache);
  t.after(dispose);
  await flush();
  assert.equal(cache.balance, undefined);
  assert.equal(cache.text, 'API Key 无效');
});
