import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { findChrome, withPage } from './scripts/lib/headless-chrome.mjs';

const root = process.cwd() + '/';
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import {mountStatusGroups} from './src/client/compat/status-groups.ts';
    const ctx = {
      sessions: { list: {
        getSnapshot: () => ({ byId: {} }),
        subscribe: () => () => {},
      } },
      uiSession: { sessionStatus: { getSnapshot: () => new Map(), subscribe: () => () => {} } },
      uiWorkspace: { openSession() {} },
    };
    window.__mount = () => mountStatusGroups(document, ctx, true, error => window.__errors.push(String(error)));
    window.__errors = [];
  ` },
  bundle: true, write: false, format: 'iife',
});

const profile = await mkdtemp(join(tmpdir(), 'ccd-repro-status-'));
try {
  await withPage({ url: 'about:blank', width: 1000, height: 650, scale: 2, profile }, async page => {
    await page.send('Runtime.enable');
    page.events.set('Runtime.exceptionThrown', [p => console.log('EXC', p.exceptionDetails.exception?.description)]);
    const rows = Array.from({ length: 12 }, (_, i) =>
      `<div data-row-key="session:s${i}"><span>session ${i}</span></div>`).join('');
    await page.evaluate(`document.documentElement.lang='zh';
      document.body.innerHTML='<div class="_7514NG_listArea"><div class="_7514NG_flatList">${rows}</div></div>';`);
    await page.evaluate(bundle.outputFiles[0].text);
    await page.evaluate('window.__dispose = window.__mount()');
    await page.evaluate('new Promise(r=>setTimeout(r,100))');
    console.log('ordered:', await page.evaluate(`document.querySelectorAll('[data-ccd-status-order]').length`));
    console.log('headings:', await page.evaluate(`document.querySelectorAll('[data-ccd-status-owned]').length`));

    // The gesture: hover rows while the sidebar is grouped by status.
    const probe = page.evaluate('new Promise(r=>{let n=0;const t=setInterval(()=>{n++},10);setTimeout(()=>{clearInterval(t);r(n)},1000)})');
    for (let i = 0; i < 12; i += 1) {
      await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 100, y: 40 + i * 30 });
    }
    const ticks = await Promise.race([probe, new Promise(r => setTimeout(() => r('STUCK'), 5000))]);
    console.log('timer ticks:', ticks);

    // Now mutate the list the way a hovered row does (class/attribute churn).
    const probe2 = page.evaluate('new Promise(r=>{let n=0;const t=setInterval(()=>{n++},10);setTimeout(()=>{clearInterval(t);r(n)},1000)})');
    await page.evaluate(`(()=>{const row=document.querySelector('[data-row-key="session:s0"]');for(let i=0;i<20;i++)row.classList.toggle('hover')})()`);
    const ticks2 = await Promise.race([probe2, new Promise(r => setTimeout(() => r('STUCK'), 5000))]);
    console.log('timer ticks after class churn:', ticks2);
    console.log('errors:', await page.evaluate('window.__errors'));
  });
} finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
