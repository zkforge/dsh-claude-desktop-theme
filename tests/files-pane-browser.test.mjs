import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Local Chrome enables browser coverage. */ }

/*
 * The Files pane's own controls, in a real renderer, over the host's own DOM.
 *
 * The host package draws a root path, a reload button, the open-in-app actions
 * and a tree of rows — and nothing else: no filter, no tree control, no landing
 * state. `compat/files-pane.ts` supplies those, and `right-panel.css` dresses
 * them; this test holds both to the reference (DESIGN.md §6.9, measured at
 * @2x): the 26px field in a 32px header row with
 * no rule under it, the page and angle-bracket marks on the rows, the tab's
 * three-row list on its tinted square, the empty column's folder over two lines
 * of copy, and the strip's 26px control pitch in the pane's own near-black.
 *
 * The fixture is the host's own DOM — DockKit's pane, strip, chrome and empty
 * column, and `FilesBody`'s header and rows — over the host's own CSS for those
 * boxes, so what the assertions read is this plugin's override winning rather
 * than a box that had no styling to begin with.
 */

const WINDOW_WIDTH = 1280;
const COLUMN_WIDTH = 532;
const RIGHTBAR_LEFT = WINDOW_WIDTH - COLUMN_WIDTH;

/** The path data the host's own glyphs draw, one per kind of row. */
const FOLDER_MARK = 'M2 4h4l2 2h6v7H2z';
const FILE_MARK = 'M4 2h5l3 3v9H4z';
/** A stand-in for the strip's own controls and the pane's reload button. */
const glyphSvg = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 8h10M8 3v10"/></svg>';
/** The Files tab's title mark, as `FilesTitle` draws it. */
const titleIcon = '<svg class="AmqDYq_titleIcon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"><path d="M2 4h4l2 2h6v7H2z"/></svg>';

/** One tree row: `entry` is the host's own `data-files-entry` value. */
function row(entry, name, { path, expanded, children = '' } = {}) {
  const glyph = entry === 'directory' ? FOLDER_MARK : FILE_MARK;
  const className = entry === 'directory' ? 'AmqDYq_icon' : 'AmqDYq_fileIcon';
  const body = `<button type="button" class="AmqDYq_row"${expanded === undefined ? '' : ` aria-expanded="${expanded}"`}>`
    + `<svg class="${className}" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"><path d="${glyph}"/></svg>`
    + `<span class="AmqDYq_name">${name}</span></button>`;
  const at = path ?? `/w/${name}`;
  return `<li class="AmqDYq_item" data-files-entry="${entry}" data-files-path="${at}">${body}${children}</li>`;
}

/** The Files pane as `FilesBody.tsx` renders it, with one level open. */
const filesPane = `<div class="AmqDYq_root" data-files-state="tree" data-files-root="/Users/zoukai/code/dsh-ccd-style">
<div class="AmqDYq_header"><span class="AmqDYq_path" data-files-path data-path-label title="/Users/zoukai/code/dsh-ccd-style"><span class="AmqDYq_text"><span class="AmqDYq_directory">~/code/</span><span class="AmqDYq_name">dsh-ccd-style</span></span></span><button type="button" class="AmqDYq_tool" data-files-reload aria-label="Reload">${glyphSvg}</button><span class="AmqDYq_actions"><button type="button" class="iq4beG_split" aria-label="Open in app">${glyphSvg}</button></span></div>
<div class="AmqDYq_body" data-files-body><ul class="AmqDYq_level">
${[
  row('directory', 'src', { expanded: 'true', children: `<ul class="AmqDYq_level">${row('file', 'index.ts')}</ul>` }),
  row('directory', 'tests'),
  row('file', 'AGENTS.md'),
  row('file', 'cordis.patch.yml'),
  row('file', 'LICENSE'),
  row('file', 'package.json'),
].join('')}
</ul></div></div>`;

/** A pane's tab strip, with the panel's own chrome on the column that has it. */
function strip(id, { tab = true, chrome = false } = {}) {
  return `<div class="_6nhg2_tabHostHeader"><div class="_6nhg2_tabStrip" role="tablist" data-dockkit-strip="p${id}">
<div class="_6nhg2_stripTabs">${tab ? `<div role="tab" aria-selected="true" class="_6nhg2_tab _6nhg2_tabActive" data-dockkit-tab="t${id}"><span class="_6nhg2_tabTitle" data-dockkit-tab-title>${titleIcon}文件</span></div>` : ''}</div>
<button type="button" class="_6nhg2_addTab" data-dockkit-add-tab="p${id}" aria-label="新建页签">${glyphSvg}</button>
<div class="_6nhg2_stripFill"></div>
<span><button type="button" class="_6nhg2_iconButton" data-dockkit-split-button="p${id}" aria-label="拆分面板">${glyphSvg}</button></span>
${chrome ? `<div class="_6nhg2_stripChrome" data-dockkit-strip-chrome><button type="button" class="irMxjq_iconButton" data-sidebar-right-mode="fullscreen" aria-label="全屏">${glyphSvg}</button><button type="button" class="irMxjq_iconButton" data-sidebar-right-toggle aria-label="收起侧边栏">${glyphSvg}</button></div>` : ''}
</div></div>`;
}

/** One dock pane: its strip over its body. */
function pane(id, body, options = {}) {
  return `<section class="_6nhg2_tabHost _6nhg2_pane" data-dockkit-content="t${id}" data-dockkit-pane="p${id}" tabindex="-1"${id === 0 ? ' data-dockkit-pane-active' : ''}>
${strip(id, options)}
<div class="_6nhg2_tabHostBody"><div class="_6nhg2_paneBody">${body}</div></div>
</section>`;
}

/** The panel: the Files pane in column 0, an unclaimed column beside it. */
const fixture = `<main data-slot="root"><div class="_6Qf49G_frame" id="frame" style="grid-template-columns:264px minmax(400px, 1fr) minmax(0px, ${COLUMN_WIDTH}px)">
<div class="_6Qf49G_sidebarCol"><div data-slot="sidebar"></div></div>
<div class="_6Qf49G_centerCol" id="center"></div>
<div class="_6Qf49G_rightbarCol" id="rightbar">
<div class="irMxjq_session" data-sidebar-right-session="s1" style="display:contents">
<div class="irMxjq_panel" id="panel" data-sidebar-right-panel="push" data-sidebar-right-open style="width:${COLUMN_WIDTH}px;--dsh-sidebar-width:${COLUMN_WIDTH}px">
<div class="irMxjq_panelBody"><div class="_6nhg2_surface" data-dockkit-surface id="surface">
<div class="_6nhg2_tabLayout" style="grid-template-columns:minmax(0, 1fr) 0px minmax(0, 1fr)">
<div class="_6nhg2_tabCell" data-dockkit-host="dock" data-dockkit-column="0" style="grid-column:1;grid-row:1">${pane(0, `<div class="irMxjq_tabBody">${filesPane}</div>`, { chrome: true })}</div>
<div class="_6nhg2_divider _6nhg2_tabLayoutDivider" data-dockkit-divider="root:0" style="grid-column:2;grid-row:1"></div>
<div class="_6nhg2_emptyTabHost" data-dockkit-empty style="grid-column:3;grid-row:1">${pane(1, '<p class="_6nhg2_empty">空面板</p>', { tab: false })}</div>
</div>
</div></div>
</div></div>
</div>
</div></div>
<div class="_6Qf49G_handle" data-side="rightbar" style="left:${RIGHTBAR_LEFT}px"></div>
</div></main>`;

/* The host's own rules for exactly these boxes: AppFrame's frame and columns,
   SidebarRight's panel, DockLayout's surface / strip / tab / pane / empty column
   and FilesBody's header and rows. */
const nativeStyles = `
:root{--dsw-alias-bg-base:#fcfcfb;--dsw-specific-sidebar-fill:#fbfbfa;--dsw-alias-border-l3:#e3e3e1;--dsw-alias-border-l4:#e6e6e4;--dsw-alias-interactive-bg-hover:#eceff4;--dsw-alias-label-primary:#1f1f1d;--dsw-alias-label-secondary:#6f6f6a;--dsw-alias-label-tertiary:#8f8f8a;--dsw-alias-markdown-tag:#eef1f5;--dsw-radius-sm:6px;--dsh-dockkit-dock-layer:10}
*{box-sizing:border-box}
body{margin:0;background:#eaeae8;font-family:system-ui;font-size:13px}
[data-slot=root]{height:100%}
._6Qf49G_frame{display:grid;grid-template-rows:100%;height:100%;position:relative;overflow:hidden;background:#fbfbfa}
._6Qf49G_sidebarCol{min-width:0;overflow:hidden;background:var(--dsw-specific-sidebar-fill);border-right:.5px solid var(--dsw-alias-border-l3)}
._6Qf49G_centerCol{display:flex;flex-direction:column;min-width:0;overflow:hidden;background:var(--dsw-alias-bg-base)}
._6Qf49G_rightbarCol{min-width:0;position:relative;overflow:visible}
._6Qf49G_handle{cursor:col-resize;z-index:11;touch-action:none;width:8px;margin-left:-4px;position:absolute;top:0;bottom:0}
.irMxjq_panel{pointer-events:none;flex-direction:column;min-width:0;display:flex;position:absolute;top:0;bottom:0;right:0}
.irMxjq_panelBody{flex:auto;min-height:0;display:flex}
._6nhg2_surface{display:flex;flex:1 1 auto;min-width:0;min-height:0}
._6nhg2_tabLayout{display:grid;flex:1 1 auto;grid-template-rows:minmax(0,1fr);min-width:0;min-height:0}
._6nhg2_tabCell,._6nhg2_emptyTabHost{display:flex;min-width:0;min-height:0;z-index:var(--dsh-dockkit-dock-layer, 10)}
._6nhg2_tabHost{min-width:0;min-height:0;pointer-events:auto}
._6nhg2_tabHost:not(._6nhg2_float),._6nhg2_emptyTabHost{background:var(--dsw-alias-bg-base)}
._6nhg2_tabCell[data-dockkit-host=dock][data-dockkit-column="0"]>._6nhg2_tabHost{border-left:.5px solid var(--dsw-alias-border-l4)}
._6nhg2_pane{display:flex;flex:1 1 auto;flex-direction:column;min-width:0;min-height:0;overflow:hidden}
._6nhg2_tabStrip{display:flex;flex:none;gap:4px;align-items:center;height:28px;padding:10px 6px 0 var(--dsh-dockkit-strip-inline-start, 10px)}
._6nhg2_stripTabs{display:flex;flex:0 1 auto;align-items:center;min-width:0;overflow-x:auto}
._6nhg2_stripFill{flex:1 1 0;min-width:0}
._6nhg2_stripChrome{display:flex;flex:none;gap:8px;align-items:center;height:28px;margin-left:4px}
._6nhg2_tab{position:relative;display:flex;flex:0 1 auto;align-items:center;min-width:80px;max-width:170px;height:28px;padding:0 10px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1;white-space:nowrap;border-radius:var(--dsw-radius-sm);cursor:pointer}
._6nhg2_tabActive{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-markdown-tag)}
._6nhg2_tabTitle{display:flex;flex:1 1 auto;gap:5px;align-items:center;min-width:0;overflow:hidden;line-height:1.4}
._6nhg2_iconButton,.irMxjq_iconButton,._6nhg2_addTab{display:inline-flex;flex:none;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;color:var(--dsw-alias-label-secondary);line-height:1;background:transparent;border:none;border-radius:var(--dsw-radius-sm);cursor:pointer}
._6nhg2_iconButton:hover,.irMxjq_iconButton:hover,._6nhg2_addTab:hover{background:var(--dsw-alias-interactive-bg-hover)}
._6nhg2_tabHostBody{position:relative;min-width:0;flex:1 1 auto;display:flex;flex-direction:column}
._6nhg2_paneBody{position:relative;flex:1 1 auto;min-width:0;min-height:0;overflow:auto}
._6nhg2_empty{margin:0;padding:12px;color:var(--dsw-alias-label-tertiary);font-size:13px}
._6nhg2_tabLayoutDivider{position:relative;z-index:1;flex:none;touch-action:none;width:0;cursor:col-resize;pointer-events:auto}
._6nhg2_tabLayoutDivider:before{content:"";position:absolute;top:0;bottom:0;left:-.25px;width:.5px;background:var(--dsw-alias-border-l4)}
.irMxjq_tabBody{flex-direction:column;min-width:0;height:100%;min-height:0;display:flex;overflow:hidden}
.AmqDYq_root{height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:13px;flex-direction:column;flex:auto;line-height:1.5;display:flex}
.AmqDYq_header{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;align-items:center;gap:4px;height:38px;padding:0 6px 0 16px;display:flex}
.AmqDYq_body{scrollbar-gutter:stable;flex:auto;min-height:0;margin-right:2px;padding:8px 0 8px 8px;overflow:auto}
.AmqDYq_level{margin:0;padding:0;list-style:none}
.AmqDYq_level .AmqDYq_level{padding-left:18px}
.AmqDYq_item{margin:0;padding:0}
.AmqDYq_row{width:100%;min-width:0;color:inherit;font:inherit;text-align:left;border-radius:var(--dsw-radius-md);cursor:pointer;background:0 0;border:0;align-items:center;gap:6px;padding:5px 10px;display:flex}
.AmqDYq_row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.AmqDYq_icon{color:var(--dsw-alias-label-tertiary);flex:none}
.AmqDYq_fileIcon{color:#4a76ce;flex:none}
.AmqDYq_name{white-space:nowrap;text-overflow:ellipsis;min-width:0;overflow:hidden}
.AmqDYq_tool{width:28px;height:28px;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;border:none;flex:none;justify-content:center;align-items:center;padding:6px;line-height:1;display:inline-flex}
.AmqDYq_path{color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

const CARD_SURFACE = 'rgb(255, 255, 255)';
const BORDER = 'rgb(227, 227, 225)';
const MUTED = 'rgb(143, 143, 138)';
const INK = 'rgb(11, 11, 11)';
const ACCENT = 'rgb(75, 118, 206)';
const TINT = 'rgb(211, 226, 249)';
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** Read a box and a few computed values for one selector. */
const measure = (page, selector, pseudo = null) => page.evaluate(`(()=>{
  const element=document.querySelector(${JSON.stringify(selector)});
  if(element===null)return null;
  const r=element.getBoundingClientRect();
  const s=getComputedStyle(element${pseudo === null ? '' : `,${JSON.stringify(pseudo)}`});
  return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,
    computedWidth:s.width,computedHeight:s.height,
    background:s.backgroundColor,borderColor:s.borderTopColor,borderWidth:s.borderTopWidth,
    radius:s.borderTopLeftRadius,shadow:s.boxShadow,display:s.display,color:s.color,
    mask:s.maskImage,maskSize:s.maskSize,transform:s.transform,gap:s.columnGap,
    paddingTop:s.paddingTop,paddingLeft:s.paddingLeft,fontSize:s.fontSize,lineHeight:s.lineHeight};
})()`);

/** Type into the filter as a reader does: the value, then one input event. */
const type = (page, value) => page.evaluate(`(()=>{
  const input=document.querySelector('[data-ccd-files-filter] > input');
  input.value=${JSON.stringify(value)};
  input.dispatchEvent(new Event('input',{bubbles:true}));
})()`);

/** What the pane currently draws, row by row: the name and whether it shows. */
const visibleRows = page => page.evaluate(`Array.from(
  document.querySelectorAll('[data-files-root] [data-files-entry]'),
  item => [item.querySelector('.AmqDYq_name').textContent, getComputedStyle(item).display !== 'none'],
)`);

const pause = () => new Promise(resolve => setTimeout(resolve, 40));

/** The panel as the reader sees it, for the artifacts the docs point at. */
const capture = async (page, name) => {
  await mkdir(join(root, 'artifacts'), { recursive: true });
  const shot = await page.send('Page.captureScreenshot', {
    format: 'png', clip: { x: RIGHTBAR_LEFT, y: 0, width: COLUMN_WIDTH, height: 620, scale: 2 },
  });
  await writeFile(join(root, 'artifacts', name), Buffer.from(shot.data, 'base64'));
};

test('the Files pane carries the reference’s filter, tree control, marks and landing state', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 60000,
}, async () => {
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'ts',
      contents: `
        import {mountFilesPane} from './src/client/compat/files-pane.ts';
        window.mountPane = () => window.release = mountFilesPane(document, error => { throw error; });
      `,
    },
    bundle: true, write: false, format: 'iife',
  });
  const script = bundle.outputFiles[0].text;
  const styles = (await Promise.all([
    'src/client/theme/tokens.css',
    'src/client/theme/base.css', 'src/client/features/right-panel/frame.css',
    'src/client/features/right-panel/right-panel.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-files-pane-test-'));

  try {
    await withPage({ url: 'about:blank', width: WINDOW_WIDTH, height: 800, scale: 2, profile }, async page => {
      await page.evaluate(`
        document.documentElement.dataset.dshCcdStyle='true';
        document.documentElement.dataset.platform='darwin';
        document.documentElement.lang='zh-CN';
        document.body.innerHTML=${JSON.stringify(fixture)};
        const native=document.createElement('style');
        native.textContent=${JSON.stringify(nativeStyles)};
        document.head.append(native);
        const style=document.createElement('style');
        style.textContent=${JSON.stringify(styles)};
        document.head.append(style);
        ${script}
        window.mountPane();
      `);
      await pause();

      /* --- the header line: the filter's seat, and no rule under it --------- */
      const field = await measure(page, '[data-ccd-files-filter]');
      assert.equal(field.height, 26, 'the field is the reference’s 26px box');
      assert.equal(field.radius, '8px', 'and its 8px corner');
      assert.equal(field.borderColor, BORDER, 'a hairline outline');
      assert.equal(field.background, CARD_SURFACE, 'on the card’s own surface');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-files-filter] > input').placeholder`),
        '搜索文件名…', 'the field leads with this plugin’s own copy, in the document’s language');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-files-toggle]').getAttribute('aria-label')`),
        '收起文件树', 'and the tree control is named the same way');
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-files-path]')).display`), 'none',
        'the host’s root path gives its seat to the filter');

      const header = await measure(page, '[data-files-root] > div:not([data-files-body])');
      assert.equal(header.height, 32, 'the header row is the reference’s 32px line');
      assert.equal(header.borderWidth, '0px', 'with no rule under it');
      assert.equal(header.paddingLeft, '8px', 'and the field 8px in from the card’s edge');

      const order = await page.evaluate(`(()=>{
        const header=document.querySelector('[data-files-root] > div:not([data-files-body])');
        return Array.from(header.children, child =>
          child.hasAttribute('data-ccd-files-toggle') ? 'toggle'
            : child.hasAttribute('data-ccd-files-filter') ? 'field'
            : child.hasAttribute('data-files-path') ? 'path'
            : child.hasAttribute('data-files-reload') ? 'reload' : 'actions');
      })()`);
      assert.deepEqual(order, ['toggle', 'field', 'path', 'reload', 'actions'],
        'the pane’s own controls lead the row, the host’s keep their seats');
      const reload = await measure(page, '[data-files-reload]');
      assert.equal(reload.width, 28, 'the host’s reload keeps its box');
      assert.ok(reload.left > field.right, 'and sits after the field');

      /* --- the rows: the reference’s two marks ----------------------------- */
      const doc = await measure(page, '[data-files-path="/w/AGENTS.md"] > button', '::before');
      const code = await measure(page, '[data-files-path="/w/package.json"] > button', '::before');
      const yml = await measure(page, '[data-files-path="/w/cordis.patch.yml"] > button', '::before');
      assert.equal(doc.computedWidth, '16px', 'a file’s mark keeps the host’s 16px seat');
      assert.equal(doc.color, MUTED, 'in the reference’s muted ink');
      assert.match(doc.mask, /data:image\/svg\+xml/, 'and is a plugin-drawn mask');
      assert.notEqual(doc.mask, code.mask, 'prose keeps the page and code the brackets');
      assert.equal(code.mask, yml.mask, 'every code extension shares one mark');
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-files-path="/w/package.json"] > button > svg')).display`),
        'none', 'the host’s own coloured glyph is not drawn');
      const name = await measure(page, '[data-files-path="/w/package.json"] > button > .AmqDYq_name');
      const card = await measure(page, '#surface');
      assert.equal(Math.round(name.left - card.left), 33, 'the name lands on the reference’s 33px');
      const body = await measure(page, '[data-files-body]');
      assert.equal(body.paddingTop, '8px', 'and the first row 8px under the header');

      /* --- the filter ------------------------------------------------------ */
      await type(page, 'co');
      await pause();
      assert.deepEqual(await visibleRows(page), [
        ['src', false], ['index.ts', false], ['tests', false],
        ['AGENTS.md', false], ['cordis.patch.yml', true], ['LICENSE', false], ['package.json', false],
      ], 'a query narrows the loaded rows to the names that carry it');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-files-nomatch]').hidden`), true,
        'a query with a hit shows no line under the list');

      await type(page, 'index');
      await pause();
      assert.deepEqual(await visibleRows(page), [
        ['src', true], ['index.ts', true], ['tests', false],
        ['AGENTS.md', false], ['cordis.patch.yml', false], ['LICENSE', false], ['package.json', false],
      ], 'a hit inside a directory keeps the directory that holds it');
      assert.equal(await page.evaluate(`document.querySelector('[data-path-label]').textContent`),
        '~/code/dsh-ccd-style', 'the host’s own label is untouched, only not drawn');

      await type(page, 'nothing-matches');
      await pause();
      await capture(page, 'files-pane-filtered.png');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-files-nomatch]').hidden`), false,
        'a query with no hit says so');
      assert.equal(await page.evaluate(`!document.querySelector('[data-ccd-files-clear]').hidden`), true,
        'and the field offers its clear control');

      await page.evaluate(`(()=>{
        const input=document.querySelector('[data-ccd-files-filter] > input');
        input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      })()`);
      await pause();
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-files-filter] > input').value`), '',
        'Escape clears the query');
      assert.deepEqual(await visibleRows(page), [
        ['src', true], ['index.ts', true], ['tests', true],
        ['AGENTS.md', true], ['cordis.patch.yml', true], ['LICENSE', true], ['package.json', true],
      ], 'and every row comes back');

      /* --- the tree control ------------------------------------------------ */
      await page.evaluate(`document.querySelector('[data-ccd-files-toggle]').click()`);
      await pause();
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-files-body]')).display`), 'none',
        'the control puts the tree away');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-files-toggle]').getAttribute('aria-expanded')`), 'false',
        'and says so');
      const expand = await measure(page, '[data-ccd-files-expand]');
      assert.equal(expand.display, 'flex', 'the pane keeps a way back');
      assert.equal(expand.color, MUTED, 'in the row’s own muted ink');
      await capture(page, 'files-pane-collapsed.png');
      await page.evaluate(`document.querySelector('[data-ccd-files-expand]').click()`);
      await pause();
      assert.notEqual(await page.evaluate(`getComputedStyle(document.querySelector('[data-files-body]')).display`), 'none',
        'the row brings the tree back');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-files-toggle]').getAttribute('aria-expanded')`), 'true',
        'and the header control follows');

      /* --- the tab’s mark --------------------------------------------------- */
      assert.equal(await page.evaluate(`!!document.querySelector('[data-dockkit-tab][data-ccd-files-tab]')`), true,
        'the Files tab is the one marked');
      const mark = await measure(page, '[data-ccd-files-mark]');
      const glyph = await measure(page, '[data-ccd-files-mark]', '::before');
      assert.equal(mark.width, 24, 'the mark is the reference’s 24px square');
      assert.equal(mark.background, TINT, 'on its own tint');
      assert.equal(glyph.color, 'rgb(48, 78, 145)', 'with the reference’s deeper blue ink');
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-dockkit-tab-title] > svg')).display`),
        'none', 'the host’s category-coloured folder gives up the seat');

      /* --- the strip’s controls -------------------------------------------- */
      const chrome = await page.evaluate(`(()=>{
        const buttons=Array.from(document.querySelectorAll('[data-dockkit-strip-chrome] button'));
        const boxes=buttons.map(b=>b.getBoundingClientRect());
        return {widths:boxes.map(b=>b.width), pitch:Math.round(boxes[1].left-boxes[0].left),
          ink:getComputedStyle(buttons[0]).color,
          split:document.querySelector('[data-dockkit-split-button]').getBoundingClientRect().width};
      })()`);
      assert.deepEqual(chrome.widths, [26, 26], 'the chrome’s controls are the reference’s 26px seats');
      assert.equal(chrome.pitch, 26, 'that touch');
      assert.equal(chrome.ink, INK, 'in the pane’s own near-black');
      assert.equal(chrome.split, 26, 'and the split control joins them');

      /* --- the empty column ------------------------------------------------ */
      const empty = await measure(page, '[data-ccd-files-empty]');
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-ccd-files-empty-source]')).display`),
        'none', 'the host’s one-line note is not drawn');
      const centres = await page.evaluate(`(()=>{
        const block=document.querySelector('[data-ccd-files-empty]');
        const b=block.getBoundingClientRect(), p=block.parentElement.getBoundingClientRect();
        return {dx:(b.left+b.right)/2-(p.left+p.right)/2, dy:(b.top+b.bottom)/2-(p.top+p.bottom)/2};
      })()`);
      assert.ok(Math.abs(centres.dx) < 1, 'the landing state is centred in its column');
      assert.ok(Math.abs(centres.dy) < 1, 'both ways');
      const emptyMark = await measure(page, '[data-dockkit-empty] [data-ccd-files-empty-mark]');
      const emptyTitle = await measure(page, '[data-dockkit-empty] [data-ccd-files-empty-title]');
      const emptyBody = await measure(page, '[data-dockkit-empty] [data-ccd-files-empty-body]');
      assert.equal(emptyMark.width, 28, 'a 28px folder leads it');
      assert.equal(emptyMark.color, MUTED, 'in the muted ink');
      assert.equal(emptyTitle.color, INK, 'the title is the pane’s own ink');
      assert.equal(emptyTitle.fontSize, '13px', 'and the reference’s 13px');
      assert.equal(Math.round(emptyTitle.top - emptyMark.bottom), 12, '12px under the folder');
      assert.equal(emptyBody.color, MUTED, 'the line under it is the muted one');
      assert.equal(Math.round(emptyBody.top - emptyTitle.bottom), 4, '4px under the title');
      assert.equal(await page.evaluate(`document.querySelector('[data-dockkit-empty] [data-ccd-files-empty-title]').textContent`),
        '打开的文件会显示在这里');
      assert.equal(await page.evaluate(`document.querySelector('[data-dockkit-empty] [data-ccd-files-empty-body]').textContent`),
        '在文件树中选择一个文件，或点击对话中的文件路径。');

      /* --- the copy follows the document’s language ------------------------ */
      /* DSH points `<html lang>` at the locale, and re-points it when the
         reader switches language, so the nodes already on screen follow. */
      await page.evaluate(`document.documentElement.lang='en'`);
      await pause();
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-files-filter] > input').placeholder`),
        'Search file names…', 'a language change rewrites the field in place');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-files-toggle]').getAttribute('aria-label')`),
        'Hide file tree');
      assert.equal(await page.evaluate(`document.querySelector('[data-dockkit-empty] [data-ccd-files-empty-title]').textContent`),
        'Open files appear here', 'and the landing state with it');
      await page.evaluate(`document.documentElement.lang='zh-CN'`);
      await pause();
      assert.equal(await page.evaluate(`document.querySelector('[data-dockkit-empty] [data-ccd-files-empty-title]').textContent`),
        '打开的文件会显示在这里', 'and back again');

      await capture(page, 'files-pane.png');

      /* --- release ---------------------------------------------------------- */
      await page.evaluate(`window.release()`);
      await pause();
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-files-filter],[data-ccd-files-toggle],[data-ccd-files-mark],[data-ccd-files-empty],[data-ccd-files-nomatch],[data-ccd-files-expand]').length`),
        0, 'releasing takes every node back');
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-files-tab]').length`), 0,
        'and every marker with it');
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});
