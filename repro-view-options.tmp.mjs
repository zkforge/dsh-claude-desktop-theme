import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { findChrome, withPage } from '/Users/zoukai/code/dsh-claude-desktop-theme/scripts/lib/headless-chrome.mjs';

const root = '/Users/zoukai/code/dsh-claude-desktop-theme/';
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ViewOptionsCard} from './src/client/features/view-options/ViewOptionsCard.tsx';
    import {createViewOptionsDriver} from './src/client/compat/view-options.ts';

    // The host's own sidebar: a trigger and the menu it opens, drawn the shape
    // readCard() accepts (three groups, one check each).
    const hostRow = (label, checked) => {
      const wrap = document.createElement('div'); wrap.className = '_itemWrap_x';
      const button = document.createElement('button'); button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.innerHTML = '<span class="_itemLabel_4ub78_190">' + label + '</span>' + (checked ? '<svg class="_check_4ub78_179"></svg>' : '');
      button.addEventListener('click', () => { window.__hostChoices.push(label); document.body.removeChild(document.querySelector('._7514NG_viewOptionsMenu')); });
      wrap.append(button); return wrap;
    };
    window.__hostChoices = [];
    window.__hostOpens = 0;
    const trigger = document.getElementById('trigger');
    let hostMenu = null;
    trigger.addEventListener('click', () => {
      window.__hostOpens += 1;
      trigger.setAttribute('aria-expanded', String(hostMenu === null));
      if (hostMenu !== null) { hostMenu.remove(); hostMenu = null; return; }
      hostMenu = document.createElement('div'); hostMenu.className = '_7514NG_viewOptionsMenu';
      hostMenu.setAttribute('role', 'menu');
      const viewport = document.createElement('div'); viewport.setAttribute('role', 'presentation');
      const heading = (text) => { const h = document.createElement('div'); h.setAttribute('role', 'presentation'); h.textContent = text; return h; };
      viewport.append(heading('视图'));
      viewport.append(hostRow('按工作区', true), hostRow('按工作区树', false), hostRow('单列表', false));
      viewport.append(heading('排序'));
      viewport.append(hostRow('手动排序', true), hostRow('最近更新', false));
      viewport.append(heading('筛选'));
      viewport.append(hostRow('隐藏已归档', true), hostRow('全部', false), hostRow('已归档', false));
      hostMenu.append(viewport);
      document.body.append(hostMenu);
    });

    const driver = createViewOptionsDriver(document, error => { window.__errors.push(String(error)); });
    window.__errors = [];
    window.__driver = driver;
    const root = createRoot(document.getElementById('overlay'));
    let groupByStatus = false;
    const render = () => {
      root.render(React.createElement(ViewOptionsCard, {
        port: driver.port, showEmptyGroups: false, setShowEmptyGroups() {},
        groupByStatus, setGroupByStatus: value => { groupByStatus = value; render(); },
      }));
    };
    driver.port.subscribe(render);
    render();
    window.__ready = true;
  ` },
  bundle: true, write: false, format: 'iife', jsx: 'automatic',
});
const styles = (await Promise.all([
  'src/client/theme/tokens.css', 'src/client/theme/menus.css',
  'src/client/features/view-options/view-options.css',
].map(path => readFile(join(root, path), 'utf8')))).join('\n');

const profile = await mkdtemp(join(tmpdir(), 'ccd-repro-'));
try {
  await withPage({ url: 'about:blank', width: 1000, height: 650, scale: 2, profile }, async page => {
    page.events.set('Runtime.exceptionThrown', [p => console.log('EXC', p.exceptionDetails.exception?.description)]);
    await page.send('Runtime.enable');
    await page.evaluate(`document.documentElement.lang='zh';document.documentElement.setAttribute('data-dsh-ccd-style','true');document.body.innerHTML='<div class="_7514NG_sectionHeader" style="position:fixed;left:300px;top:80px"><button id="trigger" class="_7514NG_iconButton _7514NG_wide" aria-label="视图选项" style="width:28px;height:28px">视图</button></div><div id="overlay"></div>';const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);`);
    await page.evaluate(bundle.outputFiles[0].text);
    await page.evaluate('new Promise(r=>setTimeout(r,100))');
    console.log('ready:', await page.evaluate('window.__ready'));

    const pause = ms => page.evaluate(`new Promise(r=>setTimeout(r,${ms}))`);
    const point = sel => page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const move = async p => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p }); await pause(60); };

    // The reader clicks the trigger: the driver reads the host's card, then draws its own.
    const t = await point('#trigger');
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...t, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...t, button: 'left', clickCount: 1 });
    await pause(400);
    console.log('card open:', await page.evaluate('!!document.querySelector("[data-ccd-view-options]")'));
    console.log('host opens so far:', await page.evaluate('window.__hostOpens'));

    // Hover "状态" — the row the reader says freezes it.
    await move(await point('[data-ccd-view-row="2"]'));
    await pause(300);
    console.log('submenu:', await page.evaluate('!!document.querySelector(".ccd-view-submenu")'));
    console.log('host opens after hover:', await page.evaluate('window.__hostOpens'));

    // Move inside the submenu.
    const opt = await point('[data-ccd-view-option="2-0"]');
    await move(opt);
    await pause(300);
    console.log('host opens after submenu move:', await page.evaluate('window.__hostOpens'));

    // Now the reported gesture: select 状态, then move the pointer.
    const st = await point('[data-ccd-view-row="0"]');
    await move(st);
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...st, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...st, button: 'left', clickCount: 1 });
    await pause(500);
    console.log('host opens after selecting 状态:', await page.evaluate('window.__hostOpens'));
    console.log('card still open:', await page.evaluate('!!document.querySelector("[data-ccd-view-options]")'));

    // Leave the host's own menu open too, the way the real app does.
    await page.evaluate(`document.getElementById('trigger').click();document.getElementById('trigger').click()`);
    await pause(300);
    console.log('host menu present:', await page.evaluate('!!document.querySelector("._7514NG_viewOptionsMenu")'));
    console.log('host opens after re-open:', await page.evaluate('window.__hostOpens'));

    // The freeze: any pointer move now.
    const probe = page.evaluate('new Promise(r=>{let n=0;const t=setInterval(()=>{n++},10);setTimeout(()=>{clearInterval(t);r(n)},1000)})');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 500, y: 400 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 520, y: 420 });
    const ticks = await Promise.race([probe, pause(4000).then(() => 'STUCK')]);
    console.log('timer ticks in 1s after moving:', ticks);
    console.log('errors:', await page.evaluate('window.__errors'));
  });
} finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
