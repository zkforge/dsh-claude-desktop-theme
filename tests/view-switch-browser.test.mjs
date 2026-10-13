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

/*
 * The host frame as the pinned build renders it: the layout's grid frame with
 * the sidebar column and the conversation column, the sidebar's macOS window
 * row plus its brand row, and the conversation header — headerLeading, the
 * title row, and the View tablist as the header's own second row (a sibling of
 * the title row, `data-conversation-tabs`). The tablist starts in the header,
 * which is what the plugin has to undo.
 */
const fixture = `<main data-slot="root"><div class="_6Qf49G_frame" style="grid-template-columns:264px minmax(400px,1fr) minmax(0px,0px)">
<div class="_6Qf49G_sidebarCol"><div data-slot="sidebar"><div class="_3WPZCG_root">
  <div class="_3WPZCG_topStrip"><span class="ccd-lights" aria-hidden="true"><i></i><i></i><i></i></span><button class="_3WPZCG_iconButton _3WPZCG_toggle" aria-label="收起侧边栏"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="2.2" y="3.4" width="11.6" height="9.2" rx="1.6"/><path d="M6.6 3.4v9.2"/></svg></button></div>
  <div class="_3WPZCG_logoRow"><span class="_3WPZCG_brand"><span class="_3WPZCG_brandName">DSH</span></span></div>
  <button class="_3WPZCG_newSession"><span class="_3WPZCG_newSessionContent"><svg width="16" height="16"></svg><span class="_3WPZCG_newSessionLabel">新建会话</span></span></button>
</div></div></div>
<div class="_6Qf49G_centerCol"><div class="ST7X_W_root" data-phase="session">
<header class="ST7X_W_header">
  <div class="ST7X_W_headerLeading" data-conversation-header-leading></div>
  <div class="ST7X_W_titleRow">
    <div class="ST7X_W_titleCluster">
      <nav class="ST7X_W_crumbs" aria-label="会话层级"><span class="ST7X_W_crumb">你好</span></nav>
      <div class="ST7X_W_headerActions"><button class="_2tNPVa_trigger">默认</button></div>
    </div>
    <div class="ST7X_W_headerUtilities"><button class="iq4beG_main">Open</button><button class="Da3aKq_moreButton">⋯</button></div>
    <div class="ST7X_W_headerCorner" data-conversation-header-corner></div>
  </div>
  <div class="ST7X_W_tabs" role="tablist" data-conversation-tabs>
    <button type="button" role="tab" aria-selected="true" class="ST7X_W_tab ST7X_W_tabActive">对话</button>
    <button type="button" role="tab" aria-selected="false" class="ST7X_W_tab">轨迹</button>
  </div>
</header>
<div class="ST7X_W_body" data-conversation-content></div>
</div></div>
<div class="_6Qf49G_rightbarCol"></div>
</div></main>`;

// The host's own rules for exactly the boxes this fixture renders; the plugin's
// stylesheets are appended after them, the way `mountStyles` appends them.
const nativeStyles = `
html[data-platform=darwin]{--dsh-frame-leading-clearance:0px}
*{box-sizing:border-box}
body{margin:0;height:100vh;font-family:system-ui;font-size:14px}
[data-slot=root]{height:100%}
._6Qf49G_frame{display:grid;grid-template-rows:100%;height:100%;overflow:hidden;background:#fff}
._6Qf49G_sidebarCol{background:#fbfbfa;border-right:.5px solid #ddd;min-width:0;overflow:hidden}
._6Qf49G_centerCol{display:flex;flex-direction:column;min-width:0;overflow:hidden}
._6Qf49G_rightbarCol{min-width:0;position:relative;overflow:visible;background:#fcfcfb}
._3WPZCG_root{display:flex;flex-direction:column;height:100%;padding:6px 12px;--dsh-sidebar-inline-padding:12px}
._3WPZCG_topStrip{display:flex;align-items:center;justify-content:flex-end;flex:none;height:52px;margin:-6px -12px 0;padding:0 12px 2px}
._3WPZCG_logoRow{display:flex;align-items:center;height:32px}
._3WPZCG_iconButton{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;background:0 0;color:#666}
._3WPZCG_newSession{display:flex;align-items:center;height:32px;border:none;background:0 0}
.ST7X_W_root{display:flex;flex-direction:column;height:100%;position:relative;background:#fcfcfb}
.ST7X_W_header{display:grid;grid-template-columns:auto minmax(0,1fr);flex:none;min-height:76px;padding:10px 28px 0 20px;border-bottom:.5px solid #ddd}
.ST7X_W_titleRow{display:flex;align-items:center;grid-column:2;min-height:30px}
.ST7X_W_titleCluster{display:flex;align-items:center;flex:1;min-width:0;gap:10px}
.ST7X_W_crumbs{display:flex;align-items:center;gap:4px;overflow:hidden;white-space:nowrap}
.ST7X_W_headerActions{display:flex;align-items:center;flex:none;gap:8px}
.ST7X_W_headerUtilities{display:flex;align-items:center;flex:none;gap:8px;margin-left:20px}
.ST7X_W_headerUtilities:empty{display:none}
.ST7X_W_headerCorner{display:flex;align-items:center;flex:none;margin-left:8px;margin-right:-16px}
.ST7X_W_headerCorner:empty{display:none}
.ST7X_W_tabs{display:flex;gap:36px;grid-column:1/-1;margin-top:10px;padding-left:8px;position:relative;z-index:1}
.ST7X_W_tab{position:relative;padding:0 0 9px;border:none;background:0 0;color:#8f8f8a;font-size:13px;font-weight:500;line-height:16px;cursor:pointer}
.ST7X_W_tab:after{content:"";position:absolute;bottom:-1px;left:0;right:0;height:2px;border-radius:2px;background:0 0}
.ST7X_W_tabActive{color:#4b76ce}
.ST7X_W_tabActive:after{background:#4b76ce}
.ST7X_W_body{flex:1;min-height:0}
/* Fixture chrome: the macOS traffic lights the host window draws natively, on
   the same centre line as the plugin's pinned toggle (11px + 28 / 2 = 25px). */
.ccd-lights{position:fixed;top:18.5px;left:14px;display:flex;gap:7px;z-index:15}
.ccd-lights i{width:13px;height:13px;border-radius:50%;background:#fe5f57}
.ccd-lights i:nth-child(2){background:#febc2e}
.ccd-lights i:nth-child(3){background:#28c840}
`;

test('the View switcher parks on the sidebar column and survives rerenders, collapse and selection', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, contents: `
      import {mountViewSwitch} from './src/client/compat/view-switch.ts';
      import {VIEW_SWITCH_ICONS} from './src/client/features/conversation/view-switch-icons.ts';
      window.errors=[];
      window.mountSwitcher=()=>window.releaseSwitcher=mountViewSwitch(document,VIEW_SWITCH_ICONS,error=>window.errors.push(String(error)));
    ` }, bundle: true, write: false, format: 'iife',
  });
  const styles = (await Promise.all([
    'src/client/theme/tokens.css',
    'src/client/features/conversation/conversation.css',
    'src/client/features/sidebar/sidebar.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');

  for (const buildInfo of [PINNED_BUILD, WINDOWS_BUILD]) {
    const windows = buildInfo === WINDOWS_BUILD;
    const frame = `.${aliasHostClasses('_6Qf49G_frame', buildInfo)}`;
    const column = `.${aliasHostClasses('_6Qf49G_sidebarCol', buildInfo)}`;
    const header = `.${aliasHostClasses('ST7X_W_header', buildInfo)}`;
    const toggle = `.${aliasHostClasses('_3WPZCG_toggle', buildInfo)}`;
    const active = aliasHostClasses('ST7X_W_tabActive', buildInfo);

    // Every measurement the assertions speak in, taken in one round trip.
    const geometry = `(()=>{
      const box=el=>{if(el===null)return null;const r=el.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,centerY:(r.top+r.bottom)/2}};
      const tabs=document.querySelector('[data-conversation-tabs]');
      return {tabs:box(tabs),column:box(document.querySelector(${JSON.stringify(column)})),header:box(document.querySelector(${JSON.stringify(header)})),toggle:box(document.querySelector(${JSON.stringify(toggle)})),docked:tabs===null?null:tabs.getAttribute('data-ccd-view-dock')};})()`;
    const thumb = `(()=>{
      const tabs=document.querySelector('[data-conversation-tabs]');
      const active=document.querySelector('[role=tab][aria-selected=true]');
      const style=getComputedStyle(tabs,'::before');
      return{x:tabs.style.getPropertyValue('--ccd-view-x'),w:tabs.style.getPropertyValue('--ccd-view-w'),transform:style.transform,width:style.width,offset:Math.round((active.getBoundingClientRect().left-tabs.getBoundingClientRect().left)*2)/2};})()`;
    /* Where each tab's artwork *inks*, not where its 16px box sits: the SVG's
       own geometry box, widened by half its stroke, measured against the
       segment the thumb is drawn on. */
    const ink = `Array.from(document.querySelectorAll('[role=tab]')).map(tab=>{
      const svg=tab.querySelector('[data-ccd-view-glyph] svg');
      const box=svg.getBoundingClientRect();
      const bbox=svg.getBBox();
      const stroke=parseFloat(getComputedStyle(svg).strokeWidth)||0;
      const scale=box.height/16;
      const segment=tab.getBoundingClientRect();
      return{view:tab.getAttribute('data-ccd-view'),
        ink:Math.round((box.top+((bbox.y-stroke/2)+(bbox.height+stroke)/2)*scale)*100)/100,
        segment:Math.round((segment.top+segment.height/2)*100)/100};})`;

    const profile = await mkdtemp(join(tmpdir(), 'ccd-view-switch-test-'));
    try {
      await withPage({ url: 'about:blank', width: 900, height: 600, scale: 2, profile }, async page => {
        await page.evaluate(`
          document.documentElement.dataset.platform=${JSON.stringify(windows ? 'win32' : 'darwin')};
          document.documentElement.dataset.dshCcdStyle='true';
          document.body.innerHTML=${JSON.stringify(aliasHostClasses(fixture, buildInfo))};
          const style=document.createElement('style');
          style.textContent=${JSON.stringify(aliasHostClasses(nativeStyles + styles, buildInfo))};
          document.head.append(style);
          window.view='chat';
          for(const [tab,id] of [[document.querySelectorAll('[role=tab]')[0],'chat'],[document.querySelectorAll('[role=tab]')[1],'trajectory']]){
            tab.addEventListener('click',()=>{window.view=id;for(const other of document.querySelectorAll('[role=tab]')){const on=other===tab;other.setAttribute('aria-selected',String(on));other.classList.toggle(${JSON.stringify(active)},on);}});
          }`);
        await page.evaluate(bundle.outputFiles[0].text);
        const settle = () => page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)))');
        await page.evaluate('window.mountSwitcher()');
        await settle();

        // The two shipped labels are drawn as bundled artwork on fixed segments.
        const icons = await page.evaluate(`Array.from(document.querySelectorAll('[role=tab]')).map(tab=>{
          const glyph=tab.querySelector('[data-ccd-view-glyph]');
          const rect=tab.getBoundingClientRect();
          return{view:tab.getAttribute('data-ccd-view'),label:tab.textContent.trim(),aria:tab.getAttribute('aria-label'),
            glyph:glyph!==null&&glyph.getAttribute('aria-hidden')==='true',
            glyphSize:glyph===null?null:[glyph.querySelector('svg').getBoundingClientRect().width,glyph.querySelector('svg').getBoundingClientRect().height],
            font:getComputedStyle(tab).fontSize,w:rect.width,h:rect.height};})`);
        assert.deepEqual(icons.map(icon => [icon.view, icon.label, icon.aria, icon.glyph]), [
          ['chat', '对话', '对话', true],
          ['trajectory', '轨迹', '轨迹', true],
        ]);
        assert.deepEqual(icons.map(icon => [icon.w, icon.h, icon.font]), [[33, 26, '0px'], [33, 26, '0px']]);
        assert.deepEqual(icons.map(icon => icon.glyphSize), [[16, 16], [16, 16]]);

        const first = await page.evaluate(geometry);
        if (windows) {
          /* No macOS window row, so no docking: the switcher stays in the header. */
          assert.equal(first.docked, null);
          assert.ok(first.tabs.top >= first.header.top && first.tabs.bottom <= first.header.bottom + 1,
            `header keeps the switcher: ${JSON.stringify(first)}`);
        } else {
          assert.equal(first.docked, 'sidebar');
          /* Top-right of the sidebar column, on the toggle's own centre line,
             8px inside the column's right edge (the reference's 16 device px). */
          assert.ok(Math.abs(first.tabs.right - (first.column.right - 8)) <= 0.51, `right inset: ${JSON.stringify(first)}`);
          assert.ok(first.tabs.left > first.column.left && first.tabs.bottom < first.column.bottom, `inside the column: ${JSON.stringify(first)}`);
          assert.ok(Math.abs(first.tabs.centerY - first.toggle.centerY) <= 0.51, `toggle row: ${JSON.stringify(first)}`);
          assert.ok(Math.abs(first.tabs.top - 12) <= 0.51, `top: ${JSON.stringify(first)}`);

          /* The header's own row — title, team chip, utilities — sits on the same
             centre line as the toggle and the switcher, not 5px above it. */
          const rowLine = await page.evaluate(`Array.from(document.querySelector(${JSON.stringify(header)})
            .querySelectorAll('.ST7X_W_crumb, .ST7X_W_headerActions button, .ST7X_W_headerUtilities button, [data-conversation-tabs]'))
            .map(el=>{const r=el.getBoundingClientRect();return{text:el.textContent.trim(),centerY:(r.top+r.bottom)/2};})`);
          assert.equal(rowLine.length, 5, `header row items: ${JSON.stringify(rowLine)}`);
          for (const item of rowLine) {
            assert.ok(Math.abs(item.centerY - first.toggle.centerY) <= 0.5, `header row on the toggle's line: ${JSON.stringify(item)}`);
          }

        if (!windows) {
          await mkdir(join(root, 'artifacts'), { recursive: true });
          const screenshot = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 560, height: 200, scale: 1 } });
          await writeFile(join(root, 'artifacts/view-switch-sidebar.png'), Buffer.from(screenshot.data, 'base64'));
        }

          /* The artwork inks on the segment's own centre line (±0.5px): the
             label's line box, the host's padding and any alignment the host
             wins back must not move it. */
          const inked = await page.evaluate(ink);
          assert.deepEqual(inked.map(row => row.view), ['chat', 'trajectory']);
          for (const row of inked) {
            assert.ok(Math.abs(row.ink - row.segment) <= 0.5, `glyph ink centred: ${JSON.stringify(row)}`);
          }

          /* The thumb's box is the active segment's box: measured against the
             tablist's border box, with no padding-box offset. */
          const thumbBox = await page.evaluate(`(()=>{
            const tabs=document.querySelector('[data-conversation-tabs]');
            const active=document.querySelector('[role=tab][aria-selected=true]');
            const style=getComputedStyle(tabs,'::before');
            const track=tabs.getBoundingClientRect();
            const segment=active.getBoundingClientRect();
            const left=track.left+new DOMMatrixReadOnly(style.transform).m41;
            return{left:Math.round(left*100)/100,right:Math.round((left+parseFloat(style.width))*100)/100,
              segmentLeft:Math.round(segment.left*100)/100,segmentRight:Math.round(segment.right*100)/100};})()`);
          assert.ok(Math.abs(thumbBox.left - thumbBox.segmentLeft) <= 0.5 && Math.abs(thumbBox.right - thumbBox.segmentRight) <= 0.5,
            `thumb flush with its segment: ${JSON.stringify(thumbBox)}`);

          /* No reserved row: the header measures the same with the tablist
             docked as it does with no tablist at all. */
          const withTabs = first.header.height;
          await page.evaluate(`window.detached=document.querySelector('[data-conversation-tabs]');window.detached.remove()`);
          await settle();
          const without = await page.evaluate(geometry);
          await page.evaluate(`document.querySelector('header').append(window.detached)`);
          await settle();
          assert.equal(withTabs, without.header.height, `header keeps no row for the switcher: ${JSON.stringify({ withTabs, without: without.header })}`);

          /* The thumb geometry the stylesheet slides on is the active tab's own
             box, measured against the tablist. */
          const chat = await page.evaluate(thumb);
          assert.deepEqual([chat.x, chat.w, chat.transform, chat.width], ['0px', '33px', 'matrix(1, 0, 0, 1, 0, 0)', '33px']);
          await page.evaluate(`document.querySelectorAll('[role=tab]')[1].click()`);
          await settle();
          /* Finish the 180ms thumb transition instead of waiting on the clock. */
          await page.evaluate('document.body.getBoundingClientRect();document.getAnimations().forEach(animation=>animation.finish())');
          const trajectory = await page.evaluate(thumb);
          assert.equal(await page.evaluate('window.view'), 'trajectory');
          assert.equal(trajectory.x, '33px');
          assert.equal(trajectory.offset, 33);
          assert.equal(trajectory.transform, 'matrix(1, 0, 0, 1, 33, 0)');
          assert.equal(trajectory.w, '33px');
          assert.equal(await page.evaluate(`document.querySelectorAll('[role=tab]')[1].getAttribute('aria-selected')`), 'true');
          await page.evaluate(`document.querySelectorAll('[role=tab]')[0].click()`);
          await settle();

          /* A React commit that replaces the tablist, and only it. */
          await page.evaluate(`(()=>{const fresh=document.querySelector('[data-conversation-tabs]').cloneNode(true);
            fresh.querySelectorAll('[data-ccd-view-glyph]').forEach(glyph=>glyph.remove());
            fresh.querySelectorAll('[role=tab]').forEach(tab=>{tab.removeAttribute('data-ccd-view');tab.removeAttribute('aria-label');});
            document.querySelector('[data-conversation-tabs]').replaceWith(fresh);})()`);
          await settle();
          assert.equal((await page.evaluate(geometry)).docked, 'sidebar');
          assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-view-glyph]').length`), 2);
          assert.equal(await page.evaluate(`getComputedStyle(document.querySelectorAll('[role=tab]')[0]).fontSize`), '0px');

          /* The collapsed shell gives the column no width at all: the switcher
             walks back into the header, and returns when the column does. */
          await page.evaluate(`document.querySelector(${JSON.stringify(frame)}).setAttribute('data-sidebar-collapsed','true')`);
          await settle();
          const collapsed = await page.evaluate(geometry);
          assert.equal(collapsed.docked, null);
          assert.ok(collapsed.tabs.top >= collapsed.header.top && collapsed.tabs.bottom <= collapsed.header.bottom + 1,
            `header holds the switcher while collapsed: ${JSON.stringify(collapsed)}`);
          await page.evaluate(`document.querySelector('[data-sidebar-collapsed]').removeAttribute('data-sidebar-collapsed')`);
          await settle();
          assert.equal((await page.evaluate(geometry)).docked, 'sidebar');

          /* A layout-only column change — the grid transition resizing the
             track — re-parks the pill with no attribute to observe. */
          await page.evaluate(`document.querySelector(${JSON.stringify(column)}).style.width='420px'`);
          await settle();
          const wide = await page.evaluate(geometry);
          assert.ok(Math.abs(wide.tabs.right - (wide.column.right - 8)) <= 0.51, `follows a column resize: ${JSON.stringify(wide)}`);

          /* The right panel takes a column of its own: the sidebar's corner,
             and the pill in it, are unchanged. */
          await page.evaluate(`document.querySelector(${JSON.stringify(frame)}).style.gridTemplateColumns='264px minmax(400px,1fr) minmax(0px,300px)';
            document.querySelector(${JSON.stringify(column)}).style.width='264px'`);
          await settle();
          const panelled = await page.evaluate(geometry);
          assert.ok(Math.abs(panelled.tabs.right - (panelled.column.right - 8)) <= 0.51, `right panel open: ${JSON.stringify(panelled)}`);

          /* The live app's failure class: the host's own box rules winning back
             the button's inner layout — its 9px bottom padding, its own
             alignment, its 20px line. The seat is out of the button's flow, so
             none of them may move the ink off the segment's centre line. */
          await page.evaluate(`(()=>{const style=document.createElement('style');
            style.dataset.ccdHostile='true';
            style.textContent=${JSON.stringify(aliasHostClasses('html[data-dsh-ccd-style="true"] .ST7X_W_tab[data-ccd-view]{padding:0 0 9px;align-items:flex-start;line-height:20px}', buildInfo))};
            document.head.append(style);})()`);
          await settle();
          const hostile = await page.evaluate(ink);
          for (const row of hostile) {
            assert.ok(Math.abs(row.ink - row.segment) <= 0.5, `glyph ink centred with the host's tab box back: ${JSON.stringify(row)}`);
          }
          await page.evaluate(`document.querySelector('[data-ccd-hostile]').remove()`);
          await settle();
                  }

        await page.evaluate('window.releaseSwitcher()');
        await settle();
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-view], [data-ccd-view-glyph]').length`), 0);
        assert.equal(await page.evaluate(`document.querySelector('[data-conversation-tabs]').hasAttribute('data-ccd-view-dock')`), false);
        assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('[role=tab]')).map(tab=>tab.textContent.trim()).join()`), '对话,轨迹');
        assert.deepEqual(await page.evaluate('window.errors'), []);
      });
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  }
});
