import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

let chrome;
try { chrome = findChrome(); } catch { /* CI supplies Chrome. */ }

test('sidebar More card opens beside its row with shortened labels and restores on disposal', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import {mountSidebarMoreMenu} from './src/client/compat/sidebar-more-menu.ts';
      window.moreErrors=[];
      window.stopMore=mountSidebarMoreMenu(document,error=>window.moreErrors.push(String(error)));
    ` }, bundle: true, write: false, format: 'iife',
  });
  const css = await readFile('src/client/features/sidebar/sidebar.css', 'utf8');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-sidebar-more-'));
  const settle = page => page.evaluate('new Promise(resolve=>setTimeout(resolve,60))');
  try {
    await withPage({ url: 'about:blank', width: 1392, height: 932, profile }, async page => {
      await page.evaluate(`
        document.documentElement.setAttribute('data-dsh-ccd-style','true');
        document.body.innerHTML='<aside class="_3WPZCG_root" style="width:264px;padding:6px 12px"><nav class="_3WPZCG_panelList" style="margin-top:200px">'+
          '<div class="_3WPZCG_moreAnchor"><button id="more" class="_3WPZCG_panelRow" aria-haspopup="menu" aria-expanded="false" style="display:block;width:236px;height:36px">更多</button></div></nav></aside>';
        const style=document.createElement('style');
        style.textContent=${JSON.stringify(css)}+'body{margin:0}._3WPZCG_moreMenu{position:fixed;width:288px}';document.head.append(style);
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      // The host opens the card below the row and keeps writing its own coordinates.
      await page.evaluate(`
        const more=document.querySelector('#more');more.setAttribute('aria-expanded','true');
        const rect=more.getBoundingClientRect();
        const card=document.createElement('div');card.className='_3WPZCG_moreMenu';card.setAttribute('role','menu');
        card.style.left=rect.left+'px';card.style.top=(rect.bottom+4)+'px';
        card.innerHTML='<button role="menuitem"><span>浏览更多插件</span></button><button role="menuitem"><span>创建你的插件</span></button>';
        document.body.append(card);
      `);
      await settle(page);
      const placed = await page.evaluate(`(() => {
        const row=document.querySelector('#more').getBoundingClientRect();
        const card=document.querySelector('[role=menu]').getBoundingClientRect();
        return { gap: card.left-row.right, top: card.top-row.top, width: card.width < 288,
          labels: Array.from(document.querySelectorAll('[role=menuitem]'), row => row.textContent) };
      })()`);
      assert.deepEqual(placed, { gap: 4, top: 0, width: true, labels: ['浏览插件…', '创建插件…'] });
      // A later host frame rewriting top/left must not move the card back under the row.
      await page.evaluate(`document.querySelector('[role=menu]').style.top='600px'`);
      await settle(page);
      assert.equal(await page.evaluate(`document.querySelector('[role=menu]').getBoundingClientRect().top-document.querySelector('#more').getBoundingClientRect().top`), 0);
      await page.evaluate('window.stopMore()');
      assert.equal(await page.evaluate(`document.querySelector('[role=menu]').hasAttribute('data-ccd-sidebar-more-menu')`), false);
      assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('[role=menuitem]'), row => row.textContent)`), ['浏览更多插件', '创建你的插件']);
      assert.deepEqual(await page.evaluate('window.moreErrors'), []);
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
