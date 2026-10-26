import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* CI supplies Chrome. */ }
const svg = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M2 8h12"/></svg>';
const sidebar = `<aside id="sidebar" class="_3WPZCG_root">
  <div class="_3WPZCG_logoRow"><button id="brand" class="_3WPZCG_brand">DeepSeek Harness</button>
    <span><button id="toggle" class="_3WPZCG_iconButton _3WPZCG_toggle" aria-label="Toggle sidebar">${svg}</button></span>
  </div>
  <button id="new" class="_3WPZCG_newSession" aria-label="New session"><span class="_3WPZCG_newSessionLabelMask"><span class="_3WPZCG_newSessionContent">${svg}<span class="_3WPZCG_newSessionLabel">New</span></span></span></button>
</aside>`;

// Relevant geometry from the official Windows rc.3 sidebar and frame CSS.
// The zero-width column, hidden brand ancestor and inherited shadow-menu
// offset are the seams a macOS-only or selector-only test cannot exercise.
const native = `
  body{margin:0}button{font:inherit}
  ._6Qf49G_frame{height:100vh;padding-top:40px;box-sizing:border-box}
  ._6Qf49G_sidebarCol{width:264px;overflow:hidden}
  [data-sidebar-collapsed] ._6Qf49G_sidebarCol{width:0}
  ._3WPZCG_root{display:flex;flex-direction:column;width:264px}
  ._3WPZCG_logoRow{display:flex;overflow:hidden;height:40px}
  ._3WPZCG_brand{display:inline-flex}
  ._3WPZCG_iconButton{width:28px;height:28px;padding:0;border:0;background:transparent}
  ._3WPZCG_toggle{position:fixed;top:6px;left:12px;z-index:30}
  ._3WPZCG_newSession{display:flex;height:38px;container-type:inline-size}
  ._3WPZCG_newSessionLabelMask{flex:1;min-width:0}
  ._3WPZCG_newSessionContent{display:flex;align-items:center;justify-content:center;width:100cqw}
  ._3WPZCG_collapsed ._3WPZCG_newSessionLabel{display:none}
  [data-windows-titlebar] ._3WPZCG_collapsed ._3WPZCG_newSession{position:fixed;top:6px;left:48px;width:28px;height:28px;padding:0;margin:0;z-index:30}
  html[data-windows-titlebar]:has([data-sidebar-collapsed=true]){--dsh-windows-menu-start:84px}
`;

test('Windows caption controls survive branding and collapse with equal seats, native clicks and menu clearance', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 30000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: root, contents: `
    import {mountNavigationHistory} from './src/client/compat/navigation-history-controls.ts';
    import {mountSidebarNavigation} from './src/client/compat/sidebar-navigation.ts';
    import {SIDEBAR_NAVIGATION_ICONS} from './src/client/features/sidebar/navigation-icons.ts';
    window.errors=[];window.visits=[];window.current={kind:'panel',id:'a'};
    window.releaseHistory=mountNavigationHistory(document,{
      current:()=>window.current,available:()=>true,
      open:target=>{window.current=target;window.visits.push(target.id);window.notify()},
      subscribe:fn=>{window.notify=fn;return()=>window.notify=()=>{}}
    },e=>window.errors.push(String(e)));
    window.releaseNavigation=mountSidebarNavigation(document,SIDEBAR_NAVIGATION_ICONS,e=>window.errors.push(String(e)));
  ` }, bundle: true, write: false, format: 'iife' });
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/features/sidebar/sidebar.css',
    'src/client/features/sidebar/navigation.css', 'src/client/theme/navigation-history.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-windows-caption-'));
  try {
    await withPage({ url: 'about:blank', width: 900, height: 500, profile }, async page => {
      await page.evaluate(`
        document.documentElement.dataset.platform='win32';
        document.documentElement.dataset.dshCcdStyle='true';
        document.documentElement.setAttribute('data-windows-titlebar','');
        document.documentElement.style.setProperty('--dsh-windows-titlebar-height','40px');
        document.body.innerHTML=${JSON.stringify(aliasHostClasses(`<main data-slot="root"><div id="frame" class="_6Qf49G_frame"><div class="_6Qf49G_sidebarCol">${sidebar}</div></div></main><div id="menus" data-windows-menu></div>`, WINDOWS_BUILD))};
        const style=document.createElement('style');style.textContent=${JSON.stringify(aliasHostClasses(native + styles, WINDOWS_BUILD))};document.head.append(style);
        const shadow=document.querySelector('#menus').attachShadow({mode:'open'});
        shadow.innerHTML='<style>:host{position:fixed;top:0;left:var(--dsh-windows-menu-start,48px);height:40px;display:flex;align-items:center;z-index:1100}button{height:28px}</style><button>Application</button><button>Edit</button>';
        window.clicks=[];
        window.bindNative=()=>['toggle','new'].forEach(id=>document.getElementById(id).addEventListener('click',()=>window.clicks.push(id)));
        window.bindNative();
        window.paint=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      await page.evaluate(`window.current={kind:'panel',id:'b'};window.notify();paint()`);
      const check = async (brand, collapsed) => {
        await page.evaluate(`
          document.documentElement.style.setProperty('--ccd-sidebar-brand-display',${JSON.stringify(brand ? 'flex' : 'none')});
          document.querySelector('#sidebar').classList.toggle(${JSON.stringify(aliasHostClasses('_3WPZCG_collapsed', WINDOWS_BUILD))},${collapsed});
          document.querySelector('#frame').toggleAttribute('data-sidebar-collapsed',${collapsed});
          if(${collapsed})document.querySelector('#frame').setAttribute('data-sidebar-collapsed','true');
          paint();
        `);
        const geometry = await page.evaluate(`(()=>{
          const rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right}};
          const controls=[document.querySelector('#toggle'),...document.querySelectorAll('[data-ccd-navigation-history] button')${collapsed ? ",document.querySelector('#new')" : ''}];
          return {controls:controls.map(el=>({rect:rect(el),icons:[...el.querySelectorAll('svg')].filter(svg=>getComputedStyle(svg).display!=='none').map(rect),hit:document.elementFromPoint(el.getBoundingClientRect().x+12,20)===el||el.contains(document.elementFromPoint(el.getBoundingClientRect().x+12,20))})),
            brand:getComputedStyle(document.querySelector('#brand')).display,
            menu:rect(document.querySelector('#menus')),
            parent:document.querySelector('[data-ccd-navigation-history]').parentElement.id,
            count:document.querySelectorAll('[data-ccd-navigation-history]').length};
        })()`);
        assert.equal(geometry.parent, 'frame');
        assert.equal(geometry.count, 1);
        if (!collapsed) assert.equal(geometry.brand === 'none', !brand);
        for (const control of geometry.controls) {
          assert.equal(control.rect.width, 24);
          assert.equal(control.rect.height, 24);
          assert.equal(control.rect.y, 8);
          assert.equal(control.hit, true, 'caption controls remain reachable above the clipped sidebar');
          assert.equal(control.icons.length, 1, 'decorating New Session does not reveal the original glyph');
          assert.equal(control.icons[0].width, 16);
          assert.equal(control.icons[0].height, 16);
        }
        assert.deepEqual(geometry.controls.map(c => c.rect.x), collapsed ? [12, 40, 64, 92] : [12, 40, 64]);
        assert.ok(geometry.menu.x >= geometry.controls.at(-1).rect.right + 8, 'native menus do not overlap the icon controls');
      };
      for (const collapsed of [false, true, false]) {
        for (const brand of [false, true]) await check(brand, collapsed);
      }
      // A real sidebar replacement must leave the frame-owned history intact.
      await page.evaluate(`document.querySelector('#sidebar').outerHTML=${JSON.stringify(aliasHostClasses(sidebar, WINDOWS_BUILD))};window.bindNative();paint()`);
      await check(false, true);
      for (const x of [24, 104]) {
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y: 20, button: 'left', clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: 20, button: 'left', clickCount: 1 });
      }
      await page.evaluate(`document.querySelector('[data-ccd-history-direction=back]').click();paint()`);
      assert.deepEqual(await page.evaluate('window.clicks'), ['toggle', 'new']);
      assert.deepEqual(await page.evaluate('window.visits'), ['a']);
      assert.deepEqual(await page.evaluate('window.errors'), []);
      await page.evaluate('window.releaseHistory();window.releaseNavigation();paint()');
      assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-navigation-history]").length'), 0);
      assert.equal(await page.evaluate('getComputedStyle(document.querySelector("#menus")).left'), '84px', 'releasing history restores the native menu offset');
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
