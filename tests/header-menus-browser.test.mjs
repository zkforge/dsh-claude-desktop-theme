import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, PINNED_BUILD, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Browser coverage is optional without Chrome. */ }
const css = (await Promise.all([
  'src/client/theme/tokens.css',
  'src/client/features/conversation/conversation.css',
  'src/client/features/conversation/header-actions/header-menus.css',
].map(path => readFile(join(root, path), 'utf8')))).join('\n');
const markup = `<div data-slot="root"><div class="_6Qf49G_frame"></div></div><aside></aside><main class="ST7X_W_root">
  <header class="ST7X_W_header"><div class="ST7X_W_titleRow"><div class="ST7X_W_titleCluster">
    <nav class="ST7X_W_crumbs"><span class="ST7X_W_crumbSeg"><span class="ST7X_W_crumb ST7X_W_crumbCurrent">问候</span></span></nav>
    <div class="ST7X_W_headerActions"></div></div><div class="ST7X_W_headerUtilities">
    <button data-ccd-header-view="terminal" onclick="calls.push('terminal')">Terminal</button>
    <button class="iq4beG_main" aria-label="VS Code" onclick="calls.push('open')">Open</button></div></div>
    <div class="ST7X_W_tabs" data-ccd-view-dock="sidebar" role="tablist"><button class="ST7X_W_tab" role="tab" aria-label="Chat" aria-selected="true" onclick="calls.push('chat')">Chat</button><button class="ST7X_W_tab" role="tab" aria-label="Trace" aria-selected="false" onclick="calls.push('trace')">Trace</button></div>
  </header><div data-conversation-session="s1"></div></main>`;
const hostCss = `@font-face{font-family:Geist;src:url('file://${root}/assets/fonts/Geist-Variable.ttf')}
html,body{margin:0;font-family:Geist,sans-serif}body{background:#fafaf9}
aside{position:fixed;inset:0 auto 0 0;width:113px;border-right:1px solid #e2e2e0}
main{margin-left:114px;min-height:300px;background:#fff}
.ST7X_W_crumbs,.ST7X_W_crumbSeg{display:flex;align-items:center;gap:4px;min-width:0}
.ST7X_W_crumb{font-weight:500;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
.ST7X_W_headerActions,.ST7X_W_headerUtilities{display:flex}
.ST7X_W_headerUtilities{display:none}
.ST7X_W_tabs{position:fixed!important;left:35.5px;right:auto!important;top:3px!important;margin:0!important}
button{font:inherit}`;
const menu = '[data-ccd-header-menu="session"]';
const project = '[data-ccd-header-menu="project"]';

test('header reference menus: geometry, real actions, keyboard, boundaries and cleanup on both builds', { skip: !chrome, timeout: 60000 }, async () => {
  const bundle = await build({
    stdin: { contents: `import { mountHeaderMenus } from './src/client/compat/header-menus.ts'; window.mount = mountHeaderMenus;`, resolveDir: root },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
  });
  for (const host of [PINNED_BUILD, WINDOWS_BUILD]) {
    const profile = await mkdtemp(join(tmpdir(), 'ccd-header-menus-'));
    try {
      await withPage({ url: 'about:blank', width: 520, height: 300, scale: 2, profile }, async page => {
        await page.evaluate(`document.documentElement.setAttribute('data-dsh-ccd-style', 'true');
          document.body.innerHTML = ${JSON.stringify(aliasHostClasses(markup, host))};
          const style = document.createElement('style'); style.textContent = ${JSON.stringify(aliasHostClasses(hostCss + css, host))}; document.head.append(style);
          window.calls = []; window.errors = []; window.data = { title:'问候', folder:'dsh-claude-desktop-theme', path:'/Users/demo/dsh-claude-desktop-theme' };
          window.listener = null;`);
        await page.evaluate(bundle.outputFiles[0].text);
        await page.evaluate(`window.release = window.mount(document, {
          read:id=>id==='s1' ? data : {...data,folder:'other-project'},
          rename:async(id,title)=>{calls.push(['rename',id,title]);data.title=title;listener()},
          fork:async id=>calls.push(['fork',id]),archive:async id=>calls.push(['archive',id]),
          subscribe:fn=>{listener=fn;return ()=>{listener=null}}
        },error=>errors.push(String(error)))`);
        const click = selector => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
        const choose = (selector, label) => page.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector + ' button')})].find(node=>node.firstElementChild?.textContent===${JSON.stringify(label)}).click()`);
        const key = value => page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', {key:${JSON.stringify(value)},bubbles:true}))`);
        const geometry = selector => page.evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});const r=node.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,rows:[...node.querySelectorAll('button')].map(row=>row.getBoundingClientRect().height)}})()`);
        await click('[data-ccd-session-trigger]');
        assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('${menu} button')).map(node=>node.firstElementChild.textContent)`), ['Open in', 'Rename', 'Fork', 'Transcript view', 'Output style', 'Archive', 'Delete']);
        const session = await geometry(menu);
        assert.equal(session.w, 136); assert.equal(session.h, 205); assert.deepEqual(session.rows, Array(7).fill(24));
        const trigger = await geometry('[data-ccd-session-trigger]');
        assert.equal(session.x, trigger.x); assert.equal(session.y, trigger.y + trigger.h + 6);
        assert.equal(await page.evaluate(`document.querySelector('${menu}').matches(':popover-open')`), true);
        await key('Home'); await key('ArrowDown'); await key('r');
        assert.equal(await page.evaluate(`document.querySelector('dialog').open`), true);
        await page.evaluate(`document.querySelector('dialog input').value='Changed'; document.querySelector('dialog form').requestSubmit()`);
        assert.deepEqual(await page.evaluate('calls'), [['rename', 's1', 'Changed']]);
        await click('[data-ccd-session-trigger]'); await key('f');
        await click('[data-ccd-session-trigger]'); await choose(menu, 'Archive');
        assert.deepEqual(await page.evaluate('calls.slice(1)'), [['fork', 's1'], ['archive', 's1']]);
        await click('[data-ccd-session-trigger]'); await choose(menu, 'Transcript view'); await choose('[data-ccd-header-menu="Transcript view"]', 'Trace');
        assert.equal(await page.evaluate('calls.at(-1)'), 'trace');
        await click('[data-ccd-session-trigger]'); await choose(menu, 'Open in'); await choose('[data-ccd-header-menu="Open in"]', 'VS Code');
        assert.equal(await page.evaluate('calls.at(-1)'), 'open');
        await click('[data-ccd-session-trigger]'); await choose(menu, 'Delete');
        assert.match(await page.evaluate(`document.querySelector('dialog').textContent`), /删除会话的公开接口/u);
        await page.evaluate(`document.querySelector('dialog').close()`);
        await click('[data-ccd-project-trigger]');
        assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('${project} button')).map(node=>node.firstElementChild.textContent)`), ['Show in Finder', 'Open repository on GitHub', 'Copy', 'Change folder…', 'Open in terminal']);
        const folder = await geometry(project); assert.equal(folder.w, 192); assert.equal(folder.h, 148);
        assert.equal(folder.x, (await geometry('[data-ccd-project-trigger]')).x);
        await choose(project, 'Open in terminal'); assert.equal(await page.evaluate('calls.at(-1)'), 'terminal');
        await click('[data-ccd-project-trigger]'); await key('Home'); await key('ArrowDown'); await key('ArrowDown'); await key('ArrowRight');
        assert.equal(await page.evaluate(`document.activeElement.firstElementChild.textContent`), 'Folder path');
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-header-menu]').length`), 2);
        await key('ArrowLeft'); assert.equal(await page.evaluate(`document.activeElement.firstElementChild.textContent`), 'Copy');
        await key('Escape'); assert.equal(await page.evaluate(`document.activeElement.hasAttribute('data-ccd-project-trigger')`), true);
        // Escape/outside and navigation must withdraw both cards and update identity.
        await click('[data-ccd-session-trigger]');
        await page.evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-header-menu]').length`), 0);
        await click('[data-ccd-session-trigger]');
        await page.evaluate(`document.querySelector('[data-conversation-session]').setAttribute('data-conversation-session','s2')`);
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-header-menu]').length`), 0);
        assert.equal(await page.evaluate(`document.querySelector('[data-ccd-project-trigger]').textContent`), 'other-project');
        await page.evaluate(`document.querySelector('[data-conversation-session]').setAttribute('data-conversation-session','s1')`);
        await click('[data-ccd-project-trigger]');
        await page.evaluate(`document.body.setAttribute('data-ds-dark-theme','')`);
        assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('${project}')).backgroundColor`), 'rgb(48, 48, 46)');
        // A short window and narrow viewport keep all menu rows reachable.
        await page.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 150, deviceScaleFactor: 2, mobile: false });
        await page.evaluate('window.dispatchEvent(new Event("resize"))');
        const narrow = await geometry(project); assert(narrow.x >= 8); assert(narrow.x + narrow.w <= 312); assert(narrow.h <= 134);
        await page.send('Emulation.setDeviceMetricsOverride', { width: 520, height: 300, deviceScaleFactor: 2, mobile: false });
        await page.evaluate(`document.body.removeAttribute('data-ds-dark-theme');window.dispatchEvent(new Event('resize'))`);
        if (host === PINNED_BUILD && process.env.CCD_HEADER_MENU_PREVIEW === '1') {
          await mkdir(join(root, 'artifacts'), { recursive: true });
          for (const [name, selector] of [['project', '[data-ccd-project-trigger]'], ['session', '[data-ccd-session-trigger]']]) {
            if (name === 'session') await click(selector);
            const shot = await page.send('Page.captureScreenshot', { format: 'png' });
            await writeFile(join(root, `artifacts/header-menu-${name}.png`), Buffer.from(shot.data, 'base64'));
          }
        }
        await page.evaluate('release()');
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-header-menu], [data-ccd-session-trigger], [data-ccd-session-icon], [data-ccd-project-trigger], [data-ccd-session-title], dialog').length`), 0);
        assert.equal(await page.evaluate('listener'), null); assert.deepEqual(await page.evaluate('errors'), []);
      });
    } finally { await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 }); }
  }
});
