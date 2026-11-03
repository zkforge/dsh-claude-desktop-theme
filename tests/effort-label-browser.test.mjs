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

test('a catalog refresh during the label swap leaves one tier on screen', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage',
  timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, {useRef, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {EffortPanel} from './src/client/features/model-controls/EffortPanel.tsx';
      const tiers=()=>['Low','Medium','High','Max'].map((name,id)=>({id:String(id),name}));
      function Fixture(){
        const anchor=useRef(null);
        const [choices,setChoices]=useState(tiers);
        const [selected,setSelected]=useState(1);
        window.refreshCatalog=()=>setChoices(tiers());
        return <><button ref={anchor} style={{position:'fixed',left:40,bottom:40}}>Anchor</button>
          <EffortPanel anchor={anchor} choices={choices} selected={selected} defaultIndex={1} disabled={false} busy={false} error={null}
            onCommit={setSelected} onClose={()=>{}}/></>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/features/model-controls/effort.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-effort-label-'));
  try {
    await withPage({ url: 'about:blank', width: 600, height: 400, profile }, async page => {
      await page.evaluate(`document.documentElement.setAttribute('data-dsh-ccd-style','true');
        document.body.innerHTML='<div id="root"></div>';
        const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);`);
      await page.evaluate(bundle.outputFiles[0].text);
      await page.evaluate(`new Promise(resolve=>setTimeout(resolve,60))`);
      await page.evaluate(`document.querySelector('.ccd-effort .range').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);
      await page.evaluate(`new Promise(resolve=>setTimeout(resolve,40))`);
      await page.evaluate(`window.refreshCatalog()`);
      await page.evaluate(`new Promise(resolve=>setTimeout(resolve,320))`);
      assert.deepEqual(await page.evaluate(`[...document.querySelectorAll('.level-stage > span')].map(e=>e.textContent)`), ['', 'High']);
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
