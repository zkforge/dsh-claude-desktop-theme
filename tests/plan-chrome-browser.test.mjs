import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
let chrome;
try { chrome = findChrome(); } catch { /* CI provides Chrome. */ }

test('plan chrome hides the unwrapped native button and successful notices only', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import {mountPlanNotices} from './src/client/compat/plan-notices.ts';
      window.disposeNotices=mountPlanNotices(document, error=>{throw error});
    ` }, bundle: true, write: false, format: 'iife',
  });
  const styles = (await Promise.all(['menus', 'composer'].map(name => readFile(`src/client/theme/${name}.css`, 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-plan-chrome-'));
  try {
    await withPage({ url: 'about:blank', width: 800, height: 600, profile }, async page => {
      await page.evaluate(`
        document.documentElement.setAttribute('data-dsh-ccd-style','true');
        document.body.innerHTML=
          '<section data-conversation-session="a"><div class="yhfFVG_modes">'+
          '<button class="wXeviG_trigger" data-ccd-plan-label="计划"><span class="wXeviG_triggerIcon"></span><span id="permission" class="wXeviG_triggerLabel">接受编辑</span></button>'+
          '<span><button id="blue" aria-label="计划模式已开启，按下关闭">计划</button></span></div></section>'+
          '<div id="on" data-chat-flow-kind="command"><div data-state="ok">plan<span>Plan mode on. Use /plan off to leave.</span></div></div>'+
          '<div id="off" data-chat-flow-kind="command"><div data-state="ok">plan<span>Plan mode off.</span></div></div>'+
          '<div id="error" data-chat-flow-kind="command"><div data-state="error">plan<span>Plan mode off.</span></div></div>'+
          '<div id="running" data-chat-flow-kind="command"><div data-state="running">plan<span>Running…</span></div></div>'+
          '<div id="other" data-chat-flow-kind="command"><div data-state="ok">compact<span>Done</span></div></div>';
        const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      const display = id => page.evaluate(`getComputedStyle(document.getElementById(${JSON.stringify(id)})).display`);
      for (const id of ['permission', 'blue', 'on', 'off']) assert.equal(await display(id), 'none', id);
      for (const id of ['error', 'running', 'other']) assert.notEqual(await display(id), 'none', id);
      await page.evaluate(`document.querySelector('#running > div').textContent='planPlan mode off.';document.querySelector('#running > div').setAttribute('data-state','ok');`);
      assert.equal(await display('running'), 'none', 'streaming completion is hidden');
      await page.evaluate(`document.querySelector('#on > div').setAttribute('data-state','error');`);
      assert.notEqual(await display('on'), 'none', 'an error restores the row');
      await page.evaluate(`document.querySelector('.wXeviG_trigger').removeAttribute('data-ccd-plan-label');`);
      assert.notEqual(await display('permission'), 'none', 'normal permission label returns');
      assert.notEqual(await display('blue'), 'none', 'host control remains available without unified plan state');
      await page.evaluate('window.disposeNotices()');
      assert.notEqual(await display('off'), 'none', 'cleanup restores notices');
    });
  } finally {
    // Chrome can still be flushing its profile after receiving the teardown signal.
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
