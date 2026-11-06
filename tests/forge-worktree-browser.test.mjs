import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {aliasHostClasses,WINDOWS_BUILD} from '../src/client/compat/host-builds.ts';
import {findChrome,withPage} from '../scripts/lib/headless-chrome.mjs';
let chrome;try{chrome=findChrome()}catch{/* Chrome enables native UI coverage. */}
const pause=page=>page.evaluate('new Promise(resolve=>setTimeout(resolve,60))');

test('native forge owns worktree intent through null UI, requests, progress and service lifecycle',{
 skip:chrome?false:'Chrome unavailable',timeout:60000,
},async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
 import {mountWorkspaceControls} from './src/client/compat/workspace-controls.ts';
 import {mountHeroChips} from './src/client/compat/hero-chips.ts';
 import {createDomPort} from './src/client/compat/dom.ts';
 import {WorktreeToggle,CreationCard} from './tests/fixtures/rc22/forge-worktree.mjs';
 window.style=css=>createDomPort(document).mountStyles(css);
 window.start=()=>{
  window.calls={request:[],cancel:0,branches:0,send:0,stop:0,retry:0,withdraw:0};window.fetches=[];window.errors=[];
  window.fetch=async(url,init)=>{window.fetches.push({url:String(url),method:init?.method??'GET'});return Response.json({state:'ready'})};
  const original=async()=>{window.calls.send++;return{kind:'success'}};
  const conversation={sendSession:original,input:{for:()=>({notify(){}})}};
  window.originalSend=original;window.conversation=conversation;
  let native=true;const registrations=[];
  const ctx={conversation,sessions:{list:{getSnapshot:()=>({byId:{s1:{blank:true}}})},binding:()=>null},workspaces:{list:{getSnapshot:()=>({items:[{workspaceId:'w1',sessionIds:['s1']}]})}},
   get:name=>name==='remote.forgePanel'&&native?{}:undefined,
   inject(names,callback){let dispose,scopeEffects=[];const entry={names,run(){if(dispose||names.includes('remote.forgePanel')&&!native)return;const scope={...ctx,effect:fn=>{scopeEffects.push(fn())}};const returned=callback(scope);dispose=()=>{if(typeof returned==='function')returned();scopeEffects.reverse().forEach(stop=>stop?.());scopeEffects=[];dispose=undefined}},stop(){dispose?.()}};registrations.push(entry);entry.run();return{dispose(){entry.stop();registrations.splice(registrations.indexOf(entry),1)}}},
  };
  window.nativeService=enabled=>{native=enabled;for(const entry of [...registrations])if(entry.names.includes('remote.forgePanel'))enabled?entry.run():entry.stop()};
  const stopHero=mountHeroChips(document,error=>window.errors.push(String(error)));
  const stopControls=mountWorkspaceControls(ctx,document,()=> 'w1',error=>window.errors.push(String(error)));
  window.release=()=>{stopControls();stopHero()};
  let snapshot={state:null};const listeners=new Set();
  window.panel=state=>{snapshot={state};listeners.forEach(listener=>listener())};
  const usePanel=select=>select(React.useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener)},()=>snapshot));
  window.ready=()=>({worktree:{editable:true,blocker:null,request:null,creation:null},checkout:{state:'ready',checkout:{branch:'feature/a-very-long-demo-branch-name-with-many-parts',commit:'abc'}}});
  const face={usePanel,t:(key,args)=>args?.branch??({'worktree.label':'工作树','creation.cancel':'取消','creation.retry':'重试','creation.skip':'跳过'}[key]??key),
   request:from=>{window.calls.request.push(from);return new Promise(resolve=>{window.finishRequest=()=>{const next=structuredClone(snapshot.state);next.worktree.request={from};window.panel(next);resolve()}})},
   cancel:async()=>{window.calls.cancel++;const next=structuredClone(snapshot.state);next.worktree.request=null;window.panel(next)},
   branches:async()=>{window.calls.branches++;return{current:'main',branches:['main','feature/base']}}};
  const root=createRoot(document.querySelector('#native-option'));
  const progress=createRoot(document.querySelector('#native-progress'));
  window.creation=value=>flushSync(()=>progress.render(value?React.createElement(CreationCard,{creation:value,t:face.t,stop:()=>window.calls.stop++,retry:()=>window.calls.retry++,withdraw:()=>window.calls.withdraw++}):null));
  flushSync(()=>root.render(React.createElement(WorktreeToggle,face)));
  window.unmountNative=()=>{root.unmount();progress.unmount()};
 };
 `},bundle:true,write:false,format:'iife'});
 const nativeHero=aliasHostClasses(await readFile('tests/fixtures/rc22/hero.css','utf8'),WINDOWS_BUILD);
 const css=nativeHero+'\n'+(await Promise.all(['src/client/theme/tokens.css','src/client/theme/composer.css','src/client/theme/forge.css','tests/fixtures/rc22/primitives.css','tests/fixtures/rc22/forge.css'].map(path=>readFile(path,'utf8')))).join('\n');
 const profile=await mkdtemp(join(tmpdir(),'ccd-native-forge-'));
 try{await withPage({url:'about:blank',width:720,height:560,profile},async page=>{
  await page.evaluate(`document.documentElement.dataset.platform='win32';document.documentElement.dataset.dshCcdStyle='true';document.documentElement.lang='zh-CN';document.body.innerHTML='<div data-slot="root"><main class="mP3x-q_frame"><div class="an3WzG_body" data-conversation-session="s1"><div class="an3WzG_composerSeat" data-composer-seat><div class="an3WzG_composerStack an3WzG_composerHero"><div class="an3WzG_heroWorkspaceRow"><button class="WOwLGG_workspace" aria-haspopup="menu"><span class="WOwLGG_workspaceLabel">Demo project</span></button><span class="an3WzG_heroOptions"><span id="native-option"></span></span></div><div class="GRgSLq_root" data-composer-root><div class="GRgSLq_card" data-composer-card><div class="GRgSLq_scroll"><div class="GRgSLq_input">Demo draft</div></div><div class="GRgSLq_row"><div class="GRgSLq_tools"><div class="GRgSLq_modes"><div data-slot="conversation.input.permission"><button class="_86kJGG_trigger" data-permission>完全权限</button></div></div></div><button data-send>↑</button></div></div></div></div></div></div><div id="native-progress"></div></main></div>';${bundle.outputFiles[0].text};window.style(${JSON.stringify(css)});window.start()`);await pause(page);
  assert.equal(await page.evaluate('window.conversation.sendSession===window.originalSend'),true,'native service never wraps sendSession, even with null UI');
  assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]')`),null,'native null UI must not resurrect a fallback chip');
  assert.deepEqual(await page.evaluate('window.fetches'),[],'no legacy GET/POST when native service owns intent');
  await page.evaluate('window.panel(window.ready())');await pause(page);
  assert.equal(await page.evaluate(`document.querySelectorAll('[data-forge-worktree]').length`),1);
  for(const width of [720,360]){
   await page.send('Emulation.setDeviceMetricsOverride',{width,height:560,deviceScaleFactor:1,mobile:false});await pause(page);
   const layout=await page.evaluate(`(()=>{const root=document.querySelector('[data-forge-worktree]'),branch=root.querySelector('button'),permission=document.querySelector('[data-permission]'),r=root.getBoundingClientRect(),b=branch.getBoundingClientRect(),p=permission.getBoundingClientRect();return{height:r.height,branchWidth:b.width,permissionLeft:p.left,optionRight:r.right,permissionRight:p.right,reserved:getComputedStyle(document.querySelector('.an3WzG_composerStack')).getPropertyValue('--ccd-workspace-seat'),overflow:document.documentElement.scrollWidth>window.innerWidth}})()`);
   assert.ok(layout.height<=28,'native worktree stays in the single control row');assert.ok(layout.branchWidth<=160,'long branches truncate');assert.ok(layout.permissionLeft>=layout.optionRight,'measured forge row does not overlap permission in the real tools group');assert.ok(layout.permissionRight<=width,'native option leaves permission reachable');assert.equal(layout.overflow,false);
  }
  await page.evaluate(`document.querySelector('[data-forge-worktree] input').click()`);await pause(page);
  assert.equal(await page.evaluate(`document.querySelector('[data-forge-worktree] input').disabled`),true,'native pending request disables repeated intent changes');
  await page.evaluate('window.finishRequest()');await pause(page);
  await page.evaluate(`document.querySelector('[data-forge-worktree] button[aria-haspopup=menu]').click()`);await pause(page);
  await page.evaluate(`Array.from(document.querySelectorAll('[role=menuitem]')).find(node=>node.textContent==='feature/base').click()`);await pause(page);
  assert.equal(await page.evaluate('window.calls.request.at(-1)'),'feature/base');await page.evaluate('window.finishRequest()');await pause(page);
  await page.evaluate(`document.querySelector('[data-forge-worktree] input').click()`);await pause(page);assert.equal(await page.evaluate('window.calls.cancel'),1);
  await page.evaluate(`window.creation({state:'running',phase:'checkout',branch:'worktree-demo',from:'main',message:null,held:true})`);await pause(page);
  await page.evaluate(`Array.from(document.querySelectorAll('[data-forge-creation] button')).find(node=>node.textContent==='取消').click()`);assert.equal(await page.evaluate('window.calls.stop'),1);
  await page.evaluate(`window.creation({state:'failed',phase:'checkout',branch:'worktree-demo',from:'main',message:'demo failure',held:false})`);await pause(page);
  for(const dark of [false,true]){
   await page.evaluate(`document.body.toggleAttribute('data-ds-dark-theme',${dark})`);
   const point=await page.evaluate(`(()=>{const b=Array.from(document.querySelectorAll('[data-forge-creation] button')).find(n=>n.textContent==='重试'),r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   for(const state of ['hover','active']){
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});if(state==='active')await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
    const paint=await page.evaluate(`(()=>{const b=Array.from(document.querySelectorAll('[data-forge-creation] button')).find(n=>n.textContent==='重试'),s=getComputedStyle(b);return{background:s.backgroundColor,color:s.color,primary:b.classList.contains('_primary_1ulci_36')}})()`);
    assert.equal(paint.primary,true);
    const luminance=value=>value.match(/[\d.]+/g).slice(0,3).map(Number).map(channel=>{const s=channel/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
    const a=luminance(paint.background),b=luminance(paint.color);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,'retry primary contrast remains readable in both themes');
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:710,y:550});if(state==='active')await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:710,y:550});
   }
  }
  await page.evaluate(`Array.from(document.querySelectorAll('[data-forge-creation] button')).find(node=>node.textContent==='重试').click();Array.from(document.querySelectorAll('[data-forge-creation] button')).find(node=>node.textContent==='跳过').click()`);
  assert.deepEqual(await page.evaluate('[window.calls.retry,window.calls.withdraw]'),[1,1]);
  for(const state of [{...await page.evaluate('window.ready()'),worktree:{editable:false,blocker:null,request:null,creation:null}},null]){await page.evaluate(`window.panel(${JSON.stringify(state)})`);await pause(page);assert.equal(await page.evaluate(`document.querySelector('[data-forge-worktree]')`),null);assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]')`),null)}
  await page.evaluate('window.conversation.sendSession()');assert.equal(await page.evaluate('window.calls.send'),1);assert.deepEqual(await page.evaluate('window.fetches'),[]);
  await page.evaluate('window.nativeService(false)');await pause(page);
  assert.notEqual(await page.evaluate('window.conversation.sendSession===window.originalSend'),true,'legacy fallback is restored only after service withdrawal');
  assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-worktree-chip]').length`),1);
  await page.evaluate('window.nativeService(true)');await pause(page);
  assert.equal(await page.evaluate('window.conversation.sendSession===window.originalSend'),true);assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]')`),null);
  const before=await page.evaluate('window.fetches.length');await page.evaluate('window.release();window.nativeService(false)');await pause(page);
  assert.equal(await page.evaluate('window.fetches.length'),before,'dispose must not remount fallback');assert.equal(await page.evaluate('window.conversation.sendSession===window.originalSend'),true);
  await page.evaluate('window.unmountNative()');assert.deepEqual(await page.evaluate('window.errors'),[]);
 });}finally{await rm(profile,{recursive:true,force:true,maxRetries:6,retryDelay:150})}
});
