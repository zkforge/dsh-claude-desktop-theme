import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { pluginCatalogPort } from '../src/client/compat/plugin-catalog.ts';

test('plugin catalog uses host versions, localized titles and official optional membership', async () => {
  const ctx = {
    remote: { pluginManager: { listBundles: async () => ({ ok: true, value: [
      { name: 'third-party', version: '1.2.3', meta: { title: { zh: '第三方' } } },
      { name: 'official', official: true, optional: true },
      { name: 'unknown-version' }, null, { name: 42 },
    ] }) } },
    locale: { resolveText: (text: { zh: string }) => text.zh },
  } as unknown as Context;
  assert.deepEqual(await pluginCatalogPort(ctx).read(), [
    { name: 'third-party', version: '1.2.3', title: '第三方', optionalOfficial: false },
    { name: 'official', title: 'official', optionalOfficial: true },
    { name: 'unknown-version', title: 'unknown-version', optionalOfficial: false },
  ]);
});

test('failed catalog reads reject instead of inventing versions', async () => {
  const ctx = { remote: { pluginManager: { listBundles: async () => ({ ok: false }) } } } as unknown as Context;
  await assert.rejects(pluginCatalogPort(ctx).read(), /unavailable/u);
});

test('host catalog invalidation subscription releases its listener', () => {
  let callback: (() => void) | undefined;
  let released = false;
  const ctx = { remote: { $on: (event: string, listener: () => void) => {
    assert.equal(event, 'plugin-manager/changed'); callback = listener;
    return () => { released = true; };
  } } } as unknown as Context;
  let calls = 0;
  const dispose = pluginCatalogPort(ctx).subscribe(() => calls++);
  callback!(); dispose();
  assert.equal(calls, 1);
  assert.equal(released, true);
});
