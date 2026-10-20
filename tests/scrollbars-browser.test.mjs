import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, PINNED_BUILD, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';
const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Optional local browser. */ }

const long = '<div style="width:1200px;height:900px">content</div>';
const box = id => `<div id="${id}" class="fixture-scroll">${long}</div>`;
const fixture = `
<div id="page" data-conversation-scroll class="fixture-scroll">${long}</div>
<div id="model" class="ccd-model-options fixture-scroll">${long}</div>
<div class="icaHSq_scroll">${box('code')}</div>
<div data-chat-flow-kind="tool-call"><div data-read data-ccd-read-scroll><div data-code-block-banner></div>${box('read')}</div></div>
<div data-chat-flow-kind="tool-call"><div id="skill" data-ccd-skill-content class="fixture-scroll">${long}</div></div>
<div data-variant="think"><div data-disclosure-header></div>${box('thinking')}</div>
<div id="settings" class="Dws9Sa_options fixture-scroll">${long}</div>
<div id="rail" style="width:100px;overflow:auto;scrollbar-width:none">${long}</div>`;

test('one grey rounded native painter covers pages, menus and tool details, with draggable endpoints', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 60000,
}, async () => {
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/theme/scrollbars.css',
    'src/client/features/tool-calls/tool-calls.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import {mountScrollPills} from './src/client/compat/scroll-pill.ts';
    window.errors=[];window.release=mountScrollPills(document,e=>window.errors.push(String(e)));
  ` }, bundle: true, write: false, format: 'iife' });
  for (const host of [PINNED_BUILD, WINDOWS_BUILD]) {
    const profile = await mkdtemp(join(tmpdir(), 'ccd-native-scroll-'));
    try {
      await withPage({ url: 'about:blank', width: 900, height: 800, profile, hideScrollbars: false }, async page => {
        await page.evaluate(`document.documentElement.setAttribute('data-dsh-ccd-style','true');
          document.body.innerHTML=${JSON.stringify(aliasHostClasses(fixture, host))};
          const s=document.createElement('style');s.textContent=${JSON.stringify(aliasHostClasses(styles, host))}+\`
            body{display:grid;grid-template-columns:repeat(3,240px);gap:16px;margin:12px}
            .fixture-scroll{box-sizing:border-box;width:220px;height:170px;overflow:auto}
            .fixture-scroll::-webkit-scrollbar-thumb{border:8px solid transparent;border-radius:0;background:black}
          \`;document.head.append(s);`);
        await page.evaluate(bundle.outputFiles[0].text);
        for (const id of ['page','model','code','read','skill','thinking','settings']) {
          const facts = await page.evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});
            e.setAttribute('data-ccd-scrolling','');const t=getComputedStyle(e,'::-webkit-scrollbar-thumb');
            const r=getComputedStyle(e,'::-webkit-scrollbar-track');const b=getComputedStyle(e,'::-webkit-scrollbar');
            return {width:b.width,height:b.height,radius:t.borderTopLeftRadius,color:t.backgroundColor,
              image:t.backgroundImage,margin:r.marginTop,standard:getComputedStyle(e).scrollbarWidth};})()`);
          assert.deepEqual(facts, {width:'6px',height:'6px',radius:'999px',color:'rgb(143, 143, 138)',image:'none',margin:'0px',standard:'auto'}, id);
        }
        assert.equal(await page.evaluate(`getComputedStyle(document.getElementById('rail')).scrollbarWidth`), 'none');
        assert.equal(await page.evaluate(`document.querySelector('[data-ccd-scroll-layer],[data-ccd-scroll-thumb]')===null`), true);
        // Hit the real thumb at the start of each axis, then drag to its end.
        for (const id of ['page','model','read']) {
          const rect = await page.evaluate(`(()=>{const e=document.getElementById('${id}');e.scrollTop=0;e.scrollLeft=0;
            const r=e.getBoundingClientRect();return {x:r.right-3,y:r.top+8,left:r.left,right:r.right,bottom:r.bottom};})()`);
          await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
          await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.x,y:rect.y,button:'left',clickCount:1});
          await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.x,y:rect.bottom+80,button:'left',buttons:1});
          await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.x,y:rect.bottom+80,button:'left',clickCount:1});
          await page.evaluate('new Promise(r=>setTimeout(r,80))');
          assert.equal(await page.evaluate(`(()=>{const e=document.getElementById('${id}');return Math.abs(e.scrollTop-(e.scrollHeight-e.clientHeight))<1})()`),true,`${id} reaches bottom`);
          await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:rect.left+8,y:rect.bottom-3,button:'left',clickCount:1});
          await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:rect.right+80,y:rect.bottom-3,button:'left',buttons:1});
          await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:rect.right+80,y:rect.bottom-3,button:'left',clickCount:1});
          await page.evaluate('new Promise(r=>setTimeout(r,80))');
          assert.equal(await page.evaluate(`(()=>{const e=document.getElementById('${id}');return Math.abs(e.scrollLeft-(e.scrollWidth-e.clientWidth))<1})()`),true,`${id} reaches right`);
        }
        await page.evaluate(`document.body.setAttribute('data-ds-dark-theme','');document.getElementById('page').setAttribute('data-ccd-scrolling','')`);
        assert.equal(await page.evaluate(`getComputedStyle(document.getElementById('page'),'::-webkit-scrollbar-thumb').backgroundColor`),'rgb(145, 143, 137)');
        await page.evaluate('window.release()');
        assert.deepEqual(await page.evaluate('window.errors'), []);
      });
    } finally { await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
  }
});
