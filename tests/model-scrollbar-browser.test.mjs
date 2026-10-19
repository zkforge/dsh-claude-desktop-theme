import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Local Chrome enables browser coverage. */ }

test('model scrollbar allows a delayed grab, then hides without dismissing the popup', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage',
  timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, {useRef, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ModelPanel} from './src/client/features/model-controls/ModelControls.tsx';
      import {mountScrollPills} from './src/client/compat/scroll-pill.ts';
      mountScrollPills(document, error=>{throw error;});
      const state = {
        groups: [{id:'test', name:'Test', models:Array.from({length:60}, (_,i)=>({id:String(i), name:'Model '+i}))}],
        current:null, pending:null, failures:[], error:null, status:'ready', routable:true,
      };
      function Fixture() {
        const anchor = useRef(null);
        const [open, setOpen] = useState(false);
        return <><button ref={anchor} id="trigger" style={{position:'fixed',right:40,bottom:40}}
          onClick={()=>setOpen(true)}>Models</button>
          <button id="outside">Outside</button>
          {open && <ModelPanel anchor={anchor} state={state} disabled={false} load={()=>{}}
            t={key=>key} onClose={()=>setOpen(false)} onSelect={()=>{window.selected=true;}} />}</>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/theme/scrollbars.css',
    'src/client/features/model-controls/controls.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-model-scrollbar-'));
  try {
    await withPage({ url: 'about:blank', width: 800, height: 700, profile, hideScrollbars: false }, async page => {
      await page.evaluate(`document.documentElement.setAttribute('data-dsh-ccd-style','true');
        document.body.innerHTML='<div id="root" tabindex="-1"></div>';
        const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);`);
      await page.evaluate(bundle.outputFiles[0].text);
      const settle = () => page.evaluate('new Promise(resolve=>setTimeout(resolve,80))');
      await settle();
      await page.evaluate(`document.getElementById('trigger').click()`);
      await settle();
      const isOpen = () => page.evaluate(`!!document.querySelector('.ccd-model-panel:popover-open')`);
      assert.equal(await isOpen(), true);
      // A host focus sink is outside the popup but is not an outside press.
      await page.evaluate(`document.getElementById('root').focus()`);
      await settle();
      assert.equal(await isOpen(), true, 'host focus handoff must not dismiss the menu');
      const geometry = await page.evaluate(`(()=>{
        const el=document.querySelector('.ccd-model-options'), r=el.getBoundingClientRect();
        return {x:r.right-5, y:r.top+12, top:r.top, bottom:r.bottom, height:el.clientHeight, gutter:el.offsetWidth-el.clientWidth,
          ink:getComputedStyle(el,'::-webkit-scrollbar-thumb').getPropertyValue('--ccd-model-scroll-ink').trim()};
      })()`);
      assert.equal(geometry.gutter, 10, 'the actual native track has a 10px hit area');
      assert.equal(geometry.ink, 'transparent', 'thumb starts hidden');
      await page.evaluate(`document.querySelector('.ccd-model-options').scrollTop=1`);
      await settle();
      assert.notEqual(await page.evaluate(`getComputedStyle(document.querySelector('.ccd-model-options'),'::-webkit-scrollbar-thumb').getPropertyValue('--ccd-model-scroll-ink').trim()`),
        'transparent', 'scrolling reveals the thumb');
      await page.send('Input.dispatchMouseEvent', {type:'mousePressed',x:geometry.x,y:geometry.y,button:'left',clickCount:1});
      await page.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:geometry.x,y:geometry.y+180,button:'left',buttons:1});
      await page.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:geometry.x,y:geometry.y+180,button:'left',clickCount:1});
      await settle();
      assert.equal(await isOpen(), true, 'native thumb drag keeps the popup open');
      assert.ok(await page.evaluate(`document.querySelector('.ccd-model-options').scrollTop > 0`), 'native thumb drag scrolls the model list');
      assert.equal(await page.evaluate('!!window.selected'), false, 'scrollbar drag does not select a model');
      // The short visible thumb must still drag the complete content range.
      await page.evaluate(`document.querySelector('.ccd-model-options').scrollTop=0`);
      await settle();
      await page.send('Input.dispatchMouseEvent', {type:'mousePressed',x:geometry.x,y:geometry.y,button:'left',clickCount:1});
      await page.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:geometry.x,y:geometry.bottom+100,button:'left',buttons:1});
      await page.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:geometry.x,y:geometry.bottom+100,button:'left',clickCount:1});
      await settle();
      assert.equal(await page.evaluate(`(()=>{
        const list=document.querySelector('.ccd-model-options'), last=list.querySelector('[data-model-option]:last-child');
        return Math.abs(list.scrollTop-(list.scrollHeight-list.clientHeight))<1
          && list.style.getPropertyValue('--ccd-model-scroll-progress')==='1'
          && last.getBoundingClientRect().bottom<=list.getBoundingClientRect().bottom+1;
      })()`), true, 'drag reaches the bottom and fully exposes the last model');
      await page.send('Input.dispatchMouseEvent', {type:'mousePressed',x:geometry.x,y:geometry.bottom-12,button:'left',clickCount:1});
      await page.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:geometry.x,y:geometry.top-100,button:'left',buttons:1});
      await page.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:geometry.x,y:geometry.top-100,button:'left',clickCount:1});
      await settle();
      assert.equal(await page.evaluate(`(()=>{
        const list=document.querySelector('.ccd-model-options');
        return list.scrollTop===0 && list.style.getPropertyValue('--ccd-model-scroll-progress')==='0';
      })()`), true, 'drag reaches the top and resets the short thumb position');
      await page.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:400,y:30});
      await page.evaluate('new Promise(resolve=>setTimeout(resolve,900))');
      assert.notEqual(await page.evaluate(`getComputedStyle(document.querySelector('.ccd-model-options'),'::-webkit-scrollbar-thumb').getPropertyValue('--ccd-model-scroll-ink').trim()`),
        'transparent', 'thumb stays visible after the global idle timeout');
      await page.evaluate('new Promise(resolve=>setTimeout(resolve,1500))');
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.ccd-model-options'),'::-webkit-scrollbar-thumb').getPropertyValue('--ccd-model-scroll-ink').trim()`),
        'transparent', 'thumb hides after the extended model idle timeout');
      await page.evaluate(`document.querySelector('.ccd-model-search').focus()`);
      await page.send('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape'});
      await settle();
      assert.equal(await isOpen(), false, 'Escape still dismisses the menu');
      await page.evaluate(`document.getElementById('trigger').click()`);
      await settle();
      await page.send('Input.dispatchMouseEvent', {type:'mousePressed',x:20,y:20,button:'left',clickCount:1});
      await page.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:20,y:20,button:'left',clickCount:1});
      await settle();
      assert.equal(await isOpen(), false, 'outside pointer press still dismisses the menu');
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
