import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, PINNED_BUILD, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Local Chrome enables browser coverage. */ }

// Native SidebarRoot's structure: preserve each button, shortcut and slot.
const nativeSvg = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M2 8H14"/></svg>';
const fixture = `<main data-slot="root"><div class="_6Qf49G_frame"><div data-slot="sidebar"><div class="_3WPZCG_root">
<button id="new" class="_3WPZCG_newSession" aria-label="新建会话" aria-keyshortcuts="Meta+N"><span class="_3WPZCG_newSessionLabelMask"><span class="_3WPZCG_newSessionContent">${nativeSvg}<span class="_3WPZCG_newSessionLabel">新会话</span></span></span><span class="_3WPZCG_newSessionShortcut">⌘N</span></button>
<nav class="_3WPZCG_panelList">${[['plugins', '插件'], ['routines', '自动化任务'], ['other', '其他插件']].map(([id, label]) => `<button id="${id}" class="_3WPZCG_panelRow" aria-label="${label}"><span class="_3WPZCG_panelGlyph" aria-hidden="true"><div data-slot="sidebar.panellist" style="display:contents">${nativeSvg}</div></span><span class="_3WPZCG_panelTitle">${label}</span></button>`).join('')}</nav>
</div></div></div></main>`;

test('sidebar navigation survives host rerenders, locales and rail mode, then restores native controls', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 20000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, contents: `
      import {mountSidebarNavigation} from './src/client/compat/sidebar-navigation.ts';
      import {SIDEBAR_NAVIGATION_ICONS} from './src/client/features/sidebar/navigation-icons.ts';
      window.errors=[];
      window.mountNavigation=()=>window.releaseNavigation=mountSidebarNavigation(document,SIDEBAR_NAVIGATION_ICONS,error=>window.errors.push(String(error)));
    ` }, bundle: true, write: false, format: 'iife',
  });
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/features/sidebar/sidebar.css', 'src/client/features/sidebar/navigation.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const nativeStyles = `body{margin:0;background:var(--ccd-sidebar);font-family:system-ui}main{height:200px;width:264px;padding-top:16px}button{font:inherit;cursor:pointer}._3WPZCG_root{height:100%;box-sizing:border-box;display:flex;flex-direction:column}._3WPZCG_newSession{display:flex;align-items:center;position:relative;container-type:inline-size}._3WPZCG_newSessionLabelMask{flex:1;min-width:0}._3WPZCG_newSessionContent{display:flex;align-items:center;width:100cqw}._3WPZCG_newSessionShortcut{display:none}._3WPZCG_panelList{display:flex;flex-direction:column}._3WPZCG_panelRow{display:flex;align-items:center;gap:8px;background:transparent;border:0;font:inherit}._3WPZCG_panelGlyph{display:inline-flex;align-items:center;justify-content:center}._3WPZCG_collapsed ._3WPZCG_newSession,._3WPZCG_collapsed ._3WPZCG_panelRow{justify-content:center;width:36px;height:36px;padding:0}._3WPZCG_collapsed ._3WPZCG_panelTitle{display:none}`;
  for (const buildInfo of [PINNED_BUILD, WINDOWS_BUILD]) {
    const profile = await mkdtemp(join(tmpdir(), 'ccd-sidebar-navigation-test-'));
    try {
      await withPage({ url: 'about:blank', width: 300, height: 200, scale: 2, profile }, async page => {
        await page.evaluate(`document.documentElement.lang='zh';document.documentElement.dataset.platform=${JSON.stringify(buildInfo === WINDOWS_BUILD ? 'win32' : 'darwin')};document.documentElement.dataset.dshCcdStyle='true';document.body.innerHTML=${JSON.stringify(aliasHostClasses(fixture, buildInfo))};const style=document.createElement('style');style.textContent=${JSON.stringify(aliasHostClasses(nativeStyles + styles, buildInfo))};document.head.append(style);window.clicks=[];for(const button of document.querySelectorAll('button'))button.addEventListener('click',()=>window.clicks.push(button.id));window.originalButtons=[...document.querySelectorAll('button')];`);
        await page.evaluate(bundle.outputFiles[0].text);
        const settle = () => page.evaluate('new Promise(resolve=>setTimeout(resolve,0))');
        await page.evaluate(`window.nativeSidebar=document.querySelector('[data-slot=sidebar]>div');window.nativeSidebar.remove();window.mountNavigation()`);
        await settle();
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-nav-glyph]').length`), 0);
        await page.evaluate(`document.querySelector('[data-slot=sidebar]').append(window.nativeSidebar)`);
        await settle();
        assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('button')).map(el=>el.getAttribute('aria-label'))`), ['新建会话', '插件', '例程', '其他插件']);
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-nav-glyph]').length`), 3);
        assert.equal(await page.evaluate(`document.querySelector('#other').hasAttribute('data-ccd-nav')`), false);
        assert.equal(await page.evaluate(`document.querySelector('#new').getAttribute('aria-keyshortcuts')`), 'Meta+N');
        assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('[data-ccd-nav] svg')).filter(el=>!el.closest('[data-ccd-nav-glyph]')).map(el=>getComputedStyle(el).display)`), ['none', 'none', 'none']);
        for (const id of ['new', 'plugins', 'routines']) await page.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
        assert.deepEqual(await page.evaluate('window.clicks'), ['new', 'plugins', 'routines']);
        assert(await page.evaluate(`window.originalButtons.every(el=>el===document.getElementById(el.id))`));

        const point = await page.evaluate(`(()=>{const r=document.getElementById('routines').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
        await page.evaluate(`document.body.getBoundingClientRect();document.getAnimations().forEach(a=>a.finish())`);
        assert.match(await page.evaluate(`getComputedStyle(document.querySelector('.routine-long-hand')).transform`), /0\.707107/);
        await page.evaluate(`const tip=document.createElement('div');tip.setAttribute('role','tooltip');tip.textContent='自动化任务';document.body.append(tip)`);
        await settle();
        assert.equal(await page.evaluate(`document.querySelector('[role=tooltip]').textContent`), '例程');
        await page.evaluate(`document.querySelector('[role=tooltip]').remove()`);
        if (buildInfo === PINNED_BUILD) {
          await mkdir(join(root, 'artifacts'), { recursive: true });
          const screenshot = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 264, height: 100, scale: 1 } });
          await writeFile(join(root, 'artifacts/sidebar-navigation.png'), Buffer.from(screenshot.data, 'base64'));
        }

        await page.evaluate('window.releaseNavigation()');
        await settle();
        assert.equal(await page.evaluate(`document.querySelector('#new span span span').textContent`), '新会话');
        assert.equal(await page.evaluate(`document.getElementById('routines').lastElementChild.textContent`), '自动化任务');
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-nav], [data-ccd-nav-glyph]').length`), 0);
        await page.evaluate('window.mountNavigation()');
        await settle();
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-nav-glyph]').length`), 3);

        // Simulate a React commit that replaces the label and icon seat, not the button.
        await page.evaluate(`document.querySelector('#new [data-ccd-nav-glyph]').remove();document.querySelector('#new span span span:not([data-ccd-nav-glyph])').firstChild.data='新会话';document.getElementById('routines').setAttribute('aria-label','自动化任务');document.getElementById('routines').lastElementChild.firstChild.data='自动化任务';`);
        await settle();
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-nav-glyph]').length`), 3);
        assert.equal(await page.evaluate(`document.getElementById('routines').lastElementChild.textContent`), '例程');
        await page.evaluate(`document.documentElement.lang='en';document.getElementById('plugins').setAttribute('aria-label','Plugins');document.getElementById('plugins').lastElementChild.firstChild.data='Plugins';document.getElementById('routines').setAttribute('aria-label','Automation tasks');document.getElementById('routines').lastElementChild.firstChild.data='Automation tasks';document.querySelector('#new span span span:not([data-ccd-nav-glyph])').firstChild.data='New';document.getElementById('new').setAttribute('aria-label','New session');`);
        await settle();
        assert.equal(await page.evaluate(`document.getElementById('routines').getAttribute('aria-label')`), 'Routines');
        assert.equal(await page.evaluate(`document.getElementById('plugins').lastElementChild.textContent`), 'Plugins');
        await page.evaluate(`document.querySelector('[data-slot=sidebar]>div').classList.add(${JSON.stringify(aliasHostClasses('_3WPZCG_collapsed', buildInfo))});document.querySelector('#new span span span:not([data-ccd-nav-glyph])').remove();document.querySelectorAll('nav button').forEach(button=>button.lastElementChild.remove());document.querySelector('#new [data-ccd-nav-glyph]').remove();`);
        await settle();
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-nav-glyph]').length`), 3);
        assert.equal(await page.evaluate(`document.getElementById('routines').getAttribute('aria-label')`), 'Routines');
        await page.evaluate('window.releaseNavigation()');
        await settle();
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-nav], [data-ccd-nav-glyph]').length`), 0);
        assert.equal(await page.evaluate(`document.getElementById('routines').getAttribute('aria-label')`), 'Automation tasks');
        assert.deepEqual(await page.evaluate('window.errors'), []);
      });
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  }
});
