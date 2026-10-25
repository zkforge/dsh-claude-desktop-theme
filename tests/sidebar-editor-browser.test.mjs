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

const glyph = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M2 8H14"/></svg>';
const row = (label, art = glyph) => `<button class="_3WPZCG_panelRow" aria-label="${label}"><span class="_3WPZCG_panelGlyph" aria-hidden="true"><div data-slot="sidebar.panellist" style="display:contents">${art}</div></span><span class="_3WPZCG_panelTitle">${label}</span></button>`;
/* The Theme row's slot glyph as `ThemePanelGlyph` renders it: a sized box. */
const themeGlyph = '<span class="ccd-theme-panel-glyph" data-ccd-theme-glyph="" style="width:16px;height:16px"><svg viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="9"/></svg></span>';
/* SidebarRoot's stack: New Session, one PanelRow per panel and the More launcher. */
const fixture = `<div class="_3WPZCG_root">
<button id="new" class="_3WPZCG_newSession" aria-label="新建会话"><span class="_3WPZCG_newSessionContent">${glyph}<span class="_3WPZCG_newSessionLabel">新会话</span></span></button>
<nav class="_3WPZCG_panelList">${row('插件')}${row('自动化任务')}${row('主题', themeGlyph)}<div class="_3WPZCG_moreAnchor"><button id="more" class="_3WPZCG_panelRow" aria-label="更多" aria-haspopup="menu" aria-expanded="false"><span class="_3WPZCG_panelGlyph" aria-hidden="true">${glyph}</span><span class="_3WPZCG_panelTitle">更多</span></button></div></nav>
</div>`;

test('Edit sidebar opens from the More card, hides panels and lists them at the head of the card', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage',
  timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {mountSidebarNavigation} from './src/client/compat/sidebar-navigation.ts';
      import {mountSidebarPanelRows} from './src/client/compat/sidebar-editor.ts';
      import {menuRowClasses} from './src/client/compat/host-dom.ts';
      import {SIDEBAR_NAVIGATION_ICONS} from './src/client/features/sidebar/navigation-icons.ts';
      import {SidebarEditor} from './src/client/features/sidebar-editor/SidebarEditor.tsx';
      import {EditSidebarRow, HiddenPanelRows} from './src/client/features/sidebar-editor/MoreCardRows.tsx';
      import {createEditorState, createHiddenPanels} from './src/client/features/sidebar-editor/state.ts';
      window.errors = []; window.calls = [];
      const report = error => window.errors.push(String(error));
      const panels = [{id:'plugins',label:'自定义'},{id:'schedules',label:'定时任务'},{id:'ccd-theme',label:'主题'}];
      const port = {
        panels: () => panels, subscribe: () => () => {}, active: () => 'plugins',
        select: id => window.calls.push(['select', id]),
      };
      /* about:blank has no storage of its own. */
      const memory = new Map();
      window.storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
      const hidden = createHiddenPanels(window.storage);
      const state = createEditorState();
      window.releaseNavigation = mountSidebarNavigation(document, SIDEBAR_NAVIGATION_ICONS, report);
      const rows = mountSidebarPanelRows(document, port, hidden, report);
      window.releaseRows = rows.dispose;
      createRoot(document.getElementById('overlay')).render(React.createElement(SidebarEditor,{state,hidden,port,glyph:rows.glyph}));
      /* PanelMoreMenu's list: the plugin's rows around entry-customization's two. */
      const card = createRoot(document.getElementById('card'));
      const classes = menuRowClasses(document);
      const onDismiss = () => window.calls.push(['dismiss']);
      window.renderCard = () => flushSync(() => card.render(React.createElement(React.Fragment, null,
        React.createElement(HiddenPanelRows,{hidden,port,classes,onDismiss}),
        React.createElement('button',{role:'menuitem'},'浏览插件…'),
        React.createElement('button',{role:'menuitem'},'创建插件…'),
        React.createElement(EditSidebarRow,{state,classes,onDismiss}))));
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/features/sidebar/navigation.css',
    'src/client/features/settings/settings.css', 'src/client/features/sidebar-editor/sidebar-editor.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const host = '._3WPZCG_panelList{display:flex;flex-direction:column;gap:2px;width:240px}._3WPZCG_panelRow{display:flex;align-items:center;gap:8px;height:28px;padding:0 8px}._3WPZCG_panelGlyph{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px}';
  const profile = await mkdtemp(join(tmpdir(), 'ccd-sidebar-editor-test-'));
  try {
    await withPage({ url: 'about:blank', width: 1000, height: 700, scale: 1, profile }, async page => {
      await page.evaluate(`document.documentElement.lang='zh-CN';document.documentElement.setAttribute('data-dsh-ccd-style','true');document.body.style.margin='0';document.body.innerHTML=${JSON.stringify(fixture)}+'<div id="overlay" style="pointer-events:none"></div><div id="card" role="menu"></div>';const style=document.createElement('style');style.textContent=${JSON.stringify(`${styles}${host}`)};document.head.append(style);`);
      await page.evaluate(bundle.outputFiles[0].text);
      const pause = (ms = 60) => page.evaluate(`new Promise(resolve=>setTimeout(resolve,${ms}))`);
      const cardRows = () => page.evaluate(`Array.from(document.querySelectorAll('#card [role=menuitem], #card [role=separator]'), node => node.getAttribute('role') + ':' + node.textContent)`);
      await pause();

      // Rows are named by position; More keeps its word and takes three dots.
      assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('[data-ccd-panel]'), row => row.getAttribute('data-ccd-panel'))`), ['plugins', 'schedules', 'ccd-theme']);
      assert.deepEqual(await page.evaluate(`(() => {
        const more = document.querySelector('#more');
        return { nav: more.getAttribute('data-ccd-nav'), label: more.getAttribute('aria-label'),
          dots: more.querySelectorAll('[data-ccd-nav-glyph] circle').length,
          host: getComputedStyle(more.querySelector('._3WPZCG_panelGlyph > svg')).display };
      })()`), { nav: 'more', label: '更多', dots: 3, host: 'none' });

      // The palette sits in the Theme row's 16px seat like every other glyph:
      // the slot's own sized box leaves the seat instead of pushing it aside.
      assert.deepEqual(await page.evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll('[data-ccd-panel]'));
        const theme = rows.find(row => row.getAttribute('data-ccd-panel') === 'ccd-theme');
        const left = row => Math.round(row.querySelector('[data-ccd-nav-glyph]').getBoundingClientRect().left);
        return { nav: theme.getAttribute('data-ccd-nav'),
          slot: getComputedStyle(theme.querySelector('[data-ccd-theme-glyph]')).display,
          aligned: rows.every(row => left(row) === left(rows[0])) };
      })()`), { nav: 'theme', slot: 'none', aligned: true });

      // Nothing hidden: the card is the host's two rows, then 编辑侧边栏… after a separator.
      await page.evaluate('window.renderCard()');
      assert.deepEqual(await cardRows(), ['menuitem:浏览插件…', 'menuitem:创建插件…', 'separator:', 'menuitem:编辑侧边栏…']);
      await page.evaluate(`Array.from(document.querySelectorAll('#card [role=menuitem]')).at(-1).click()`);
      await pause();
      assert.deepEqual(await page.evaluate('window.calls'), [['dismiss']]);

      const dialog = () => page.evaluate(`(() => {
        const node = document.querySelector('.ccd-sidebar-editor');
        return { open: node.open, modal: node.matches(':modal'),
          title: node.querySelector('h2')?.textContent ?? null,
          focused: document.activeElement === node.querySelector('input'),
          rows: Array.from(node.querySelectorAll('.ccd-sidebar-editor-row'), row => [row.querySelector('.ccd-sidebar-editor-label').textContent, row.querySelector('input').checked, row.querySelector('.ccd-sidebar-editor-glyph svg') !== null]) };
      })()`);
      assert.deepEqual(await dialog(), {
        open: true, modal: true, title: '编辑侧边栏', focused: true,
        rows: [['自定义', true, true], ['定时任务', true, true], ['主题', true, true]],
      });

      // Unchecking a panel takes it out of the column at once and keeps the choice.
      await page.evaluate(`document.querySelectorAll('.ccd-sidebar-editor-row input')[1].click()`);
      await pause();
      assert.deepEqual(await page.evaluate(`(() => ({
        display: getComputedStyle(document.querySelector('[data-ccd-panel="schedules"]')).display,
        others: Array.from(document.querySelectorAll('[data-ccd-panel]:not([data-ccd-panel-hidden])'), row => row.getAttribute('data-ccd-panel')),
        stored: window.storage.getItem('ccd-sidebar-hidden'),
        checked: document.querySelectorAll('.ccd-sidebar-editor-row input')[1].checked,
      }))()`), { display: 'none', others: ['plugins', 'ccd-theme'], stored: '["schedules"]', checked: false });

      await page.evaluate(`document.querySelector('.ccd-sidebar-editor-done').click()`);
      await pause();
      assert.equal(await page.evaluate(`document.querySelector('.ccd-sidebar-editor').open`), false);

      // The card now leads with the hidden panel and a separator before the host's rows.
      await page.evaluate('window.renderCard()');
      assert.deepEqual(await cardRows(), [
        'menuitem:定时任务', 'separator:', 'menuitem:浏览插件…', 'menuitem:创建插件…', 'separator:', 'menuitem:编辑侧边栏…',
      ]);
      await page.evaluate(`document.querySelector('#card [role=menuitem]').click()`);
      assert.deepEqual(await page.evaluate('window.calls.slice(-2)'), [['dismiss'], ['select', 'schedules']]);

      // Releasing the module gives every row back to the column.
      await page.evaluate('window.releaseRows()');
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-panel], [data-ccd-panel-hidden]').length`), 0);
      assert.deepEqual(await page.evaluate('window.errors'), []);
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
