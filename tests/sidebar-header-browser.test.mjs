import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, PINNED_BUILD, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';

/*
 * The browsing region's one header line.
 *
 * DSH renders its own section header (Search, view options, add workspace) on a
 * line of its own, above a tree whose first row is the first Workspace's. The
 * reference has one line there: the group's name at the inline start and the
 * new-session plus, Search and the view options at the trailing edge. These
 * checks lay the host's real geometry out in a real browser and hold the parked
 * header to it: the band is the Workspace row's own box, the row's actions clear
 * the parked controls, the row underneath keeps its gestures, the host's add
 * workspace leaves the line altogether (the reference draws no such control, so
 * it is not drawn, not focusable and not clickable), and every state that has no
 * group on screen (no history, a flat list, a search) falls back to the header's
 * own line.
 */

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Same optional browser coverage as the menus. */ }

/** The host's own declarations for the modules this region is made of. */
const hostCss = `
  :root{--dsw-radius-xs:4px;--dsw-radius-sm:6px;--dsw-radius-md:8px;--dsw-alias-interactive-bg-hover:#f0f0ee;
    --dsw-alias-label-primary:#1f1f1d;--dsw-alias-label-secondary:#6f6f6a;--dsw-alias-label-tertiary:#8f8f8a;
    --dsw-alias-label-caption:#a3a39e;--dsw-specific-sidebar-fill:#fbfbfa;--dsw-alias-border-l4:#ddd;
    --dsh-sidebar-inline-padding:10px;--dsh-workspace-indent:0px;--ds-ease-in-out:ease-in-out}
  body{margin:0;background:#fbfbfa}
  ._3WPZCG_root{box-sizing:border-box}
  ._7514NG_root{--dsh-session-list-edge-inset:var(--dsh-sidebar-inline-padding);--dsh-session-list-scrollbar-width:5px;
    --dsh-session-list-scrollbar-offset:2px;box-sizing:border-box;min-height:0;padding-right:var(--dsh-session-list-edge-inset);
    flex-direction:column;flex:1;display:flex}
  ._7514NG_root._7514NG_rail{padding-right:0}
  ._7514NG_iconButton{border-radius:var(--dsw-radius-sm);cursor:pointer;width:28px;height:28px;
    color:var(--dsw-alias-label-secondary);background:0 0;border:none;flex:none;justify-content:center;align-items:center;
    padding:0;display:inline-flex}
  ._7514NG_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}
  ._7514NG_sectionHeader{box-sizing:border-box;border-radius:var(--dsw-radius-md);height:36px;color:var(--dsw-alias-label-tertiary);
    flex:none;justify-content:flex-end;align-items:center;gap:4px;margin-bottom:4px;padding-left:4px;display:flex;overflow:hidden}
  ._7514NG_root:not(._7514NG_rail) ._7514NG_sectionHeader{margin-top:2px;margin-right:-4px}
  ._7514NG_sectionLabel{white-space:nowrap;opacity:1;visibility:visible;min-width:0;max-width:45%;flex:none;line-height:20px;overflow:hidden}
  ._7514NG_searchSlot{box-sizing:border-box;min-width:0;max-width:28px;flex:1;align-items:center;margin-left:auto;padding-left:0;display:flex}
  ._7514NG_searchSlotExpanded{max-width:100%;padding-left:0}
  ._7514NG_headerActions{opacity:1;visibility:visible;max-width:60px;flex:none;align-items:center;gap:4px;display:flex;overflow:hidden}
  ._7514NG_headerActionsHidden{opacity:0;visibility:hidden;pointer-events:none;max-width:0}
  ._7514NG_search{box-sizing:border-box;border-radius:var(--dsw-radius-sm);cursor:text;width:100%;height:28px;
    color:var(--dsw-alias-label-secondary);background:0 0;border:none;flex:none;align-items:center;gap:0;margin:0;padding:0;display:flex;overflow:hidden}
  ._7514NG_searchExpanded{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);
    width:calc(100% + 4px);height:30px;color:var(--dsw-alias-label-caption);background:0 0;margin-inline:-2px;padding:0 4px 0 0}
  ._7514NG_searchButton{border-radius:var(--dsw-radius-sm);cursor:pointer;width:28px;height:28px;color:inherit;
    background:0 0;border:none;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}
  ._7514NG_searchExpanded ._7514NG_searchButton{width:28px;height:30px}
  ._7514NG_searchInput{opacity:0;pointer-events:none;width:0;min-width:0;color:var(--dsw-alias-label-primary);
    background:0 0;border:none;outline:none;flex:1;font-size:13px;line-height:18px}
  ._7514NG_searchExpanded ._7514NG_searchInput{opacity:1;pointer-events:auto;margin-left:-2px}
  ._7514NG_listArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-session-list-edge-inset));
    flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:visible}
  ._7514NG_treeBody{flex-direction:column;flex:1;min-height:0;display:flex;position:relative}
  ._7514NG_list{min-height:0;margin-left:-4px;margin-right:var(--dsh-session-list-scrollbar-offset);
    padding-left:4px;padding-right:calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset));
    scrollbar-gutter:stable;flex:1;padding-bottom:16px;overflow-y:auto}
  ._7514NG_flatList>*+*,. _7514NG_groupSection>*+*{margin-top:2px}
  ._7514NG_groupSection{position:relative}
  ._7514NG_groupSection+._7514NG_groupSection{margin-top:4px}
  .jJkEga_projectRow,.jJkEga_sessionRow{border-radius:var(--dsw-radius-md);padding:0 8px;cursor:pointer;user-select:none;
    color:var(--dsw-alias-label-primary);align-items:center;gap:6px;
    padding-inline-start:calc(8px + var(--dsh-workspace-indent,0px));display:flex}
  .jJkEga_projectRow:hover,.jJkEga_sessionRow:hover,.jJkEga_sessionRow.jJkEga_selected{background:var(--dsw-alias-interactive-bg-hover)}
  .jJkEga_projectRow{box-sizing:border-box;align-items:center;height:34px}
  .jJkEga_sessionRow{gap:0;height:32px}
  .jJkEga_rowActions{flex:none;align-items:center;gap:10px;display:none}
  .jJkEga_projectRow:hover .jJkEga_rowActions,.jJkEga_sessionRow:hover .jJkEga_rowActions,
  .jJkEga_projectRow.jJkEga_menuOpen .jJkEga_rowActions,.jJkEga_sessionRow.jJkEga_menuOpen .jJkEga_rowActions{display:inline-flex}
  .jJkEga_projectRow.jJkEga_menuOpen,.jJkEga_sessionRow.jJkEga_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}
  .jJkEga_iconButton{border-radius:var(--dsw-radius-xs);cursor:pointer;width:16px;height:16px;
    color:var(--dsw-alias-label-tertiary);background:0 0;border:none;flex:none;justify-content:center;align-items:center;
    padding:0;display:inline-flex}
  .jJkEga_iconButton:hover{color:var(--dsw-alias-label-primary)}
  .jJkEga_slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}
  .jJkEga_projectRow .jJkEga_chevron{display:none}
  .jJkEga_projectRow:hover .jJkEga_chevron{display:inline-flex}
  .jJkEga_projectRow:hover .jJkEga_folder{display:none}
  .jJkEga_projectText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}
  .jJkEga_title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;line-height:20px;overflow:hidden}
  .jJkEga_sessionRow .jJkEga_title{flex:1}
  .jJkEga_time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:10px;line-height:16px}
  .jJkEga_projectRow.jJkEga_archived .jJkEga_title{color:var(--dsw-alias-label-caption)}
`;

/* The host's artwork, stood in for by stroked paths of the same weight. */
const stroke = 'fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"';
const searchSvg = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.4" ${stroke}/><path d="M10.4 10.4 14 14" ${stroke}/></svg>`;
/** The host's sliders lie down; the plugin stands the glyph upright. */
const slidersSvg = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 6h12M2 10h12" ${stroke}/><circle cx="6.5" cy="6" r="2.2" ${stroke}/><circle cx="9.5" cy="10" r="2.2" ${stroke}/></svg>`;
const folderSvg = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.5 3.5h4.5l1.5 2h7v8h-13z" ${stroke}/><path d="M8 8.5v4M6 10.5h4" ${stroke}/></svg>`;
const ellipsisSvg = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="3.5" cy="8" r="1.1" fill="currentColor"/><circle cx="8" cy="8" r="1.1" fill="currentColor"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor"/></svg>`;
const svg = folderSvg;

/** The host's section header, with both controls and the `wide` label. */
function header(label, expanded = false) {
  return `<div class="_7514NG_sectionHeader">
    <span class="_7514NG_sectionLabel _7514NG_wide">${label}</span>
    <div class="_7514NG_searchSlot${expanded ? ' _7514NG_searchSlotExpanded' : ''}">
      <div id="search" class="_7514NG_search${expanded ? ' _7514NG_searchExpanded' : ''}">
        <button id="search-button" type="button" class="_7514NG_searchButton" aria-label="Search sessions" aria-expanded="${expanded}">${searchSvg}</button>
        <input class="_7514NG_searchInput" type="text" placeholder="Search sessions">
      </div>
    </div>
    <div class="_7514NG_headerActions${expanded ? ' _7514NG_headerActionsHidden' : ''}">
      <span><button id="view-options" type="button" class="_7514NG_iconButton _7514NG_wide" aria-label="View options">${slidersSvg}</button></span>
      <button id="add-workspace" type="button" class="_7514NG_iconButton" aria-label="Add workspace">${folderSvg}</button>
    </div>
  </div>`;
}

/** One Workspace row: the folder slot, the disclosure, the name and its actions. */
function workspaceRow(key, name) {
  return `<span class="HoverCardRoot">
    <div id="row-${key}" class="jJkEga_projectRow${key === 'archived' ? ' jJkEga_archived' : ''}" data-row-key="workspace:${key}" role="treeitem" aria-expanded="true">
      <span class="jJkEga_slot jJkEga_folder">${svg}</span>
      <span class="jJkEga_slot jJkEga_chevron"><svg class="jJkEga_arrow jJkEga_arrowOpen" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 3l5 5-5 5" ${stroke}/></svg></span>
      <span class="jJkEga_projectText"><span class="jJkEga_title">${name}</span></span>
      <span class="jJkEga_rowActions">
        <span><button id="menu-${key}" type="button" class="jJkEga_iconButton" aria-label="Actions for ${name}">${ellipsisSvg}</button></span>
        <button id="plus-${key}" type="button" class="jJkEga_iconButton" aria-label="New session in ${name}">${folderSvg}</button>
      </span>
    </div>
  </span>`;
}

/** One Session row, archived or not. */
function sessionRow(id, title, archived = false) {
  return `<div class="jJkEga_sessionRow${archived ? ' jJkEga_archived' : ''}" data-row-key="session:${id}" role="treeitem">
    <span class="jJkEga_slot"></span>
    <span class="jJkEga_title">${title}</span>
    <span class="jJkEga_time">now</span>
  </div>`;
}

/** One group: a Workspace row above its Sessions, as `SessionTree` renders it. */
function group(key, name, sessions, marked = false) {
  return `<div class="_7514NG_groupSection"${marked ? ' data-ccd-empty-group' : ''}>
    ${workspaceRow(key, name)}${sessions}
  </div>`;
}

/** The browsing region: the host's header above the tree's own list area. */
function region({ label = '工作区', header: heading, tree, empty = false }) {
  return `<div class="_3WPZCG_root" style="width:264px;height:420px;display:flex;flex-direction:column">
    <div class="_7514NG_root">
      ${heading ?? header(label)}
      <div class="_7514NG_listArea"${empty ? ' data-ccd-list-empty' : ''}>
        ${empty ? '<div class="ccd-sidebar-empty" data-ccd-empty-state="new"><div>Sessions you start will show up here</div></div>' : ''}
        <div class="_7514NG_treeBody"><div class="_7514NG_list">${tree}</div></div>
      </div>
    </div>
  </div>`;
}

const oneWorkspace = region({ tree: group('first', 'dsh-ccd-style', sessionRow('a', '你好')) });
const several = region({
  tree: [group('first', 'dsh-ccd-style', sessionRow('a', '你好')), group('second', 'other-project', sessionRow('b', 'Second'))].join(''),
});
const archivedOnly = region({
  tree: group('archived', 'old-project', sessionRow('a', '与你', true)),
});
const noHistory = region({ tree: group('first', 'dsh-ccd-style', '', true), empty: true });
const flatList = region({
  label: '会话',
  tree: `<div class="_7514NG_flatList">${sessionRow('a', '你好')}${sessionRow('b', '第二条')}</div>`,
});
const searching = region({ tree: group('first', 'dsh-ccd-style', sessionRow('a', '你好')), header: header('工作区', true) });

/* One Workspace with more Sessions than the column holds, so the tree scrolls. */
const scrollingSessions = sessionRow('a', '你好')
  + Array.from({ length: 24 }, (_, index) => sessionRow(`s${index}`, `会话 ${index + 1}`)).join('');
const scrolling = region({ tree: group('first', 'dsh-ccd-style', scrollingSessions) });
const scrollingSearch = region({
  tree: group('first', 'dsh-ccd-style', scrollingSessions),
  header: header('工作区', true),
});

/* The collapsed rail: no title and no in-header Search, only the add-workspace
   control, above the rail's own Search button. */
const rail = `<div class="_3WPZCG_root" style="width:36px;height:420px;display:flex;flex-direction:column">
  <div class="_7514NG_root _7514NG_rail">
    <div class="_7514NG_sectionHeader">
      <div class="_7514NG_headerActions">
        <button id="add-workspace" type="button" class="_7514NG_iconButton" aria-label="Add workspace">${folderSvg}</button>
      </div>
    </div>
    <div class="_7514NG_search">
      <button id="search-button" type="button" class="_7514NG_searchButton" aria-label="Search sessions">${searchSvg}</button>
    </div>
    <div class="_7514NG_listArea"><div class="_7514NG_treeBody"><div class="_7514NG_list"></div></div></div>
  </div>
</div>`;

/** Rounded box of one selector, in CSS pixels relative to the page. */
const boxes = `(() => {
  const box = selector => {
    const element = document.querySelector(selector);
    if (element === null) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom };
  };
  return {
    region: box('._7514NG_root'), header: box('._7514NG_sectionHeader'), label: box('._7514NG_sectionLabel'),
    search: box('#search'), searchButton: box('#search-button'), options: box('#view-options'), add: box('#add-workspace'),
    row: box('#row-first'), title: box('#row-first .jJkEga_title'), plus: box('#plus-first'), menu: box('#menu-first'),
    session: box('[data-row-key="session:a"]'), empty: box('[data-ccd-empty-state]'),
  };
})()`;

/** Whether two boxes share any pixel of area. */
function overlaps(a, b) {
  return a !== null && b !== null
    && a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5;
}

const styles = (await Promise.all(['src/client/theme/tokens.css', 'src/client/features/sidebar/sidebar.css']
  .map(path => readFile(join(root, path), 'utf8')))).join('\n');

test('the browsing header merges with the first workspace row and falls back without one', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, contents: `
      import {mountBrowserHeader} from './src/client/compat/browser-header.ts';
      window.errors=[];
      window.mountHeader=()=>window.releaseHeader=mountBrowserHeader(document,error=>window.errors.push(String(error)));
    ` }, bundle: true, write: false, format: 'iife',
  });
  /** Lay one state out with the host's geometry and the plugin's stylesheets. */
  const page = (devtools, body) => devtools.evaluate(`(() => { window.releaseHeader?.(); document.documentElement.lang='zh'; document.documentElement.dataset.dshCcdStyle='true'; document.body.innerHTML=${JSON.stringify(aliasHostClasses(body, PINNED_BUILD))}; const sheet=document.createElement('style'); sheet.textContent=${JSON.stringify(aliasHostClasses(`${hostCss}\n${styles}`, PINNED_BUILD))}; document.head.append(sheet); window.mountHeader(); })()`);
  const settle = devtools => devtools.evaluate('new Promise(resolve=>setTimeout(resolve,20))');
  /* Both hover-only controls fade, and a machine under load can still be read
     half way through the host's own transition (measured 0.77 where the case
     expects 1). The transition is finished rather than waited out, then the
     value is read — the same `getAnimations().finish()` this file already uses
     to settle the View switcher. */
  const settled = (devtools, selector, parent = false) => devtools.evaluate(`(() => {
    document.getAnimations().forEach(animation => animation.finish());
    const box = document.querySelector(${JSON.stringify(selector)});
    return getComputedStyle(${parent ? 'box.parentElement' : 'box'}).opacity;
  })()`);
  const profile = await mkdtemp(join(tmpdir(), 'ccd-sidebar-header-test-'));
  try {
    await withPage({ url: 'about:blank', width: 264, height: 420, scale: 2, profile }, async devtools => {
      await devtools.evaluate(bundle.outputFiles[0].text);
      await devtools.evaluate(`window.clicks=[];document.body.addEventListener('click',event=>{const target=event.target.closest?.('button, [data-row-key]');if(target)window.clicks.push(target.getAttribute('data-row-key')??target.id);},true)`);

      /* One Workspace with one Session: the header shares the row's line. */
      await page(devtools, oneWorkspace);
      await settle(devtools);
      let geometry = await devtools.evaluate(boxes);
      assert.equal(await devtools.evaluate(`document.querySelector('._7514NG_root').hasAttribute('data-ccd-header-merged')`), true, 'the region reports its merged header');
      assert(Math.abs(geometry.header.y - geometry.row.y) < 1, `the header shares the row's line (${geometry.header.y} vs ${geometry.row.y})`);
      assert(Math.abs(geometry.header.height - geometry.row.height) < 1, 'the band is the Workspace row height');
      assert(Math.abs(geometry.header.bottom - geometry.row.bottom) < 1, 'the band ends on the row');
      assert.equal(geometry.label.width, 0, 'the header draws no label of its own while merged');
      assert.equal(await devtools.evaluate(`getComputedStyle(document.querySelector('._7514NG_sectionLabel')).display`), 'none');
      assert(geometry.session.y >= geometry.header.bottom - 0.5, 'the first Session starts below the band');
      assert(!overlaps(geometry.search, geometry.session) && !overlaps(geometry.options, geometry.session), 'the parked controls cover no Session');
      assert(geometry.search.y >= geometry.header.y - 0.5 && geometry.search.bottom <= geometry.header.bottom + 0.5, 'Search sits inside the band');
      assert(geometry.options.right <= geometry.region.right && geometry.options.right > geometry.search.right, 'Search leads the view options at the trailing edge');
      assert(geometry.plus.right <= geometry.search.x + 0.5, 'the new-session plus clears the Search box');
      assert(geometry.search.x - geometry.plus.right <= 6, `the plus keeps the reference's distance to Search (${geometry.search.x - geometry.plus.right})`);
      assert(!overlaps(geometry.plus, geometry.search) && !overlaps(geometry.plus, geometry.options), 'the row actions overlap nothing parked');
      assert(!overlaps(geometry.title, geometry.search) && !overlaps(geometry.title, geometry.options), 'the name runs clear of the parked controls');

      /* The pointer on the band: the row's menu trigger comes back and the row
         keeps its own gestures, while the add-workspace control — which the
         reference's line does not draw — is absent in this state too. */
      const band = await devtools.evaluate(`(()=>{const r=document.querySelector('#row-first').getBoundingClientRect();return{x:r.x+40,y:r.y+r.height/2}})()`);
      await devtools.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...band });
      await devtools.evaluate('document.getAnimations().forEach(animation=>animation.finish())');
      assert.equal(await settled(devtools, '#menu-first', true), '1', 'the row menu returns on hover');
      assert.equal(await devtools.evaluate(`getComputedStyle(document.querySelector('#add-workspace')).display`), 'none', 'add workspace is out of the line while the pointer is on it');
      geometry = await devtools.evaluate(boxes);
      assert.equal(geometry.add.width, 0, 'the control takes no box on the line');
      /* The cell it used to be parked in — 4px ahead of the row's own actions —
         belongs to the Workspace row now: there is nothing of the control left to
         click there, and the row underneath takes the gesture. */
      const cell = await devtools.evaluate(`(() => {
        const menu = document.querySelector('#menu-first').getBoundingClientRect();
        const row = document.querySelector('#row-first').getBoundingClientRect();
        const x = Math.round(menu.x - 20);
        const y = Math.round(row.y + row.height / 2);
        const found = document.elementFromPoint(x, y);
        return { x, y, button: found?.closest('button')?.id ?? '', row: found?.closest('#row-first') !== null };
      })()`);
      assert.equal(cell.button, '', 'the add-workspace cell holds no button');
      assert.equal(cell.row, true, 'the Workspace row owns that cell');

      /* Clicks: the parked box takes none of the row's, and its own controls work. */
      await devtools.evaluate('window.clicks=[]');
      const click = async point => {
        await devtools.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
        await devtools.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      };
      await click({ x: Math.round(band.x), y: Math.round(band.y) });
      assert.deepEqual(await devtools.evaluate('window.clicks'), ['workspace:first'], 'the row keeps its own click through the parked band');
      await click({ x: Math.round(geometry.searchButton.x + geometry.searchButton.width / 2), y: Math.round(geometry.searchButton.y + geometry.searchButton.height / 2) });
      assert.deepEqual(await devtools.evaluate('window.clicks'), ['workspace:first', 'search-button'], 'Search stays clickable');
      await click({ x: Math.round(geometry.options.x + geometry.options.width / 2), y: Math.round(geometry.options.y + geometry.options.height / 2) });
      assert.deepEqual(await devtools.evaluate('window.clicks'), ['workspace:first', 'search-button', 'view-options'], 'the view options stay clickable');
      await click({ x: cell.x, y: cell.y });
      assert.deepEqual(await devtools.evaluate('window.clicks'), ['workspace:first', 'search-button', 'view-options', 'workspace:first'], 'the cell the control used to hold clicks through to the row');

      /* Resting state: the row's hover-only trigger stands down, and the
         add-workspace control is missing in this state as well. The click above
         left the menu trigger focused, which is a state of its own — focus holds
         that control up — so the pointer-away state is read after the focus is
         given up, as it is when the reader moves on. */
      await devtools.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 418 });
      await devtools.evaluate(`document.activeElement?.blur();new Promise(resolve=>setTimeout(resolve,150))`);
      /* The host wraps the menu trigger in the primitive's own span, which is
         the box the plugin fades; the trigger inside it takes the 28px button
         treatment that Search and View options share. */
      assert.equal(await devtools.evaluate(`document.querySelector('#menu-first').parentElement.getBoundingClientRect().width`), 28);
      assert.equal(await settled(devtools, '#menu-first', true), '0', 'the row menu stands down');
      assert.equal(await devtools.evaluate(`getComputedStyle(document.querySelector('#add-workspace')).display`), 'none', 'add workspace stays out at rest');

      /* Keyboard: the control is out of the tab order — a `display: none` node
         takes no focus — while the host's node stays whole in the DOM, so the
         plugin's one rule is the only thing holding it off the line and dropping
         that rule hands the host's own header back. */
      assert.equal(await devtools.evaluate(`(() => { const button = document.querySelector('#add-workspace'); button.focus(); return document.activeElement === button; })()`), false, 'the control is out of the keyboard’s reach');
      assert.equal(await devtools.evaluate(`document.querySelector('#add-workspace').getAttribute('aria-label')`), 'Add workspace', 'the host’s node is left untouched in the DOM');

      /* Several Workspaces: only the first row shares the band, the rest keep
         their own line, and every row keeps one trailing edge. */
      await page(devtools, several);
      await settle(devtools);
      const rows = await devtools.evaluate(`Array.from(document.querySelectorAll('.jJkEga_projectRow')).map(row=>({key:row.getAttribute('data-row-key'),top:row.getBoundingClientRect().top,plus:row.querySelector('button:last-of-type').getBoundingClientRect().right}))`);
      const header2 = await devtools.evaluate(`document.querySelector('._7514NG_sectionHeader').getBoundingClientRect().top`);
      assert.equal(rows.length, 2);
      assert(Math.abs(rows[0].top - header2) < 1, 'the first group shares the band');
      assert(rows[1].top > rows[0].top + 34, 'the second group keeps its own line');
      assert(Math.abs(rows[0].plus - rows[1].plus) < 1, 'both groups share one trailing edge');

      /* Archived-only: the same line, with the archived row below it. */
      await page(devtools, archivedOnly);
      await settle(devtools);
      assert.equal(await devtools.evaluate(`document.querySelector('._7514NG_root').hasAttribute('data-ccd-header-merged')`), true);
      assert.equal(await devtools.evaluate(`getComputedStyle(document.querySelector('._7514NG_sectionLabel')).display`), 'none');
      assert.equal(await devtools.evaluate(`document.querySelector('.jJkEga_sessionRow.jJkEga_archived') !== null`), true);

      /* A search takes the band over: the field spans the line and the band is
         opaque, because the Workspace row stays laid out underneath it. */
      await page(devtools, searching);
      await settle(devtools);
      geometry = await devtools.evaluate(boxes);
      assert.equal(await devtools.evaluate(`getComputedStyle(document.querySelector('._7514NG_sectionHeader')).backgroundColor`), 'rgb(251, 251, 249)', 'the band covers the row while the field is up');
      assert.equal(await settled(devtools, '._7514NG_searchInput'), '1');
      assert(geometry.search.width >= geometry.header.width - 16, `the field spans the band (${geometry.search.width} of ${geometry.header.width})`);
      assert(Math.abs(geometry.header.y - geometry.row.y) < 1, 'the band still shares the row line');
      assert.equal(overlaps(geometry.search, geometry.title), true, 'the field covers the name rather than sitting beside it');

      /* No history: every group is off screen, so the header is the region's own
         title line and takes the reference's word. */
      await page(devtools, noHistory);
      await settle(devtools);
      assert.equal(await devtools.evaluate(`document.querySelector('._7514NG_root').hasAttribute('data-ccd-header-merged')`), false);
      assert.equal(await devtools.evaluate(`getComputedStyle(document.querySelector('._7514NG_sectionHeader')).position`), 'relative', 'the header returns to the flow');
      assert.equal(await devtools.evaluate(`document.querySelector('._7514NG_sectionLabel').textContent`), '最近会话');
      geometry = await devtools.evaluate(boxes);
      assert(geometry.header.bottom <= geometry.empty.y + 0.5, 'the prompt starts below the header line');
      assert.equal(await devtools.evaluate(`document.querySelector('[data-ccd-empty-state]') !== null`), true);
      await mkdir(join(root, 'artifacts'), { recursive: true });
      const emptyShot = await devtools.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 264, height: 420, scale: 2 } });
      await writeFile(join(root, 'artifacts/sidebar-header-empty.png'), Buffer.from(emptyShot.data, 'base64'));

      /* A flat list is the same title line, with the host's own word rewritten. */
      await page(devtools, flatList);
      await settle(devtools);
      assert.equal(await devtools.evaluate(`document.querySelector('._7514NG_root').hasAttribute('data-ccd-header-merged')`), false);
      assert.equal(await devtools.evaluate(`document.querySelector('._7514NG_sectionLabel').textContent`), '最近会话');
      assert.equal(await devtools.evaluate(`getComputedStyle(document.querySelector('#add-workspace')).display`), 'none', 'the region’s own title line carries no add workspace either');
      geometry = await devtools.evaluate(boxes);
      assert(geometry.search.x >= geometry.header.x, 'Search keeps its place on the title line');
      assert(geometry.options.right <= geometry.header.right + 0.5, 'the view options still end the line');

      /* The host re-renders the tree: the merge and the word are re-read. */
      await page(devtools, oneWorkspace);
      await settle(devtools);
      await devtools.evaluate(`document.querySelector('._7514NG_list').innerHTML=${JSON.stringify(aliasHostClasses(group('first', 'dsh-ccd-style', sessionRow('a', '你好')), PINNED_BUILD))}`);
      await settle(devtools);
      assert.equal(await devtools.evaluate(`document.querySelector('._7514NG_root').hasAttribute('data-ccd-header-merged')`), true, 'a re-rendered tree re-parks the header');
      await devtools.evaluate(`document.querySelector('._7514NG_list').innerHTML=''`);
      await settle(devtools);
      assert.equal(await devtools.evaluate(`document.querySelector('._7514NG_root').hasAttribute('data-ccd-header-merged')`), false, 'an empty tree hands the line back');

      /* Scrolling: the band is locked to the tree's content, so it leaves with
         the Workspace row it is parked on rather than hanging over the rows
         that scrolled up — and it leaves nothing behind: what has scrolled past
         the region's top edge is clipped, out of both the paint and the
         hit-test, and comes back on the way up. */
      await page(devtools, scrolling);
      await settle(devtools);
      const bandTop = `document.querySelector('._7514NG_sectionHeader').getBoundingClientRect().top`;
      const rowTop = `document.querySelector('#row-first').getBoundingClientRect().top`;
      const parked = await devtools.evaluate(`({band:${bandTop},row:${rowTop}})`);
      assert(Math.abs(parked.band - parked.row) < 1, 'the band starts on the row');
      /* The cell the parked cluster occupies while the tree is at its top. */
      const searchCell = `document.querySelector('#search-button').getBoundingClientRect().x + 14`;
      const searchCellHit = `(() => { const found = document.elementFromPoint(${searchCell}, document.querySelector('._7514NG_root').getBoundingClientRect().top + 17); return found?.closest('#search-button') !== null; })()`;
      assert.equal(await devtools.evaluate(searchCellHit), true, 'at rest the parked Search owns its cell');
      await devtools.evaluate(`document.querySelector('._7514NG_list').scrollTop = 120`);
      await settle(devtools);
      const scrolled = await devtools.evaluate(`({band:${bandTop},row:${rowTop},scroll:document.querySelector('._7514NG_list').scrollTop})`);
      assert.equal(scrolled.scroll, 120, 'the tree really scrolled');
      assert(Math.abs(scrolled.band - scrolled.row) < 1, 'the band keeps the row’s line once scrolled');
      assert(scrolled.band < parked.band - 100, `the band leaves with the content (${parked.band} → ${scrolled.band})`);
      assert.equal(await devtools.evaluate(`(() => { const band = document.querySelector('._7514NG_sectionHeader').getBoundingClientRect(); const region = document.querySelector('._7514NG_root').getBoundingClientRect(); return band.bottom <= region.top + 0.5; })()`), true, 'nothing parked is left inside the region');
      const hit = await devtools.evaluate(`(() => { const region = document.querySelector('._7514NG_root').getBoundingClientRect(); const found = document.elementFromPoint(region.left + region.width / 2, region.top + 10); return found?.closest('[data-row-key]')?.getAttribute('data-row-key') ?? found?.id ?? ''; })()`);
      assert.match(hit, /^session:|^workspace:/, `the rows own the region’s top, not the parked controls (${hit})`);
      assert.equal(await devtools.evaluate(`getComputedStyle(document.querySelector('._7514NG_root')).overflow`), 'hidden', 'the region clips what has scrolled out');
      /* The controls are hit-tested where they are drawn, not where they were:
         the cell the parked cluster used to occupy belongs to a row again. */
      assert.equal(await devtools.evaluate(searchCellHit), false, 'the parked Search takes no click at the cell it no longer occupies');
      assert.equal(await devtools.evaluate(`(() => { const search = document.querySelector('#search-button').getBoundingClientRect(); const region = document.querySelector('._7514NG_root').getBoundingClientRect(); return search.bottom <= region.top; })()`), true, 'the parked controls are out of the region');
      await devtools.evaluate(`document.querySelector('._7514NG_list').scrollTop = 0`);
      await settle(devtools);
      const back = await devtools.evaluate(`({band:${bandTop},row:${rowTop},scroll:document.querySelector('._7514NG_list').scrollTop})`);
      assert.equal(back.scroll, 0);
      assert.equal(await devtools.evaluate(aliasHostClasses(`document.querySelector('._7514NG_root').style.getPropertyValue('--ccd-header-scroll')`, PINNED_BUILD)), '0px', 'the distance is published back at the top');
      assert(Math.abs(back.band - parked.band) < 1, 'the band comes back to the region’s top');
      assert.equal(await devtools.evaluate(`(() => { const region = document.querySelector('._7514NG_root').getBoundingClientRect(); const found = document.elementFromPoint(region.left + region.width / 2, region.top + 10); return found?.closest('#row-first') !== null; })()`), true, 'the row and its band are hittable again at the top');

      /* A search opened over a scrolled tree: the field is part of the band, so
         it leaves with it and takes no clicks in the region it no longer
         covers. */
      await page(devtools, scrollingSearch);
      await settle(devtools);
      await devtools.evaluate(`document.querySelector('._7514NG_list').scrollTop = 120`);
      await settle(devtools);
      assert(Math.abs(await devtools.evaluate(`document.querySelector('._7514NG_sectionHeader').getBoundingClientRect().top - document.querySelector('#row-first').getBoundingClientRect().top`)) < 1, 'the field keeps the row’s line once scrolled');
      assert.equal(await devtools.evaluate(`(() => { const region = document.querySelector('._7514NG_root').getBoundingClientRect(); const found = document.elementFromPoint(region.left + 40, region.top + 17); return found?.closest('._7514NG_searchSlot') !== null || found?.closest('._7514NG_search') !== null; })()`), false, 'the scrolled-out field takes no click inside the region');

      /* A replaced scroller starts a scroll away from the top, and the band
         follows the new element rather than the old distance. */
      await devtools.evaluate(`document.querySelector('._7514NG_list').scrollTop = 120`);
      await settle(devtools);
      await devtools.evaluate(`document.querySelector('._7514NG_treeBody').innerHTML='<div class="_7514NG_list">' + document.querySelector('._7514NG_list').innerHTML + '</div>'`);
      await settle(devtools);
      assert.equal(await devtools.evaluate(aliasHostClasses(`document.querySelector('._7514NG_root').style.getPropertyValue('--ccd-header-scroll')`, PINNED_BUILD)), '0px', 'a fresh scroller hands the band back to the top');

      /* The collapsed rail is this region's other layout and keeps the host's own
         add-workspace control: it is the only entry there, and the plugin's rule
         is scoped to the expanded root, so the rail's own line is untouched. */
      await page(devtools, rail);
      await settle(devtools);
      assert.equal(await devtools.evaluate(`document.querySelector('._7514NG_root').hasAttribute('data-ccd-header-merged')`), false, 'a rail tree has no group to merge with');
      assert.equal(await settled(devtools, '#add-workspace'), '1');
      assert.notEqual(await devtools.evaluate(`getComputedStyle(document.querySelector('#add-workspace')).display`), 'none', 'the rail keeps the host’s own button');

      /* Release: the marker goes and the host's own word returns. */
      await page(devtools, noHistory);
      await settle(devtools);
      await devtools.evaluate('window.releaseHeader()');
      await settle(devtools);
      assert.equal(await devtools.evaluate(`document.querySelector('._7514NG_root').hasAttribute('data-ccd-header-merged')`), false);
      assert.equal(await devtools.evaluate(`document.querySelector('._7514NG_sectionLabel').textContent`), '工作区');
      assert.deepEqual(await devtools.evaluate('window.errors'), []);

      /* The proof shots: two Workspaces, resting and with the pointer on the
         first group's line — the second state is where the row's own menu is back
         and the reference's line reads name, row actions, Search, view options,
         with no add-workspace control anywhere on it. */
      await page(devtools, several);
      await settle(devtools);
      await mkdir(join(root, 'artifacts'), { recursive: true });
      const capture = async name => {
        const shot = await devtools.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 264, height: 140, scale: 2 } });
        await writeFile(join(root, 'artifacts', name), Buffer.from(shot.data, 'base64'));
      };
      await devtools.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 418 });
      await devtools.evaluate('new Promise(resolve=>setTimeout(resolve,150))');
      await capture('sidebar-header-merged.png');
      const hover = await devtools.evaluate(`(()=>{const r=document.querySelector('#row-first').getBoundingClientRect();return{x:r.x+40,y:r.y+r.height/2}})()`);
      await devtools.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(hover.x), y: Math.round(hover.y) });
      await devtools.evaluate('new Promise(resolve=>setTimeout(resolve,150))');
      await capture('sidebar-header-hover.png');
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});

test('the browsing header speaks both shipped builds', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 20000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, contents: `
      import {mountBrowserHeader} from './src/client/compat/browser-header.ts';
      window.releaseHeader=mountBrowserHeader(document,error=>{throw error});
    ` }, bundle: true, write: false, format: 'iife',
  });
  for (const hostBuild of [PINNED_BUILD, WINDOWS_BUILD]) {
    const profile = await mkdtemp(join(tmpdir(), `ccd-sidebar-header-${hostBuild.id}-`));
    try {
      await withPage({ url: 'about:blank', width: 300, height: 420, scale: 1, profile }, async devtools => {
        await devtools.evaluate(`document.documentElement.lang='en';document.documentElement.dataset.dshCcdStyle='true';document.documentElement.dataset.platform=${JSON.stringify(hostBuild === WINDOWS_BUILD ? 'win32' : 'darwin')};document.body.innerHTML=${JSON.stringify(aliasHostClasses(oneWorkspace, hostBuild))};const style=document.createElement('style');style.textContent=${JSON.stringify(aliasHostClasses(`${hostCss}\n${styles}`, hostBuild))};document.head.append(style);`);
        await devtools.evaluate(bundle.outputFiles[0].text);
        await devtools.evaluate('new Promise(resolve=>setTimeout(resolve,20))');
        assert.equal(await devtools.evaluate(aliasHostClasses(`document.querySelector('._7514NG_root').hasAttribute('data-ccd-header-merged')`, hostBuild)), true, `${hostBuild.id}: the region reports its merged header`);
        const geometry = await devtools.evaluate(aliasHostClasses(`(()=>{const header=document.querySelector('._7514NG_sectionHeader').getBoundingClientRect();const row=document.querySelector('.jJkEga_projectRow').getBoundingClientRect();const plus=document.querySelector('.jJkEga_rowActions button:last-of-type').getBoundingClientRect();const search=document.querySelector('._7514NG_searchButton').getBoundingClientRect();return{headerTop:header.top,rowTop:row.top,plusRight:plus.right,searchLeft:search.left}})()`, hostBuild));
        assert(Math.abs(geometry.headerTop - geometry.rowTop) < 1, `${hostBuild.id}: the band shares the row line`);
        assert(geometry.plusRight <= geometry.searchLeft + 0.5, `${hostBuild.id}: the plus clears Search`);
      });
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  }
});
