import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
let chrome;try{chrome=findChrome();}catch{}
test('scroll activity supports inserted and horizontal surfaces without overlays',{
  skip:chrome?false:'Chrome unavailable',timeout:30000,
},async()=>{
  const bundle=await build({stdin:{resolveDir:root,loader:'ts',contents:`
    import {mountScrollPills} from './src/client/compat/scroll-pill.ts';
    window.release=mountScrollPills(document,error=>{throw error});
  `},bundle:true,write:false,format:'iife'});
  const profile=await mkdtemp(join(tmpdir(),'ccd-scroll-activity-'));
  try{await withPage({url:'about:blank',width:500,height:400,profile},async page=>{
    await page.evaluate(bundle.outputFiles[0].text);
    await page.evaluate(`const e=document.createElement('div');e.id='late';e.style.cssText='width:100px;height:100px;overflow:auto';e.innerHTML='<div style="width:1000px;height:1000px"></div>';document.body.append(e);e.scrollLeft=100;`);
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    assert.equal(await page.evaluate(`document.getElementById('late').hasAttribute('data-ccd-scrolling')`),true);
    await page.evaluate('new Promise(r=>setTimeout(r,900))');
    assert.equal(await page.evaluate(`document.getElementById('late').hasAttribute('data-ccd-scrolling')`),false);
    await page.evaluate(`document.getElementById('late').dispatchEvent(new Event('scroll'));window.release()`);
    assert.equal(await page.evaluate(`document.querySelector('[data-ccd-scrolling],[data-ccd-scroll-layer],[data-ccd-scroll-thumb]')===null`),true);
  });}finally{await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
