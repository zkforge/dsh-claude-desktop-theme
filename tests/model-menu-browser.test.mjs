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

test('one trigger opens four models, a hover effort slider and pinnable More models', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage',
  timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ModelControls} from './src/client/features/model-controls/ModelControls.tsx';
      const reasoning={defaultEffort:'low',efforts:[{id:'low',name:'Low'},{id:'high',name:'High'},{id:'max',name:'Max'}]};
      const models=Array.from({length:6},(_,i)=>({id:'m'+i,name:'Model '+i,reasoning}));
      function Fixture(){
        const [current,setCurrent]=useState({provider:'p',model:'m0',reasoningEffort:'max'});
        const [pending,setPending]=useState(null);
        window.selected=current;
        window.setPending=setPending;
        const state={current,groups:[{id:'p',name:'P',models}],status:pending?'selecting':'ready',pending,failures:[],error:null,routable:true};
        return <div style={{position:'fixed',right:300,bottom:40,width:240}}><ModelControls showModelIcons={false} locked={false} available={true}
          useDirectory={()=>state} load={()=>{}} t={key=>key}
          select={async next=>{setCurrent(next);return {ok:true};}}
          selectEffort={(route,effort)=>setCurrent({...route,reasoningEffort:effort})}/></div>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/features/model-controls/controls.css', 'src/client/features/model-controls/effort.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-model-menu-'));
  try {
    await withPage({ url: 'about:blank', width: 1000, height: 700, profile }, async page => {
      await page.evaluate(`document.documentElement.setAttribute('data-dsh-ccd-style','true');document.documentElement.lang='zh-CN';
        document.body.innerHTML='<div id="root"></div>';
        const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);`);
      await page.evaluate(bundle.outputFiles[0].text);
      const settle = (ms = 60) => page.evaluate(`new Promise(resolve=>setTimeout(resolve,${ms}))`);
      const hover = async selector => {
        const { x, y } = await page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        return { x, y };
      };
      await settle();
      assert.equal(await page.evaluate(`document.querySelectorAll('.ccd-effort-trigger').length`), 0, 'one trigger carries both values');
      assert.deepEqual(await page.evaluate(`(()=>{const e=document.querySelector('.ccd-model-effort');return [e.textContent,e.hasAttribute('data-peak')]})()`), ['最高', true]);
      await page.evaluate(`document.querySelector('[data-ccd-model-trigger]').click()`);
      await settle();
      const rows = () => page.evaluate(`[...document.querySelectorAll('.ccd-model-menu [data-model-option] .ccd-model-name-text')].map(e=>e.textContent)`);
      assert.deepEqual(await rows(), ['Model 0', 'Model 1', 'Model 2', 'Model 3']);

      await hover('[data-model-submenu="effort"]');
      await settle();
      assert.equal(await page.evaluate(`!!document.querySelector('.ccd-effort:popover-open')`), true, 'hover opens the slider');
      assert.equal(await page.evaluate(`(()=>{const c=document.querySelector('.ccd-model-menu').getBoundingClientRect(),e=document.querySelector('.ccd-effort .panel').getBoundingClientRect();return e.left>=c.right&&e.left-c.right<=8})()`), true, 'the slider sits beside the card');
      assert.equal(await page.evaluate(`document.activeElement.className`), 'ccd-model-options', 'hover keeps focus on the card');

      await hover('[data-model-submenu="more"]');
      await settle(30);
      assert.equal(await page.evaluate(`!!document.querySelector('.ccd-effort')`), false, 'hovering the next row swaps the flyout');
      const more = '.ccd-model-panel:not(.ccd-model-menu)';
      assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('${more} [data-model-option] .ccd-model-name-text')].map(e=>e.textContent)`), ['Model 4', 'Model 5']);
      assert.equal(await page.evaluate(`document.querySelector('${more} .ccd-model-pin').disabled`), true, 'a full card refuses a fifth pin');

      await page.evaluate(`document.querySelector('.ccd-model-menu .ccd-model-pin').click()`);
      await settle();
      assert.deepEqual(await rows(), ['Model 1', 'Model 2', 'Model 3']);
      await page.evaluate(`[...document.querySelectorAll('${more} .ccd-model-pin')].at(1).click()`);
      await settle();
      assert.deepEqual(await rows(), ['Model 1', 'Model 2', 'Model 3', 'Model 4'], 'a press in the flyout keeps the menu open');
      assert.equal(await page.evaluate(`document.querySelector('[data-model-submenu="more"] .ccd-model-value').textContent`), 'Model 0', 'the current model stays named when it leaves the four');

      /* A commit in flight changes nothing on screen, and a pin moves only the top edge. */
      const card = `(()=>{const r=document.querySelector('.ccd-model-menu').getBoundingClientRect();return {bottom:r.bottom,left:r.left,opacity:getComputedStyle(document.querySelector('.ccd-model-menu [data-model-option]')).opacity,chip:getComputedStyle(document.querySelector('[data-ccd-model-trigger]')).opacity}})()`;
      const resting = await page.evaluate(card);
      await page.evaluate(`window.setPending(window.selected)`);
      await settle();
      assert.deepEqual(await page.evaluate(card), resting, 'a pending selection neither dims nor moves the menu');
      await page.evaluate(`window.setPending(null)`);
      await settle();
      const flash = await page.evaluate(`new Promise(resolve=>{
        const panel=document.querySelector('.ccd-model-menu'), seen=[];
        const pin=panel.querySelector('.ccd-model-pin');
        pin.click();
        const sample=n=>{seen.push(panel.getBoundingClientRect().bottom);n?requestAnimationFrame(()=>sample(n-1)):resolve(seen)};
        requestAnimationFrame(()=>sample(4));
      })`);
      assert.deepEqual([...new Set(flash)], [resting.bottom], 'the bottom edge holds on every frame after a pin');
      assert.equal((await rows()).length, 3);

      await hover('.ccd-model-menu .ccd-model-row:nth-child(1)');
      await settle(30);
      assert.equal(await page.evaluate(`!!document.querySelector('${more}')`), false, 'a plain row closes the flyout at once');
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '2', text: '2' });
      await settle();
      assert.equal(await page.evaluate(`window.selected.model`), 'm3', 'a digit picks its row');
      assert.equal(await page.evaluate(`!!document.querySelector('.ccd-model-menu')`), false);
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 20, button: 'left', clickCount: 1 });
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
