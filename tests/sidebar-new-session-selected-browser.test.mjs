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

/* The host's sidebar plus the main column that holds the conversation root.
 * The two panel rows are 插件 and 例程; New Session is the plain button the
 * host never marks active. `data-phase` on the conversation root is the fact
 * the selected fill reads, so the fixture renders it the way the host does and
 * the test flips it, drops the root for a panel page, and puts a fresh one
 * back — the commits React makes as the location moves. */
const nativeSvg = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M2 8H14"/></svg>';
const fixture = `<main data-slot="root"><div class="_6Qf49G_frame">
<div class="_6Qf49G_sidebarCol"><div data-slot="sidebar"><div class="_3WPZCG_root">
<button id="new" class="_3WPZCG_newSession" aria-label="新建会话" aria-keyshortcuts="Meta+N"><span class="_3WPZCG_newSessionLabelMask"><span class="_3WPZCG_newSessionContent">${nativeSvg}<span class="_3WPZCG_newSessionLabel">新会话</span></span></span><span class="_3WPZCG_newSessionShortcut">⌘N</span></button>
<nav class="_3WPZCG_panelList">${[['plugins', '插件'], ['routines', '自动化任务']].map(([id, label]) => `<button id="${id}" class="_3WPZCG_panelRow" aria-label="${label}"><span class="_3WPZCG_panelGlyph" aria-hidden="true"><div data-slot="sidebar.panellist" style="display:contents">${nativeSvg}</div></span><span class="_3WPZCG_panelTitle">${label}</span></button>`).join('')}</nav>
</div></div></div>
<div class="_6Qf49G_centerCol" id="main-slot"><div class="ST7X_W_root" data-phase="hero"><div class="ST7X_W_composerStack" data-composer-card></div></div></div>
</div></main>`;

/* The host's own rules for exactly these boxes, including the macOS New
 * Session button's translucent white — the background the selected fill has to
 * outrank — and the panel row's `panelActive` fill the plugin repaints. */
const nativeStyles = `
*{box-sizing:border-box}
body{margin:0;width:300px;height:200px;background:var(--ccd-sidebar);font-family:system-ui}
[data-slot=root]{height:100%}
._6Qf49G_frame{display:grid;grid-template-columns:264px minmax(0,1fr);height:100%}
._6Qf49G_sidebarCol{min-width:0;overflow:hidden}
._6Qf49G_centerCol{min-width:0;background:#fff}
._3WPZCG_root{display:flex;flex-direction:column;height:100%;padding:8px 10px}
._3WPZCG_newSession{display:flex;align-items:center;position:relative;height:36px;margin:0 0 7px;padding:8px 12px;border:none;border-radius:6px;background:0 0;color:#1f1f1d;font:inherit;font-size:14px;font-weight:500;cursor:pointer}
[data-platform=darwin] ._3WPZCG_newSession{background:#ffffff8c}
[data-platform=darwin] ._3WPZCG_newSession:hover{background:#ffffff4d}
._3WPZCG_collapsed ._3WPZCG_newSession{background:0 0;width:36px;height:36px;padding:0}
._3WPZCG_newSessionLabelMask{flex:1;min-width:0}
._3WPZCG_newSessionContent{display:flex;align-items:center;gap:8px}
._3WPZCG_newSessionShortcut{display:none}
._3WPZCG_panelList{display:flex;flex-direction:column;gap:7px;margin:0;padding:0}
._3WPZCG_panelRow{display:flex;align-items:center;gap:8px;background:transparent;border:0;border-radius:6px;padding:7px 8px;color:#4a4a47;font:inherit;font-size:14px;line-height:22px;cursor:pointer;text-align:left}
._3WPZCG_panelRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
._3WPZCG_panelRow._3WPZCG_panelActive{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
._3WPZCG_panelGlyph{display:inline-flex;align-items:center;justify-content:center}
.ST7X_W_root{height:100%;background:#fcfcfb}
`;

const SELECTED = 'rgb(236, 235, 232)';
const HOVER = 'rgb(240, 240, 238)';
const TEXT = 'rgb(31, 31, 29)';
const NONE = 'rgba(0, 0, 0, 0)';

test('the New Session row keeps the selected fill while its page is the current location', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 30000,
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

  for (const buildInfo of [PINNED_BUILD, WINDOWS_BUILD]) {
    const windows = buildInfo === WINDOWS_BUILD;
    const rootClass = aliasHostClasses('ST7X_W_root', buildInfo);
    const rootSelector = `.${rootClass}`;
    const collapsed = aliasHostClasses('_3WPZCG_collapsed', buildInfo);
    const label = aliasHostClasses('_3WPZCG_newSessionLabel', buildInfo);
    const profile = await mkdtemp(join(tmpdir(), 'ccd-sidebar-selected-test-'));
    try {
      await withPage({ url: 'about:blank', width: 300, height: 200, scale: 2, profile }, async page => {
        await page.evaluate(`
          document.documentElement.lang='zh';
          document.documentElement.dataset.platform=${JSON.stringify(windows ? 'win32' : 'darwin')};
          document.documentElement.dataset.dshCcdStyle='true';
          document.body.innerHTML=${JSON.stringify(aliasHostClasses(fixture, buildInfo))};
          const native=document.createElement('style');
          native.textContent=${JSON.stringify(aliasHostClasses(nativeStyles, buildInfo))};
          document.head.append(native);
          const style=document.createElement('style');
          style.textContent=${JSON.stringify(aliasHostClasses(styles, buildInfo))};
          document.head.append(style);
          window.pluginStyle=style;`);
        await page.evaluate(bundle.outputFiles[0].text);
        const settle = () => page.evaluate('new Promise(resolve=>setTimeout(resolve,0))');
        const fill = selector => page.evaluate(`(()=>{const s=getComputedStyle(document.querySelector(${JSON.stringify(selector)}));return[s.backgroundColor,s.color]})()`);
        const park = async () => {
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 290, y: 190 });
          await page.evaluate('document.body.getBoundingClientRect()');
        };
        const move = async selector => {
          const point = await page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
          await page.evaluate('document.body.getBoundingClientRect()');
        };

        await page.evaluate('window.mountNavigation()');
        await settle();
        assert.equal(await page.evaluate(`document.getElementById('new').getAttribute('data-ccd-nav')`), 'newSession');
        assert.equal(await page.evaluate(`document.querySelector('#new .' + ${JSON.stringify(label)}).textContent`), '新建会话');

        /* The hero phase is the New Session location: the row takes the same
           selected fill the panel rows take from `panelActive`, while neither
           panel row is painted. */
        await park();
        assert.deepEqual(await fill('#new'), [SELECTED, TEXT]);
        assert.deepEqual(await fill('#plugins'), [NONE, 'rgb(74, 74, 71)']);
        assert.deepEqual(await fill('#routines'), [NONE, 'rgb(74, 74, 71)']);

        /* Under the pointer the row answers with the hover step, as the panel
           rows do; the neighbouring panel row's hover leaves the fill alone. */
        await move('#new');
        assert.deepEqual(await fill('#new'), [HOVER, TEXT]);
        await move('#plugins');
        assert.deepEqual(await fill('#plugins'), [HOVER, TEXT]);
        assert.deepEqual(await fill('#new'), [SELECTED, TEXT]);

        /* The first message: the root flips to `active` and the fill clears;
           back to hero it returns. */
        await park();
        await page.evaluate(`document.querySelector(${JSON.stringify(rootSelector)}).dataset.phase='active'`);
        assert.equal((await fill('#new'))[0], NONE);
        await page.evaluate(`document.querySelector(${JSON.stringify(rootSelector)}).dataset.phase='hero'`);
        assert.equal((await fill('#new'))[0], SELECTED);

        /* Another panel selected: the main column renders the panel instead of
           the conversation, exactly as the host's keyed `main` slot swaps by
           `activePanelId` — the row is no longer the location, the panel row is. */
        await page.evaluate(`(()=>{
          document.querySelector(${JSON.stringify(rootSelector)}).remove();
          document.getElementById('main-slot').insertAdjacentHTML('beforeend','<div id="panel-page">插件</div>');
          const row=document.getElementById('routines');
          row.classList.add(${JSON.stringify(aliasHostClasses('_3WPZCG_panelActive', buildInfo))});
          row.setAttribute('aria-current','page');})()`);
        assert.equal((await fill('#new'))[0], NONE);
        assert.equal((await fill('#routines'))[0], SELECTED);

        /* Back to New Session with a freshly mounted conversation root — the
           commit the click makes — with the panel's own selection gone. */
        await page.evaluate(`(()=>{
          document.getElementById('panel-page').remove();
          const fresh=document.createElement('div');
          fresh.className=${JSON.stringify(rootClass)};
          fresh.dataset.phase='hero';
          document.getElementById('main-slot').append(fresh);
          const row=document.getElementById('routines');
          row.classList.remove(${JSON.stringify(aliasHostClasses('_3WPZCG_panelActive', buildInfo))});
          row.removeAttribute('aria-current');})()`);
        assert.equal((await fill('#new'))[0], SELECTED);

        /* The rail keeps the host's own geometry, so the fill stops with the
           expanded layout's other values and comes back with them. */
        await page.evaluate(`document.querySelector('.' + ${JSON.stringify(aliasHostClasses('_3WPZCG_root', buildInfo))}).classList.add(${JSON.stringify(collapsed)})`);
        assert.equal((await fill('#new'))[0], NONE);
        await page.evaluate(`document.querySelector('.' + ${JSON.stringify(aliasHostClasses('_3WPZCG_root', buildInfo))}).classList.remove(${JSON.stringify(collapsed)})`);
        assert.equal((await fill('#new'))[0], SELECTED);

        /* The pointer resting on the panel row next door leaves the fill on the
           row it belongs to; this is the state the capture shows. */
        await move('#plugins');
        assert.deepEqual(await fill('#new'), [SELECTED, TEXT]);
        if (!windows) {
          await mkdir(join(root, 'artifacts'), { recursive: true });
          const screenshot = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 300, height: 200, scale: 1 } });
          await writeFile(join(root, 'artifacts/sidebar-new-session-selected.png'), Buffer.from(screenshot.data, 'base64'));
        }

        /* Release leaves nothing of either half: the module restores the host's
           nodes and the stylesheet goes with its feature scope, so the host's
           own background is what the row computes again. */
        await page.evaluate('window.releaseNavigation()');
        await page.evaluate('window.pluginStyle.remove()');
        await settle();
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-nav], [data-ccd-nav-glyph]').length`), 0);
        assert.equal(await page.evaluate(`document.querySelector('#new .' + ${JSON.stringify(label)}).textContent`), '新会话');
        const released = (await fill('#new'))[0];
        if (windows) assert.equal(released, NONE);
        else assert.match(released, /^rgba\(255, 255, 255/);
        assert.deepEqual(await page.evaluate('window.errors'), []);
      });
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  }
});
