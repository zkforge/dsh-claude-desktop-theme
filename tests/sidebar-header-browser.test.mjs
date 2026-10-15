import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, PINNED_BUILD, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';

/* The browsing toolbar stays above the tree; project actions share its right edge. */

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

const several = region({
  tree: [group('first', 'dsh-ccd-style', sessionRow('a', '你好')), group('second', 'other-project', sessionRow('b', 'Second'))].join(''),
});
const noHistory = region({ tree: group('first', 'dsh-ccd-style', '', true), empty: true });
const flatList = region({
  label: '会话',
  tree: `<div class="_7514NG_flatList">${sessionRow('a', '你好')}${sessionRow('b', '第二条')}</div>`,
});
const searching = region({ tree: group('first', 'dsh-ccd-style', sessionRow('a', '你好')), header: header('工作区', true) });

/* One Workspace with more Sessions than the column holds, so the tree scrolls. */
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

const styles = (await Promise.all(['src/client/theme/tokens.css', 'src/client/features/sidebar/sidebar.css']
  .map(path => readFile(join(root, path), 'utf8')))).join('\n');

test('the separate browsing toolbar and compact project actions support both builds', {
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
        for (const fixture of [several, searching, flatList, noHistory, rail]) {
          await devtools.evaluate(`{document.documentElement.lang='en';document.documentElement.dataset.dshCcdStyle='true';document.documentElement.dataset.platform=${JSON.stringify(hostBuild === WINDOWS_BUILD ? 'win32' : 'darwin')};document.body.innerHTML=${JSON.stringify(aliasHostClasses(fixture, hostBuild))};document.head.querySelector('style')?.remove();const style=document.createElement('style');style.textContent=${JSON.stringify(aliasHostClasses(`${hostCss}\n${styles}`, hostBuild))};document.head.append(style);}`);
          await devtools.evaluate(bundle.outputFiles[0].text);
          await devtools.evaluate('new Promise(resolve=>setTimeout(resolve,20))');
          const geometry = await devtools.evaluate(aliasHostClasses(boxes, hostBuild));
          if (fixture === several) {
            assert(Math.abs(geometry.header.bottom - geometry.row.y - 4) < 0.5, 'toolbar overlaps only the project row’s 4px padding');
            assert.equal(geometry.plus.width, 22);
            assert.equal(geometry.plus.height, 22);
            assert.equal(geometry.searchButton.width, 22);
            assert.equal(geometry.options.width, 22);
            const trailing = await devtools.evaluate(aliasHostClasses(`({
              first:document.querySelector('#plus-first').getBoundingClientRect().right,
              second:document.querySelector('#plus-second').getBoundingClientRect().right,
              row:document.querySelector('#row-first').getBoundingClientRect().right
            })`, hostBuild));
            assert(Math.abs(trailing.first - trailing.second) < 0.5, 'project actions align across groups');
            assert(Math.abs(trailing.row - trailing.first - 4) < 0.5, 'actions use the row trailing inset');
          }
          if (fixture === searching) assert(geometry.header.bottom - geometry.row.y <= 4.5, 'expanded search overlaps only the project row’s empty padding');
          if (fixture === flatList || fixture === noHistory) {
            assert.equal(await devtools.evaluate(aliasHostClasses(`document.querySelector('._7514NG_sectionLabel').textContent`, hostBuild)), '最近会话');
          }
          const addDisplay = await devtools.evaluate(`getComputedStyle(document.querySelector('#add-workspace')).display`);
          if (fixture === rail) assert.notEqual(addDisplay, 'none');
          else assert.equal(addDisplay, 'none');
          await devtools.evaluate('window.releaseHeader()');
        }
      });
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  }
});
