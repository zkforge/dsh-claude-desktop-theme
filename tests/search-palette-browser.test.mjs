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

/* The real component over a fake port: the modal card, its keyboard model and
   the host calls each row makes. */
test('the search palette opens as a modal card and drives the host from the keyboard', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage',
  timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {SearchPalette} from './src/client/features/search-palette/SearchPalette.tsx';
      const day = 86400000, at = Date.now();
      const snapshot = {
        sessions: [
          {id:'a',title:'展开菜单样式调整',workspace:'dsh',updatedAt:at-1000,running:false,archived:false,pinned:false},
          {id:'b',title:'工作树按钮布局调整',workspace:'dsh',updatedAt:at-2*day,running:false,archived:false,pinned:false},
          {id:'c',title:'你好',workspace:null,updatedAt:at-3*day,running:true,archived:false,pinned:false},
        ],
        projects: [{id:'w1',title:'dsh',path:'/Users/me/code/dsh',sessions:3}],
        schedules: [{id:'t1',sessionId:'c',title:'喝水',prompt:'提醒我喝水',rule:{kind:'daily',time:'09:51:00.000'},active:true,lastRunAt:at-1500}],
      };
      window.calls = [];
      const record = (...call) => { window.calls.push(call); };
      const port = {
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
        refreshSchedules: () => record('refresh'),
        scheduleRuns: async id => ({count: 3, more: false}),
        searchContent: async query => { record('content', query); return query === '菜单' ? [{sessionId:'c',snippet:'…菜单的提交…'}] : []; },
        openSession: id => record('openSession', id),
        startSession: options => record('startSession', options),
        openSchedule: id => record('openSchedule', id),
        setPinned: async (id, pinned) => record('setPinned', id, pinned),
        setArchived: async (id, archived) => record('setArchived', id, archived),
        fork: async id => record('fork', id),
        copy: async text => record('copy', text),
      };
      let open = false; const listeners = new Set();
      const set = next => { if (open !== next) { open = next; listeners.forEach(listener => listener()); } };
      const state = {open:()=>set(true),close:()=>set(false),isOpen:()=>open,subscribe:l=>{listeners.add(l);return()=>listeners.delete(l);}};
      window.palette = state;
      createRoot(document.getElementById('overlay')).render(React.createElement(SearchPalette,{state,port,report:error=>{throw error;}}));
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/features/search-palette/search-palette.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-search-palette-test-'));
  try {
    await withPage({ url: 'about:blank', width: 1000, height: 660, scale: 1, profile }, async page => {
      await page.evaluate(`document.documentElement.lang='zh-CN';document.documentElement.dataset.platform='darwin';document.documentElement.setAttribute('data-dsh-ccd-style','true');document.body.style.margin='0';document.body.innerHTML='<button id="opener">搜索</button><div id="overlay" style="pointer-events:none"></div>';const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);`);
      await page.evaluate(bundle.outputFiles[0].text);
      const pause = (ms = 60) => page.evaluate(`new Promise(resolve=>setTimeout(resolve,${ms}))`);
      const codes = { Enter: 13, Escape: 27, Tab: 9, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Backspace: 8 };
      const key = async (value, modifiers = 0) => {
        const event = { key: value, code: value, windowsVirtualKeyCode: codes[value], modifiers };
        await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...event });
        await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
        await pause();
      };
      const type = async text => { await page.send('Input.insertText', { text }); await pause(); };
      const read = () => page.evaluate(`(() => {
        const dialog = document.querySelector('.ccd-search-palette');
        const box = selector => { const node = dialog.querySelector(selector); if (!node) return null; const r = node.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; };
        return {
          open: dialog.open, modal: dialog.matches(':modal'),
          focused: document.activeElement === dialog.querySelector('input'),
          query: dialog.querySelector('input')?.value ?? null,
          tab: dialog.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? null,
          headings: Array.from(dialog.querySelectorAll('.ccd-search-palette-heading'), node => node.textContent),
          rows: Array.from(dialog.querySelectorAll('[role="option"]'), node => node.dataset.key),
          labels: Array.from(dialog.querySelectorAll('[role="option"] .ccd-search-palette-label'), node => node.textContent),
          selected: dialog.querySelector('[role="option"][aria-selected="true"]')?.dataset.key ?? null,
          marks: Array.from(dialog.querySelectorAll('mark'), node => node.textContent),
          metas: Array.from(dialog.querySelectorAll('.ccd-search-palette-meta'), node => node.textContent),
          menu: Array.from(dialog.querySelectorAll('[role="menuitem"]'), node => node.textContent),
          card: (() => { const r = dialog.getBoundingClientRect(); return {width: dialog.offsetWidth, height: dialog.offsetHeight, y: r.y}; })(), row: box('[role="option"]'),
          footer: box('.ccd-search-palette-footer'), divider: box('.ccd-search-palette-tabs'),
        };
      })()`);
      const calls = async () => { const value = await page.evaluate('window.calls.filter(call => call[0] !== "refresh" && call[0] !== "content")'); await page.evaluate('window.calls = []'); return value; };
      /* Past the 140ms entrance, so boxes are read unscaled. */
      const openPalette = async () => { await page.evaluate('window.palette.open()'); await pause(220); await page.evaluate('window.calls = []'); };

      await openPalette();
      let view = await read();
      assert.equal(view.modal, true, 'the card is a modal dialog');
      assert.equal(view.focused, true, 'the field takes focus');
      assert.equal(view.tab, '全部');
      assert.deepEqual(view.headings, ['最近使用', '操作']);
      assert.deepEqual(view.rows, ['session:a', 'schedule:t1', 'session:b', 'session:c', 'action:new']);
      assert.deepEqual(view.labels.slice(0, 2), ['展开菜单样式调整', '喝水 · 每天 9:51']);
      assert.equal(view.selected, 'session:a', 'the first row is current');
      assert.deepEqual(view.metas, ['3 次运行'], 'recent Sessions carry no meta; the task carries its run count');
      assert.equal(Math.round(view.card.width), 540);
      assert.equal(Math.round(view.card.height), 468);
      assert.equal(Math.round(view.row.height), 29);
      assert.equal(Math.round(view.footer.height), 32);
      assert(Math.abs(view.divider.y + view.divider.height - view.card.y - 81) <= 1, 'the header closes 81px down');

      await key('ArrowDown');
      await key('ArrowDown');
      assert.equal((await read()).selected, 'session:b');
      await key('ArrowUp');
      await key('Enter');
      assert.deepEqual(await calls(), [['openSchedule', 't1']]);
      assert.equal((await read()).open, false, 'opening a row closes the card');

      await openPalette();
      await type('菜单');
      await pause(260);
      view = await read();
      assert.deepEqual(view.headings, ['会话', '操作']);
      assert.deepEqual(view.rows, ['session:a', 'session:c', 'action:new'], 'content hits follow title matches');
      assert.deepEqual(view.marks, ['菜单']);
      await key('Tab');
      assert.deepEqual(await calls(), [['startSession', { prompt: '菜单' }]], 'Tab composes a New Session from the query');

      await openPalette();
      await key('ArrowRight');
      view = await read();
      assert.equal(view.tab, '会话', '→ on an empty field switches type');
      assert.deepEqual(view.rows, ['session:a', 'session:b', 'session:c']);
      assert.deepEqual(view.metas.slice(-1), ['运行中']);
      await key('ArrowRight');
      await key('ArrowRight');
      assert.equal((await read()).tab, '定时任务');
      await key('Backspace');
      assert.equal((await read()).tab, '全部', 'Backspace on an empty field returns to 全部');

      await type('/');
      view = await read();
      assert.deepEqual(view.headings, ['筛选条件']);
      assert.deepEqual(view.labels, ['全部', '会话', '项目', '定时任务']);
      await type('项');
      await key('Enter');
      view = await read();
      assert.equal(view.tab, '项目');
      assert.equal(view.query, '');
      assert.deepEqual(view.rows, ['project:w1']);
      await key('Enter');
      assert.deepEqual(await calls(), [['startSession', { workspaceId: 'w1' }]]);

      await openPalette();
      await key('Enter', 1);
      view = await read();
      assert.deepEqual(view.menu, ['打开↵', '置顶', '创建分支', '归档'], '⌥↵ opens the current row’s menu');
      await key('ArrowDown');
      await key('Enter');
      assert.deepEqual(await calls(), [['setPinned', 'a', true]]);
      view = await read();
      assert.equal(view.open, true, 'a list edit keeps the card open');
      assert.deepEqual(view.menu, []);

      await key('Enter', 1);
      await key('Escape');
      view = await read();
      assert.deepEqual(view.menu, [], 'Esc closes the menu first');
      assert.equal(view.open, true);
      await key('Escape');
      assert.equal((await read()).open, false, 'a second Esc closes the card');

      await openPalette();
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 20, y: 640, button: 'left', clickCount: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 20, y: 640, button: 'left', clickCount: 1 });
      await pause();
      assert.equal((await read()).open, false, 'a click on the backdrop closes the card');
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});
