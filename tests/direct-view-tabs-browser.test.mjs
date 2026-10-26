import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, MACOS_BUILD, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';
let chrome;
try { chrome = findChrome(); } catch { /* CI supplies Chrome. */ }

test('only More is hidden; direct trajectory delegates to native selection without replacing header or summaries', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 30000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {mountDirectViewTabs} from './src/client/compat/direct-view-tabs.ts';
    import {mountViewSwitch} from './src/client/compat/view-switch.ts';
    import {VIEW_SWITCH_ICONS} from './src/client/features/conversation/view-switch-icons.ts';
    window.errors=[];
    window.releaseDirect=mountDirectViewTabs(document,error=>window.errors.push(String(error)));
    window.releaseSwitcher=mountViewSwitch(document,VIEW_SWITCH_ICONS,error=>window.errors.push(String(error)));
  ` }, bundle: true, write: false, format: 'iife' });
  const css = (await Promise.all(['src/client/theme/tokens.css','src/client/features/conversation/conversation.css'].map(file => readFile(file,'utf8')))).join('\n');
  for (const buildInfo of [MACOS_BUILD, WINDOWS_BUILD]) {
    const profile = await mkdtemp(join(tmpdir(), 'ccd-direct-tabs-'));
    try {
      await withPage({ url: 'about:blank', width: 1100, height: 700, profile }, async page => {
        await page.evaluate(`
          document.documentElement.dataset.dshCcdStyle='true';
          document.documentElement.dataset.platform='win32';
          document.body.innerHTML=${JSON.stringify(aliasHostClasses(`<main data-slot="root"><div class="${buildInfo.frameClass}"></div></main><header class="ST7X_W_header" id="header"><div class="ST7X_W_titleRow"><span id="title">Original title</span><div class="ST7X_W_headerUtilities" id="utilities">Original utilities</div></div>
            <div class="ST7X_W_tabs"><div role="tablist" data-conversation-tabs><button id="chat" role="tab" aria-selected="true" class="ST7X_W_tab ST7X_W_tabActive">对话</button></div>
            <span id="more-anchor"><button id="more" aria-haspopup="menu" aria-expanded="false" aria-label="更多视图">⋯</button></span></div></header>
            <div data-turn-tail><section data-changed-files id="summary">Original summary</section></div>`, buildInfo))};
          const style=document.createElement('style');style.textContent=${JSON.stringify(aliasHostClasses(css,buildInfo))};document.head.append(style);
          window.originalHeader=document.getElementById('header');window.originalSummary=document.getElementById('summary');
          window.nativeSelections=[];window.hiddenDuringSelection=false;window.nativeMoreClicks=0;
          const more=document.getElementById('more'),chat=document.getElementById('chat');
          more.onclick=()=>{window.nativeMoreClicks++;
            if(more.getAttribute('aria-expanded')==='true'){more.setAttribute('aria-expanded','false');document.querySelector('[data-test-menu]')?.remove();return;}
            more.setAttribute('aria-expanded','true');
            const menu=document.createElement('div');menu.className=${JSON.stringify(aliasHostClasses('ST7X_W_viewsMoreMenu',buildInfo))};menu.dataset.testMenu='';
            menu.innerHTML='<button role="menuitem">轨迹</button><button>浏览更多插件</button><button>创建你的插件</button>';
            menu.firstElementChild.onclick=()=>{window.hiddenDuringSelection=getComputedStyle(menu).visibility==='hidden';window.nativeSelections.push('trajectory');chat.setAttribute('aria-selected','false');chat.classList.remove(${JSON.stringify(aliasHostClasses('ST7X_W_tabActive',buildInfo))});more.setAttribute('aria-label','更多视图：轨迹');queueMicrotask(()=>{more.setAttribute('aria-expanded','false');menu.remove();});};
            document.body.append(menu);
          };
          chat.onclick=()=>{window.nativeSelections.push('chat');chat.setAttribute('aria-selected','true');chat.classList.add(${JSON.stringify(aliasHostClasses('ST7X_W_tabActive',buildInfo))});more.setAttribute('aria-label','更多视图');};
        `);
        await page.evaluate(bundle.outputFiles[0].text);
        assert.equal(await page.evaluate(`getComputedStyle(document.getElementById('more-anchor')).display`), 'none');
        assert.equal(await page.evaluate(`document.querySelectorAll('[role=tab]').length`), 2);
        await page.evaluate(`document.querySelector('[data-ccd-direct-trajectory]').click()`);
        await page.evaluate('new Promise(resolve=>setTimeout(resolve,80))');
        assert.deepEqual(await page.evaluate('window.nativeSelections'), ['trajectory']);
        assert.equal(await page.evaluate('window.hiddenDuringSelection'), true);
        assert.equal(await page.evaluate('window.nativeMoreClicks'), 1);
        assert.equal(await page.evaluate(`document.querySelector('[data-ccd-direct-trajectory]').getAttribute('aria-selected')`), 'true');
        assert.equal(await page.evaluate(`document.querySelector('[data-test-menu]')===null`), true);
        await page.evaluate(`document.getElementById('chat').click()`);
        await page.evaluate('new Promise(resolve=>setTimeout(resolve,40))');
        assert.equal(await page.evaluate(`document.querySelector('[data-ccd-direct-trajectory]').getAttribute('aria-selected')`), 'false');
        assert.equal(await page.evaluate(`document.getElementById('header')===window.originalHeader&&document.getElementById('summary')===window.originalSummary`), true);
        assert.equal(await page.evaluate(`getComputedStyle(document.getElementById('summary')).borderRadius`), '10px');
        assert.notEqual(await page.evaluate(`getComputedStyle(document.getElementById('utilities')).display`), 'none');
        await page.evaluate('window.releaseSwitcher();window.releaseDirect()');
        assert.equal(await page.evaluate(`document.querySelector('[data-ccd-direct-trajectory]')===null`), true);
        assert.notEqual(await page.evaluate(`getComputedStyle(document.getElementById('more-anchor')).display`), 'none');
        assert.deepEqual(await page.evaluate('window.errors'), []);
      });
    } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  }
});
