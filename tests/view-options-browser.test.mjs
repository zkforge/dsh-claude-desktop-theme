import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Browser coverage requires a local Chrome. */ }

// Exercise the actual React component, CSS clipping and hit testing. Source
// assertions cannot establish that a submenu outside a popover is clickable.
test('view-options flyouts support pointer crossing, clicks and one-step keyboard navigation', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage',
  timeout: 20000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {ViewOptionsCard} from './src/client/features/view-options/ViewOptionsCard.tsx';
      let root, state, listeners;
      window.openCard = (left = 300, top = 80, selected = 0) => {
        root?.unmount();
        const anchor = document.getElementById('trigger');
        anchor.style.left = left + 'px'; anchor.style.top = top + 'px';
        listeners = new Set();
        window.choices = [];
        state = {open:true,anchor,values:{groups:[
          {label:'分组方式',labels:['按工作区','按工作区树','单列表'],selected:0},
          {label:'排序方式',labels:['手动排序','最近更新'],selected:0},
          {label:'筛选会话',labels:['隐藏已归档','全部','已归档'],selected},
        ]}};
        const port = {
          getSnapshot:()=>state,
          subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
          close:()=>{state={...state,open:false};listeners.forEach(listener=>listener());},
          choose:async(group,index)=>{window.choices.push([group,index]);return true;},
        };
        root = createRoot(document.getElementById('overlay'));
        root.render(React.createElement(ViewOptionsCard,{port,showEmptyGroups:false,setShowEmptyGroups(){}}));
      };
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/theme/menus.css',
    'src/client/features/view-options/view-options.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-view-options-test-'));
  try {
    await withPage({ url: 'about:blank', width: 1000, height: 650, scale: 2, profile }, async page => {
      await page.evaluate(`document.documentElement.lang='zh';document.documentElement.setAttribute('data-dsh-ccd-style','true');document.body.innerHTML='<button id="trigger" aria-label="视图选项" style="position:fixed;width:28px;height:28px">视图</button><div id="overlay"></div>';const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);`);
      await page.evaluate(bundle.outputFiles[0].text);
      const pause = () => page.evaluate('new Promise(resolve=>setTimeout(resolve,70))');
      const point = (selector, edge = false) => page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:${edge ? 'r.right-2' : 'r.x+r.width/2'},y:r.y+r.height/2}})()`);
      const move = async p => { await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p }); await pause(); };
      const click = async p => {
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
        await pause();
      };
      const key = async value => {
        await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: value });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: value });
        await pause();
      };
      const open = async (left = 300) => {
        await move({ x: 5, y: 5 });
        await page.evaluate(`window.openCard(${left})`);
        await pause();
      };

      await open();
      assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('[data-ccd-view-row]'),row=>row.getAttribute('data-ccd-view-row'))`), ['2', '0', '1'], 'status precedes the grouping/sorting section');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-view-row="2"]').textContent`), '状态活跃');
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-view-options] > [role="separator"]').length`), 2);
      await move(await point('[data-ccd-view-row="0"]'));
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-view-row="0"]').getAttribute('aria-expanded')`), 'true');
      const option = await point('[data-ccd-view-option="0-1"]');
      assert.equal(await page.evaluate(`document.elementFromPoint(${option.x},${option.y})?.closest('[data-ccd-view-option]')?.getAttribute('data-ccd-view-option')`), '0-1', 'the flyout must paint and accept pointer input outside its parent');
      const geometry = await page.evaluate(`(()=>{const card=document.querySelector('[data-ccd-view-options]'),row=document.querySelector('[data-ccd-view-row="0"]'),sub=document.querySelector('.ccd-view-submenu');const a=card.getBoundingClientRect(),r=row.getBoundingClientRect(),b=sub.getBoundingClientRect();return{width:a.width,subWidth:b.width,gap:b.left-a.right,top:b.top-r.top,radius:getComputedStyle(sub).borderRadius,hover:getComputedStyle(row).backgroundColor};})()`);
      assert.equal(geometry.width, 200);
      assert.equal(geometry.subWidth, 128);
      assert.ok(geometry.gap >= 0 && geometry.gap <= 2, 'reference surfaces almost touch');
      assert.ok(Math.abs(geometry.top) <= 1, 'submenu aligns with the active row');
      assert.equal(geometry.radius, '10px');
      assert.equal(geometry.hover, 'rgb(245, 245, 245)', 'shared host hover rules preserve the sampled reference fill');
      // Cross the actual gap instead of jumping straight to the option.
      await move(await point('[data-ccd-view-row="0"]', true));
      const bridge = await page.evaluate(`(()=>{const r=document.querySelector('.ccd-view-submenu').getBoundingClientRect(),card=document.querySelector('[data-ccd-view-options]').getBoundingClientRect();return{x:(r.left+card.right)/2,y:r.top+12}})()`);
      await move(bridge);
      assert.equal(await page.evaluate(`!!document.querySelector('.ccd-view-submenu')`), true, 'crossing the hit bridge must keep the submenu open');
      await move(option);
      await click(option);
      assert.deepEqual(await page.evaluate('window.choices'), [[0, 1]]);
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-view-options]')`), false);

      // Hover happens before a physical click: clicking that row must not undo
      // the open caused by pointerenter.
      await open();
      const order = await point('[data-ccd-view-row="1"]');
      await move(order); await click(order);
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-view-row="1"]').getAttribute('aria-expanded')`), 'true');
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-view-option="1-1"]')`), true);
      await move(await point('[data-ccd-view-switch]'));
      assert.equal(await page.evaluate(`!!document.querySelector('.ccd-view-submenu')`), false, 'hovering a plain row dismisses the flyout');
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-view-options]')`), true, 'the main menu stays open');
      await move({x:5,y:5});
      await page.evaluate(`window.openCard(300,80,2)`); await pause();
      await move(await point('[data-ccd-view-row="2"]'));
      await move(await point('[data-ccd-view-action]'));
      assert.equal(await page.evaluate(`!!document.querySelector('.ccd-view-submenu')`), false, 'clear filters dismisses the flyout too');

      await open();
      await page.evaluate(`document.querySelector('[data-ccd-view-row="0"]').focus()`);
      await key('ArrowDown');
      assert.equal(await page.evaluate(`document.activeElement.getAttribute('data-ccd-view-row')`), '1', 'ArrowDown advances exactly one row');
      await key('ArrowRight');
      assert.equal(await page.evaluate(`document.activeElement.getAttribute('data-ccd-view-option')`), '1-0');
      await key('ArrowDown');
      assert.equal(await page.evaluate(`document.activeElement.getAttribute('data-ccd-view-option')`), '1-1');
      await key('ArrowLeft');
      assert.equal(await page.evaluate(`document.activeElement.getAttribute('data-ccd-view-row')`), '1');
      await key('Escape');
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-view-options]')`), false);

      await open(960);
      await move(await point('[data-ccd-view-row="2"]'));
      assert.equal(await page.evaluate(`document.querySelector('.ccd-view-submenu').getAttribute('data-ccd-flip')`), 'true');
      const archived = await point('[data-ccd-view-option="2-2"]');
      await move(archived); await click(archived);
      assert.deepEqual(await page.evaluate('window.choices'), [[2, 2]], 'the left-opening filter flyout keeps host option mapping');

      await page.evaluate(`document.body.setAttribute('data-ds-dark-theme','')`);
      await open();
      await move(await point('[data-ccd-view-row="2"]'));
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-ccd-view-row="2"]')).color`), 'rgb(240, 239, 236)');
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.ccd-view-submenu')).backgroundColor`), 'rgb(48, 48, 46)');
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
