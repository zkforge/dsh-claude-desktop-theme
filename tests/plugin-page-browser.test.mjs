import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

let chrome;
try { chrome = findChrome(); } catch { /* CI supplies Chrome. */ }

test('plugin page preserves host actions and parents across filtering, Discover, locale and disposal', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import {mountPluginPage} from './src/client/compat/plugin-page.ts';
      window.pluginErrors=[];
      window.stopPlugins=mountPluginPage(document,error=>window.pluginErrors.push(String(error)));
    ` }, bundle: true, write: false, format: 'iife',
  });
  const css = (await Promise.all(['tokens', 'plugins'].map(name => readFile(`src/client/theme/${name}.css`, 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-plugin-page-'));
  const settle = page => page.evaluate('new Promise(resolve=>setTimeout(resolve,60))');
  try {
    await withPage({ url: 'about:blank', width: 1392, height: 932, profile }, async page => {
      await page.evaluate(`
        document.documentElement.lang='zh-CN';
        document.documentElement.setAttribute('data-dsh-ccd-style','true');
        document.body.innerHTML='<section data-plugin-panel class="build_page" style="margin-left:264px">'+
          '<header class="build_pageHead"><div class="build_pageHeading"><h1 class="build_pageTitle">插件</h1><div class="build_pageIntro">安装、启用和配置插件</div></div><div id="actions" class="build_toolbar"><button id="add" class="build_addButton">添加插件</button></div></header>'+
          '<div class="build_pageTabs"><div class="build_pageTabList" role="tablist"><button role="tab" id="demo-installed" aria-selected="true">已安装</button><button role="tab" id="demo-discover" aria-selected="false">发现</button></div></div>'+
          '<div id="installed" class="build_installedPanel"><section data-plugin-group="bundles" class="build_group"><h3 class="build_groupTitle">已安装插件</h3><ul class="build_cards">'+
          '<li data-plugin-package="alpha" class="build_card"><div class="build_cardHead"><span class="build_cardIcon"></span><div class="build_cardMain"><button id="open" class="build_cardTitle">Alpha</button><span class="build_cardDesc">设计工具</span></div></div></li>'+
          '<li data-plugin-package="beta" class="build_card"><div class="build_cardHead"><div class="build_cardMain">Beta</div></div></li></ul></section></div></section>';
        const style=document.createElement('style');
        style.textContent=${JSON.stringify(css)}+'*{box-sizing:border-box}body{margin:0}button,input{font:inherit}';document.head.append(style);
        window.openButton=document.querySelector('#open');window.originalParent=openButton.parentNode;
        window.openCount=0;openButton.onclick=()=>window.openCount++;
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      assert.equal(await page.evaluate('document.querySelector("h1").textContent'), '自定义');
      assert.equal(await page.evaluate('document.querySelector("#demo-installed").textContent'), '我的');
      assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".build_cards")).gridTemplateColumns.split(" ").length'), 1);
      assert.deepEqual(await page.evaluate('Array.from(document.querySelector(".ccd-plugin-list-heading").children, cell => cell.textContent)'), ['插件', '说明', '状态']);
      await page.evaluate(`openButton.click();const input=document.querySelector('.ccd-plugin-search input');input.value='alpha';input.dispatchEvent(new Event('input'));`);
      await settle(page);
      assert.equal(await page.evaluate('window.openCount'), 1);
      assert.equal(await page.evaluate('openButton.parentNode===originalParent'), true);
      assert.equal(await page.evaluate('getComputedStyle(document.querySelector("[data-plugin-package=beta]")).display'), 'none');
      // A refreshed catalog must join the current search without replacing controls.
      await page.evaluate(`const card=document.createElement('li');card.className='build_card';card.dataset.pluginPackage='alpha-extra';card.textContent='Alpha extra';document.querySelector('.build_cards').append(card);`);
      await settle(page);
      assert.notEqual(await page.evaluate('getComputedStyle(document.querySelector("[data-plugin-package=alpha-extra]")).display'), 'none');
      await page.evaluate(`{const field=document.querySelector('.ccd-plugin-search input');field.value='missing';field.dispatchEvent(new Event('input'));}`);
      await settle(page);
      assert.equal(await page.evaluate('document.querySelector(".ccd-plugin-search-empty").hidden'), false);
      // Discover uses its own host search and keeps Add reachable despite native hidden.
      await page.evaluate(`
        document.querySelector('#installed').remove();document.querySelector('#actions').hidden=true;
        const panel=document.createElement('div');panel.className='build_tabPanel';panel.setAttribute('role','tabpanel');
        panel.innerHTML='<div data-plugin-tab="discover" class="market_section"><div class="market_toolbar"><button class="market_marketButton" aria-haspopup="menu">社区市场</button><label class="market_search"><input type="search"></label><button aria-haspopup="menu">标签</button><button aria-haspopup="menu">排序：默认顺序</button></div><ul class="market_cards"><li class="market_card" data-market-entry="alpha"><div class="market_main">Alpha</div><div class="market_cardEnd"><button id="install" aria-label="安装 Alpha">安装</button></div></li></ul></div>';
        document.querySelector('[data-plugin-panel]').append(panel);window.installs=0;document.querySelector('#install').onclick=()=>window.installs++;
      `);
      await settle(page);
      assert.equal(await page.evaluate('document.querySelector(".ccd-plugin-search").hidden'), true);
      assert.notEqual(await page.evaluate('getComputedStyle(document.querySelector("#actions")).display'), 'none');
      assert.equal(await page.evaluate('document.querySelector("[data-ccd-plugin-tool=sort]").getAttribute("aria-label")'), '排序：默认顺序');
      await page.evaluate('document.querySelector("#install").click();document.documentElement.lang="en"');
      await settle(page);
      assert.equal(await page.evaluate('window.installs'), 1);
      assert.equal(await page.evaluate('document.querySelector("h1").textContent'), 'Customize');
      // Drain our own mutations: idempotent passes must not spin each frame.
      await settle(page);
      await page.evaluate(`window.mutations=0;window.audit=new MutationObserver(records=>window.mutations+=records.length);audit.observe(document.body,{childList:true,subtree:true,characterData:true});`);
      await settle(page);
      assert.equal(await page.evaluate('window.mutations'), 0);
      await page.evaluate('audit.disconnect();window.stopPlugins()');
      assert.deepEqual(await page.evaluate('window.pluginErrors'), []);
      assert.equal(await page.evaluate('document.querySelector("h1").textContent'), '插件');
      assert.equal(await page.evaluate('document.querySelector("#demo-installed").textContent'), '已安装');
      assert.equal(await page.evaluate('document.querySelector("[data-ccd-plugin-page], [data-ccd-plugin-part], .ccd-plugin-search, .ccd-plugin-list-heading")'), null);
      assert.equal(await page.evaluate('document.querySelector("#install").getAttribute("aria-label")'), '安装 Alpha');
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});

test('plugin detail keeps the native back action below the title bar and above the header', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import {mountPluginPage} from './src/client/compat/plugin-page.ts';
      window.pluginErrors=[];
      window.stopPlugins=mountPluginPage(document,error=>window.pluginErrors.push(String(error)));
    ` }, bundle: true, write: false, format: 'iife',
  });
  const css = (await Promise.all(['tokens', 'plugins', 'management'].map(name => readFile(`src/client/theme/${name}.css`, 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-plugin-detail-'));
  try {
    await withPage({ url: 'about:blank', width: 1392, height: 932, profile }, async page => {
      await page.evaluate(`
        document.documentElement.lang='zh-CN';
        document.documentElement.setAttribute('data-dsh-ccd-style','true');
        document.documentElement.setAttribute('data-platform','darwin');
        document.body.innerHTML='<section data-plugin-panel class="host_page"><div class="host_detail">'+
          '<div class="host_detailTop" data-window-drag><button class="host_crumb"><svg class="host_crumbIcon"></svg><span>插件</span></button>'+
          '<div class="host_detailHead"><span id="icon" class="host_cardIcon">◈</span><div class="host_detailActions"><button id="toggle" role="switch" aria-checked="true">开关</button></div></div></div>'+
          '<div class="host_detailMain"><div id="titleRow" class="host_titleRow"><h3 class="host_detailTitle">语音输入</h3><span id="version">v0.2.1-rc.2</span><span>实验性</span></div>'+
          '<p class="host_detailName"><code>@deepseek-ai/dsh-experimental-voice-input-bundle</code></p><p id="description" class="host_detailDesc">在本机使用 SenseVoice 转写录音，首次使用需要安装依赖。</p></div>'+
          '<div id="sections" class="host_detailSections">配置内容</div></div></section>';
        const style=document.createElement('style');
        // Native header hierarchy and layout from the shipped plugin manager.
        style.textContent='body{margin:0}.host_page{height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:32px;padding:0 48px 48px}.host_page>*{width:100%;max-width:960px}.host_detail{display:flex;flex-direction:column}.host_detailTop{display:flex;flex-direction:column;padding-top:28px}[data-platform=darwin] .host_detailTop{padding-top:calc(28px + 24px)}.host_detailHead{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:32px 0 0}.host_detailMain{display:flex;flex-direction:column;gap:8px;min-width:0;margin-top:20px}.host_titleRow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}.host_detailTitle{margin:0;font-size:20px;line-height:28px}.host_detailSections{margin-top:32px}.host_detailDesc{margin:0;font-size:14px;line-height:22px}'+${JSON.stringify(css)};
        document.head.append(style);
        window.toggleCount=0;document.querySelector('#toggle').onclick=()=>window.toggleCount++;
        window.backCount=0;document.querySelector('.host_crumb').onclick=()=>window.backCount++;
        window.parents=Array.from(document.querySelectorAll('#icon,#titleRow,#toggle'),node=>[node,node.parentNode]);
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      for (const width of [1392, 760]) {
        await page.send('Emulation.setDeviceMetricsOverride', { width, height: 932, deviceScaleFactor: 1, mobile: false });
        const layout = await page.evaluate(`(() => {
          const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,center:r.top+r.height/2};};
          return {crumb:rect('.host_crumb'),icon:rect('#icon'),title:rect('#titleRow'),toggle:rect('#toggle'),description:rect('#description'),sections:rect('#sections')};
        })()`);
        assert.ok(layout.crumb.top >= 47, JSON.stringify(layout));
        assert.ok(layout.title.top >= layout.crumb.bottom + 16, JSON.stringify(layout));
        assert.ok(Math.abs(layout.icon.center - layout.title.center) < 1, JSON.stringify(layout));
        assert.ok(Math.abs(layout.toggle.center - layout.title.center) < 1, JSON.stringify(layout));
        assert.ok(layout.title.left >= layout.icon.right, JSON.stringify(layout));
        assert.ok(layout.title.right <= layout.toggle.left, JSON.stringify(layout));
        assert.ok(layout.description.top >= layout.title.bottom, JSON.stringify(layout));
        assert.ok(layout.sections.top >= layout.description.bottom, JSON.stringify(layout));
      }
      assert.equal(await page.evaluate('document.querySelector(".ccd-plugin-detail-current")'), null);
      assert.equal(await page.evaluate('document.querySelector(".host_crumb").textContent'), '插件');
      assert.equal(await page.evaluate('getComputedStyle(document.querySelector(".host_crumbIcon")).display'), 'block');
      await page.evaluate('document.querySelector(".host_crumb").click();document.querySelector("#toggle").click()');
      assert.equal(await page.evaluate('window.backCount'), 1);
      assert.equal(await page.evaluate('window.toggleCount'), 1);
      assert.equal(await page.evaluate('parents.every(([node,parent])=>node.parentNode===parent)'), true);
      assert.deepEqual(await page.evaluate('pluginErrors'), []);
      await page.evaluate('stopPlugins()');
      assert.equal(await page.evaluate('document.querySelector(".ccd-plugin-detail-current,[data-ccd-plugin-part]")'), null);
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
