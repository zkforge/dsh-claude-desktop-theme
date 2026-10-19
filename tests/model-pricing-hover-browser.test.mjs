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
try { chrome = findChrome(); } catch { /* Browser checks require installed Chrome. */ }

test('pricing details wait for deliberate hover and stay closed after model selection', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ModelControls} from './src/client/features/model-controls/ModelControls.tsx';
      Date.now=()=>Date.parse('2026-10-20T05:42:00Z');
      function Fixture(){
        const [directory,setDirectory]=useState({
          current:{provider:'deepseek-official',model:'deepseek-flash'},
          groups:[{id:'deepseek-official',name:'DeepSeek',models:[{id:'deepseek-flash',name:'Flash'},{id:'deepseek-v4-pro',name:'Pro'}]}],
          pending:null,failures:[],error:null,status:'ready',routable:true,
        });
        async function select(selection){
          setDirectory(previous=>({...previous,pending:selection,status:'selecting'}));
          await new Promise(resolve=>setTimeout(resolve,60));
          setDirectory(previous=>({...previous,current:selection,pending:null,status:'ready'}));
          return {ok:true};
        }
        return <ModelControls showModelIcons={false} locked={false} available={true}
          useDirectory={()=>directory} load={()=>{}} select={select} selectEffort={()=>{}} t={key=>key}/>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    `}, bundle:true, write:false, format:'iife', jsx:'automatic',
  });
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/features/model-controls/controls.css',
  ].map(path=>readFile(join(root,path),'utf8')))).join('\n');
  const profile=await mkdtemp(join(tmpdir(),'ccd-pricing-hover-'));
  try {
    await withPage({url:'about:blank',width:800,height:700,profile},async page=>{
      await page.evaluate(`document.documentElement.setAttribute('data-dsh-ccd-style','true');
        document.body.innerHTML='<div id="root" style="position:absolute;left:400px;top:600px"></div>';
        const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);`);
      await page.evaluate(bundle.outputFiles[0].text);
      const wait = ms=>page.evaluate(`new Promise(resolve=>setTimeout(resolve,${ms}))`);
      const tooltip = ()=>page.evaluate(`!!document.querySelector('.ccd-price-tooltip:popover-open')`);
      const point = selector=>page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      const move = point=>page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      const click = async point=>{
        await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
        await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
      };
      await wait(80);
      const trigger=await point('[data-ccd-model-trigger]');
      await move(trigger);
      await wait(400);
      assert.equal(await tooltip(),false,'passing over the trigger does not immediately show prices');
      await click(trigger);
      await wait(100);
      assert.equal(await tooltip(),false,'mouse focus from opening the model menu does not show prices');
      const row=await point('.ccd-price-anchor-row:last-child [data-model-option]');
      await move(row);
      await wait(300);
      await click(row);
      await wait(1100);
      assert.equal(await page.evaluate(`document.querySelector('.ccd-model-panel')===null`),true);
      assert.equal(await tooltip(),false,'selection and restored trigger focus never reopen prices');
      await move({x:0,y:0});
      await wait(150);
      await move(await point('[data-ccd-model-trigger]'));
      await wait(900);
      assert.equal(await tooltip(),true,'a fresh deliberate hover still opens prices');
    });
  } finally { await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});
