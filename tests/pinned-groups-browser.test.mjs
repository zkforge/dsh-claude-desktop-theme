import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, MACOS_BUILD, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Browser coverage follows the other sidebar tests. */ }

test('status grouping follows native pin changes and keeps native drag events', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, contents: `
      import {mountStatusGroups} from './src/client/compat/status-groups.ts';
      const listeners=new Set();
      const store=value=>({getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}});
      const workspace={pinnedSessionIds:['a','b']};
      const statuses=new Map([['a',{running:true}],['b',{}],['c',{}]]);
      const ctx={sessions:{list:store({byId:{
        a:{id:'a',displayTitle:'输入框居中对齐问题',running:true},b:{id:'b',displayTitle:'圆形按钮收起状态显示问题'},c:{id:'c',displayTitle:'Thinking 与工具调用同行滚动'},
        child:{id:'child',origin:'subagent',parentId:'a',displayTitle:'检查布局',running:true}
      }})},workspaces:{list:store(workspace)},uiSession:{sessionStatus:store(statuses)},uiWorkspace:{
        openSession:id=>window.opens.push(id),
      }};
      window.pins=ids=>{workspace.pinnedSessionIds=ids;for(const row of document.querySelectorAll('[data-row-key]')){const badge=row.querySelector('[data-fixture-pin]');if(badge)badge.hidden=!ids.includes(row.dataset.rowKey.slice(8));}listeners.forEach(fn=>fn());};
      window.setStatus=(id,value)=>{statuses.set(id,value);listeners.forEach(fn=>fn());};
      window.errors=[];window.opens=[];window.native=[];
      window.mount=()=>window.release=mountStatusGroups(document,ctx,error=>window.errors.push(String(error)));
      window.row=id=>document.querySelector('[data-row-key="session:'+id+'"]');
      window.heading=group=>document.querySelector('[data-ccd-status-owned="'+group+'"]');
      window.listenerCount=()=>listeners.size;
    ` }, bundle: true, write: false, format: 'iife',
  });
  const css = (await Promise.all(['src/client/theme/tokens.css','src/client/features/sidebar/sidebar.css']
    .map(path => readFile(join(root,path),'utf8')))).join('\n');
  const nativeCss = `body{margin:0;background:var(--ccd-sidebar);font-family:var(--ccd-font-ui);color:var(--ccd-text)}
    ._7514NG_flatList{width:250px;padding:10px;box-sizing:border-box}
    .jJkEga_sessionRow{display:flex;align-items:center;gap:6px;min-height:28px;font-size:13px;border-radius:6px}
    .jJkEga_title{flex:1}.jJkEga_rowActions button{border:0;background:transparent;color:inherit}
    .jJkEga_sessionRow:hover{background:var(--ccd-hover)}
    .jJkEga_slot{display:inline-flex;width:16px;flex:none}`;
  const fixture = `<main data-slot="root"><div class="_6Qf49G_frame"><div class="_7514NG_flatList">${[
    ['a','输入框居中对齐问题'],['b','圆形按钮收起状态显示问题'],['c','Thinking 与工具调用同行滚动']
  ].map(([id,title])=>`<div class="wrapper"><div class="jJkEga_sessionRow" role="treeitem" draggable="true" data-row-key="session:${id}" tabindex="-1"><span class="jJkEga_slot">◇</span><span class="jJkEga_title">${title}</span><span data-fixture-pin class="jJkEga_pinIndicator" role="img" aria-label="已置顶" ${id==='c'?'hidden':''}>⌖</span><span class="jJkEga_rowActions"><button aria-label="更多">⋯</button></span></div></div>`).join('')}
    <div data-row-key="session:blank" data-ccd-blank-session>新会话</div></div><div id="outside">外部区域</div></div></main>`;
  for (const host of [MACOS_BUILD, WINDOWS_BUILD]) {
    const profile = await mkdtemp(join(tmpdir(),'ccd-pins-test-'));
    try {
      await withPage({url:'about:blank',width:1392,height:932,scale:2,profile},async page=>{
        await page.evaluate(`document.documentElement.lang='zh-CN';document.documentElement.dataset.platform=${JSON.stringify(host===MACOS_BUILD?'darwin':'win32')};document.documentElement.dataset.dshCcdStyle='true';document.body.innerHTML=${JSON.stringify(aliasHostClasses(fixture,host))};const style=document.createElement('style');style.textContent=${JSON.stringify(aliasHostClasses(nativeCss+css,host))};document.head.append(style);`);
        await page.evaluate(bundle.outputFiles[0].text);
        await page.evaluate(`window.originalRows=[...document.querySelectorAll('[data-row-key]')];window.mount();
          for(const type of ['dragstart','dragover','drop'])window.row('a').addEventListener(type,event=>window.native.push([type,event.defaultPrevented]));
        `);
        const read = () => page.evaluate(`[...document.querySelectorAll('[data-ccd-status-order]')]
          .sort((a,b)=>a.dataset.ccdStatusOrder-b.dataset.ccdStatusOrder)
          .map(row=>[row.dataset.rowKey,row.dataset.ccdStatusGroup])`);
        assert.deepEqual(await read(), [['session:a','pinned'],['session:b','pinned'],['session:c','ended']]);
        assert.equal(await page.evaluate(`document.querySelector('.ccd-status-children button').textContent`), '检查布局');
        await page.evaluate(`
          for(const type of ['dragstart','dragover','drop'])window.row('a').dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true}));
          window.row('a').parentElement.before(window.row('b').parentElement);
        `);
        assert.deepEqual(await page.evaluate('window.native'), [['dragstart',false],['dragover',false],['drop',false]]);
        assert.deepEqual(await read(), [['session:b','pinned'],['session:a','pinned'],['session:c','ended']]);
        await page.evaluate("window.pins(['b']);window.heading('pinned').click()");
        assert.deepEqual(await read(), [['session:b','pinned'],['session:a','working'],['session:c','ended']]);
        assert.equal(await page.evaluate(`window.row('b').hasAttribute('data-ccd-status-hidden')`), true);
        await page.evaluate("window.pins([])");
        assert.equal(await page.evaluate("window.heading('pinned').hidden"), true);
        await page.evaluate('window.release()');
        assert.equal(await page.evaluate('window.listenerCount()'), 0);
        assert.equal(await page.evaluate("document.querySelectorAll('[data-ccd-status-owned],[data-ccd-status-order],[data-ccd-status-wrapper]').length"), 0);
        assert.equal(await page.evaluate('window.originalRows.every(row=>row.isConnected)'), true);
        assert.deepEqual(await page.evaluate('window.errors'), []);
      });
    } finally {
      await rm(profile,{recursive:true,force:true,maxRetries:6,retryDelay:150});
    }
  }
});
