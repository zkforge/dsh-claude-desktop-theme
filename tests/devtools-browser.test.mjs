import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Devtools, findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

let chrome;
try { chrome = findChrome(); } catch { /* Same browser prerequisite as the other browser regressions. */ }

test('DevTools bounds a stalled evaluation and rejects pending calls when the target disconnects', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 20000,
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ccd-devtools-'));
  try {
    await withPage({ url: 'about:blank', width: 800, height: 600, profile }, async page => {
      const bounded = new Devtools(page.socket.url, { timeoutMs: 1000 });
      await bounded.ready;
      try {
        await assert.rejects(bounded.evaluate('new Promise(() => {})'), /DevTools command timed out/);
        assert.equal(await bounded.evaluate('1 + 1'), 2, 'a timed out request does not corrupt later responses');
        const pending = bounded.evaluate('new Promise(() => {})');
        const rejected = assert.rejects(pending, /DevTools connection closed/);
        bounded.close();
        await rejected;
        assert.equal(bounded.pending.size, 0);
      } finally { bounded.close(); }
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
