import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Optional locally, installed in CI. */ }

test('settings switch restores native process controls, folds and scrolling without disabling conversation styling', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ConfigPage} from './src/client/features/settings/ConfigPage.tsx';
      import {conversationFeature} from './src/client/features/conversation/index.ts';
      import {CleanupScope} from './src/client/core/cleanup.ts';
      import {adoptConfig} from './src/shared/config.ts';
      window.errors=[];
      const report=e=>window.errors.push(String(e));
      let config=adoptConfig({enabled:true}), snapshot={status:'ready',revision:0,value:config};
      const listeners=new Set();
      const form={getSnapshot:()=>snapshot,subscribe:l=>{listeners.add(l);return()=>listeners.delete(l);},
        mutate:async ops=>{
          const next=structuredClone(config);
          for(const op of ops){let target=next;for(const key of op.path.slice(0,-1))target=target[key];
            target[op.path.at(-1)]=op.value;}
          config=adoptConfig(next);
          snapshot={status:'ready',revision:snapshot.revision+1,value:config};
          remount();listeners.forEach(l=>l());return true;
        }};
      let scope;
      const dom={mountStyles:css=>{const style=document.createElement('style');
        style.textContent=css;style.dataset.testConversationStyle='';document.head.append(style);return()=>style.remove();}};
      function remount(){
        scope?.dispose();scope=new CleanupScope(report);
        conversationFeature.mount({config,dom,host:{slots:{inject:()=>()=>{}}},logger:{debug(){},error:report}},scope);
      }
      function NativeTurn(){
        const [open,setOpen]=useState(false),[step,setStep]=useState(false),[detailed,setDetailed]=useState(false);
        window.nativeFold=()=>setOpen(false);
        window.nativeDisplay=value=>{setDetailed(value);setOpen(value);};
        return <>
          <button data-turn-process="1" disabled={detailed} aria-expanded={open} onClick={e=>{e.currentTarget.focus();setOpen(!open);}}>Worked for 1m</button>
          <div id="process" hidden={!open} data-step-process="true">
            <div><button data-process-activity="true" aria-expanded={step} onClick={e=>{e.currentTarget.focus();setStep(!step);}}>Working steps</button></div>
            <div data-step-process-body="true" hidden={!step}>
              <p id="transition">Let me check the configuration.</p>
              <details id="tool"><summary>Read config.ts</summary>Tool output</details>
            </div>
          </div>
          <p id="answer">Final answer stays visible.</p>
          <button id="native-open" data-turn-process="2" aria-expanded="true">Native open turn</button>
        </>;
      }
      const chat=createRoot(document.getElementById('chat'));
      const settings=createRoot(document.getElementById('settings'));
      chat.render(<NativeTurn/>);settings.render(<ConfigPage form={form}/>);
      window.start=remount;
      window.release=()=>{scope?.dispose();chat.unmount();settings.unmount();};
    ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
  });
  const profile = await mkdtemp(join(tmpdir(), 'ccd-process-toggle-'));
  try {
    await withPage({ url: 'about:blank', width: 1392, height: 932, profile }, async page => {
      await page.evaluate(`
        document.documentElement.setAttribute('data-dsh-ccd-style','true');
        document.body.innerHTML='<textarea id="composer"></textarea><main id="chat"></main><div id="settings"></div>';
        const native=document.createElement('style');
        native.textContent='[data-step-process-body]{max-height:80px;overflow:auto}';document.head.append(native);
        window.settle=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      await page.evaluate('settle()');
      await page.evaluate("document.querySelector('#composer').focus();start();settle()");
      const state = () => page.evaluate(`(() => {
        const turn=document.querySelector('[data-turn-process="1"]');
        const body=document.querySelector('[data-step-process-body]');
        return {checked:document.querySelector('#ccd-settings-expand-conversation-process').getAttribute('aria-checked'),
          expanded:turn.getAttribute('aria-expanded'),turnDisplay:getComputedStyle(turn).display,
          step:document.querySelector('[data-process-activity]').getAttribute('aria-expanded'),
          stepDisplay:getComputedStyle(document.querySelector('[data-process-activity]').parentElement).display,
          maxHeight:getComputedStyle(body).maxHeight,overflow:getComputedStyle(body).overflow,
          processHidden:document.querySelector('#process').hidden,toolOpen:document.querySelector('#tool').open,
          nativeOpen:document.querySelector('#native-open').getAttribute('aria-expanded'),
          answerVisible:!!document.querySelector('#answer').getClientRects().length,
          styles:document.querySelectorAll('[data-test-conversation-style]').length};
      })()`);
      assert.deepEqual(await state(), {
        checked: 'true', expanded: 'true', turnDisplay: 'none', step: 'true', stepDisplay: 'none',
        maxHeight: 'none', overflow: 'visible', processHidden: false, toolOpen: false,
        nativeOpen: 'true', answerVisible: true, styles: 1,
      });
      assert.equal(await page.evaluate('document.activeElement.id'), 'composer');
      for (const enabled of [false, true, false]) {
        await page.evaluate("document.querySelector('#ccd-settings-expand-conversation-process').click();settle()");
        const actual = await state();
        assert.equal(actual.checked, String(enabled));
        assert.equal(actual.expanded, String(enabled));
        assert.equal(actual.step, String(enabled));
        assert.equal(actual.turnDisplay, enabled ? 'none' : 'inline-block');
        assert.equal(actual.stepDisplay, enabled ? 'none' : 'block');
        assert.equal(actual.maxHeight, enabled ? 'none' : '80px');
        assert.equal(actual.overflow, enabled ? 'visible' : 'auto');
        assert.equal(actual.processHidden, !enabled);
        assert.equal(actual.toolOpen, false, 'leaf tool details stay independent');
        assert.equal(actual.nativeOpen, 'true', 'native open choices are preserved');
        assert.equal(actual.styles, 1, 'conversation styling remains mounted');
        assert.equal(actual.answerVisible, true);
      }
      // Native display policy and user actions stay authoritative while off.
      await page.evaluate('nativeDisplay(true);settle()');
      assert.equal((await state()).expanded, 'true');
      await page.evaluate('nativeDisplay(false);settle()');
      await page.evaluate("document.querySelector('[data-turn-process=\"1\"]').click();settle()");
      assert.equal((await state()).expanded, 'true');
      await page.evaluate('nativeFold();settle()');
      assert.equal((await state()).expanded, 'false', 'native completion collapse is not reopened');
      assert.deepEqual(await page.evaluate('errors'), []);
      await page.evaluate('release();settle()');
      assert.equal(await page.evaluate('document.querySelectorAll("[data-test-conversation-style]").length'), 0);
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
