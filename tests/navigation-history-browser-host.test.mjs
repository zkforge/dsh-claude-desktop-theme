import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

/*
 * The browser host has no window-control row, and the web page keeps its
 * header to the brand row alone: the navigation-history arrows are a desktop
 * control. `data-platform` is the desktop preload's marker, so its absence is
 * the browser's own statement.
 */

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Same optional browser coverage as the other browser tests. */ }

test('the browser host mounts no navigation history', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 20000,
}, async () => {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      contents: `
        import {mountNavigationHistory} from './src/client/compat/navigation-history-controls.ts';
        window.errors=[];
        window.port={current:()=>({kind:'panel',id:'a'}),available:()=>true,open:()=>{},subscribe:()=>()=>{}};
        window.mount=mountNavigationHistory;
        window.release=mountNavigationHistory(document,window.port,error=>window.errors.push(String(error)));
      `,
    },
    bundle: true,
    write: false,
    format: 'iife',
  });
  const profile = await mkdtemp(join(tmpdir(), 'ccd-nav-browser-'));
  try {
    await withPage({ url: 'about:blank', width: 400, height: 300, profile }, async page => {
      await page.evaluate(`
        document.documentElement.lang='zh-CN';
        document.documentElement.dataset.dshCcdStyle='true';
        document.body.innerHTML='<div class="_3WPZCG_root" id="sidebar" style="width:264px;height:300px;display:flex;flex-direction:column"></div>';
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-navigation-history]").length'), 0,
        'a browser host mounts no history arrows');
      assert.deepEqual(await page.evaluate('window.errors'), []);
      await page.evaluate('window.release()');
      /* A desktop host keeps the arrows: the skip is the browser's alone. */
      await page.evaluate(`
        document.documentElement.dataset.platform='linux';
        window.release=window.mount(document,window.port,error=>window.errors.push(String(error)));
      `);
      assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-navigation-history]").length'), 1,
        'a desktop platform keeps the history row');
      assert.equal(await page.evaluate('document.querySelector("[data-ccd-navigation-history]").parentElement.id'), 'sidebar');
      assert.deepEqual(await page.evaluate('window.errors'), []);
      await page.evaluate('window.release()');
      assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-navigation-history]").length'), 0);
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});
