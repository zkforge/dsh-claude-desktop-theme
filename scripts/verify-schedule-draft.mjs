#!/usr/bin/env node
/** Exercise native task buttons → async host-shaped hero → public draft facade.
 * The DOM markers are cross-checked against the installed ConversationContent.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { readAsar } from './lib/host-prefixes.mjs';
import { withPage } from './lib/headless-chrome.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, '.cache/schedule-draft-verification');
await mkdir(work, { recursive: true });
const files = readAsar(process.env.DSH_ASAR ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar', p => p.endsWith('/dsh-client-ui-conversation/lib/client.js'));
const host = [...files.values()][0]?.toString();
assert.ok(host?.includes('"data-content-phase": phase') && host.includes('"data-conversation-session": sessionId'), 'fixture markers match the installed ConversationContent');
const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
  import {mountSchedulePage} from './src/client/compat/schedule-page.ts';
  import {mountScheduleDraft,NEW_SCHEDULE_DRAFT} from './src/client/compat/schedule-draft.ts';
  window.expected=NEW_SCHEDULE_DRAFT;
  window.errors=[];
  window.sent=0;
  const bindingCtx={};
  let state={draft:'',attachmentIds:[],phase:'plain'};
  const input={state:{getSnapshot:()=>state},setDraft:text=>{
    state={...state,draft:text}; document.querySelector('[contenteditable=true]').textContent=text;
  },focus:()=>document.querySelector('[contenteditable=true]').focus(),submit:()=>window.sent++};
  const ctx={sessions:{binding:()=>({ctx:bindingCtx}),list:{getSnapshot:()=>({byId:{demo:{blank:true}}}),subscribe:()=>()=>{}}},
    inject:(_,callback)=>{callback({conversation:{input:{for:scope=>{if(scope!==bindingCtx)throw Error('wrong session');return input;}}},effect:()=>{}});return {dispose(){}};}};
  const draft=mountScheduleDraft(ctx,document,error=>window.errors.push(String(error)));
  const release=mountSchedulePage(document,error=>window.errors.push(String(error)),draft.prepare);
  for(const button of document.querySelectorAll('#top-new,#empty-new'))button.addEventListener('click',()=>{
    document.querySelector('[data-testid=task-manager-page]').remove();
    setTimeout(()=>{
      const wrapper=document.createElement('div');wrapper.dataset.phase='hero';
      wrapper.innerHTML='<div data-conversation-content data-conversation-session="demo" data-content-phase="settling"><div data-composer-seat><div contenteditable="true" data-phase="plain" tabindex="0"></div></div></div>';
      document.body.append(wrapper);
      setTimeout(()=>wrapper.querySelector('[data-conversation-content]').setAttribute('data-content-phase','hero'),30);
    },30);
  });
  window.release=()=>{release();draft.dispose();};
  window.draftText=()=>state.draft;
` }, bundle: true, write: false, format: 'iife' });
await withPage({url:'about:blank',width:1000,height:750,profile:join(work,'profile')},async page=>{
  for(const trigger of ['top-new','empty-new']) {
    await page.evaluate(`document.body.innerHTML='<section data-testid="task-manager-page"><div><div><div><h1>自动化任务</h1><div><button id="top-new">新建</button></div></div><div><div role="group"><button>全部</button></div></div><div><input placeholder="搜索"/></div><div><div role="status"><h2>还没有自动化任务，在会话中创建的任务会显示在这里</h2><button id="empty-new">新建自动化任务</button></div></div></div></div></section>'`);
    await page.evaluate(bundle.outputFiles[0].text);
    await page.evaluate(`document.getElementById(${JSON.stringify(trigger)}).click()`);
    await page.evaluate(`new Promise(resolve=>setTimeout(resolve,160))`);
    const facts=await page.evaluate(`({draft:window.draftText(),expected:window.expected,visible:document.querySelector('[contenteditable=true]').textContent,focused:document.activeElement===document.querySelector('[contenteditable=true]'),sent:window.sent,errors:window.errors})`);
    assert.equal(facts.draft,facts.expected);assert.equal(facts.visible,facts.expected);
    assert.equal(facts.focused,true);assert.equal(facts.sent,0);assert.deepEqual(facts.errors,[]);
    await page.evaluate('window.release()');
    console.log(trigger+': native click → delayed hero mount → exact draft visible and focused; nothing sent.');
  }
});
