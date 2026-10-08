import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Same optional browser coverage as the other compat modules. */ }

/*
 * The picker with one workspace, in the place it actually goes wrong: the chips
 * row sits a Composer stack above the window's bottom edge, so the card fits
 * *below* its chip — into the Composer — and the primitive keeps it there. The
 * unit double decides the side from numbers; only a real engine can show that
 * the inline `top` this module writes is where the card lands, that the host's
 * own per-frame rewrite is corrected rather than obeyed, and that a card which
 * outgrows the room above is capped flush instead of covering the chip.
 */
test('the picker card renders above its chip, and stays there as the host rewrites `top`', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 20000,
}, async () => {
  const bundle = await build({
    stdin: {
      resolveDir: root, loader: 'ts', contents: `
        import {mountComposerMenuPlacement} from './src/client/compat/composer-menus.ts';
        window.mountPlacement = () => window.release = mountComposerMenuPlacement(document, error => { throw error; });
        window.addWorkspace = () => {
          const row = document.createElement('div');
          row.setAttribute('role', 'menuitem');
          row.style.cssText = 'height:26px';
          document.querySelector('[role="menu"]').append(row);
        };
      `,
    }, bundle: true, write: false, format: 'iife',
  });
  const profile = await mkdtemp(join(tmpdir(), 'ccd-menu-placement-test-'));
  const host = `<div class="ST7X_W_heroWorkspaceRow" style="position:fixed;left:16px;top:712px;height:26px">
      <button id="chip" aria-haspopup="menu" aria-expanded="true" style="height:26px">选择工作区</button>
    </div>
    <!-- The input surface under the chips row: what "room below the anchor" is here. -->
    <div id="composer" style="position:fixed;left:16px;right:16px;top:742px;height:110px;border:1px solid #ddd;border-radius:10px"></div>
    <div role="menu" style="position:fixed;left:16px;top:742px;width:200px;box-sizing:border-box;padding:6px;background:#fff;border-radius:12px">
      <div role="menuitem" style="height:26px">zhoukai.space</div>
      <div role="menuitem" style="height:26px">添加工作区. . .</div>
    </div>`;
  try {
    await withPage({ url: 'about:blank', width: 1374, height: 871, scale: 1, profile }, async page => {
      await page.evaluate(`document.documentElement.lang='zh';document.body.style.margin='0';document.body.innerHTML=${JSON.stringify(host)};`);
      await page.evaluate(bundle.outputFiles[0].text);
      const pause = () => page.evaluate('new Promise(resolve=>setTimeout(resolve,70))');
      /** The two boxes the card has to obey, as the engine laid them out. */
      const boxes = () => page.evaluate(`(()=>{
        const menu = document.querySelector('[role="menu"]');
        const rect = menu.getBoundingClientRect();
        return {
          top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height),
          chip: Math.round(document.getElementById('chip').getBoundingClientRect().top),
          composer: Math.round(document.getElementById('composer').getBoundingClientRect().top),
          flipped: menu.hasAttribute('data-ccd-menu-flipped'),
          inlineTop: menu.style.top,
          maxHeight: menu.style.maxHeight,
        };
      })()`);

      await page.evaluate('window.mountPlacement()');
      await pause();

      /* One workspace: the native placement is below the chip, into the Composer. */
      const single = await boxes();
      assert.equal(single.flipped, true, 'a two-row picker opens above the chip');
      assert.equal(single.bottom, single.chip - 4, 'the card sits 4px above the chip, clear of it');
      assert.ok(single.bottom <= single.composer, 'the card no longer covers the Composer');
      assert.equal(single.maxHeight, '', 'a card that fits above keeps its own height');

      /* The primitive writes its own side every frame; the correction has to win. */
      await page.evaluate(`document.querySelector('[role="menu"]').style.top = '742px'`);
      await pause();
      const rewritten = await boxes();
      assert.equal(rewritten.top, single.top, 'the host\'s own top is corrected, not obeyed');
      assert.equal(rewritten.bottom, single.chip - 4);

      /* A second workspace: one more row, still above — the side may not depend on it. */
      await page.evaluate('window.addWorkspace()');
      await pause();
      const two = await boxes();
      assert.equal(two.height, single.height + 26);
      assert.equal(two.bottom, single.chip - 4, 'the grown card is re-placed flush against the chip');

      /* Outgrowing the room above: capped to it, still flush, still off the chip. */
      for (let row = 0; row < 40; row += 1) await page.evaluate('window.addWorkspace()');
      await pause();
      const tall = await boxes();
      assert.equal(tall.maxHeight, '696px', 'the free space above the chip is the ceiling');
      assert.ok(tall.height <= 696, 'the rendered card obeys this module\'s ceiling');
      assert.equal(tall.bottom, single.chip - 4, 'a capped card stays flush against the chip');
      assert.equal(tall.top, 12, 'and stops at the frame\'s own top margin');

      await page.evaluate('window.release()');
      const released = await boxes();
      assert.equal(released.flipped, false);
      assert.equal(released.maxHeight, '', 'teardown hands the ceiling back');
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
