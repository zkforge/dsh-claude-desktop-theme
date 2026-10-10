import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, PINNED_BUILD, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Local Chrome enables browser coverage. */ }

/*
 * The right panel's floating card, in a real renderer, on the record the
 * reference fixes: 8px in from the column's top, right and bottom edges; the
 * card's own 12px corner, white surface, hairline outline and shadow; the
 * Files tree's 24px rows, disclosure chevrons and per-file glyphs.
 *
 * The fixture is the host's own tree: the frame's three tracks, the panel the
 * occupant draws against the column's right edge, DockKit's surface / tab strip
 * / pane / divider boxes, and the Files pane's header and entry rows. Its
 * native sheet is the host's own CSS for those boxes (AppFrame, SidebarRight,
 * DockLayout and FilesBody), so what the assertions read is this plugin's
 * override winning over the real rules rather than over nothing.
 *
 * Everything the plugin selects is addressed by the packages' stable data
 * hooks, so the same run is made on both shipped builds: the Windows one hashes
 * every class differently, and a card that only worked through class names
 * would come out unstyled there.
 */

const COLUMN_WIDTH = 532;
const TRACK_LEFT = 928;

/** The path data the host's own glyphs draw, one per kind of row. */
const FOLDER_MARK = 'M2 4h4l2 2h6v7H2z';
const FILE_MARK = 'M4 2h5l3 3v9H4z';
/** A stand-in for the strip's controls and the pane's reload button. */
const glyphSvg = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 8h10M8 3v10"/></svg>';
const titleIcon = '<svg class="AmqDYq_titleIcon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"><path d="M2 3h12M2 8h12M2 13h8"/></svg>';

/** One tree row: `entry` is the host's own `data-files-entry` value. */
function row(entry, name, { expanded, children = '' } = {}) {
  const glyph = entry === 'directory' ? FOLDER_MARK : FILE_MARK;
  const className = entry === 'directory' ? 'AmqDYq_icon' : 'AmqDYq_fileIcon';
  const body = `<button type="button" class="AmqDYq_row"${expanded === undefined ? '' : ` aria-expanded="${expanded}"`}>`
    + `<svg class="${className}" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"><path d="${glyph}"/></svg>`
    + `<span class="AmqDYq_name">${name}</span></button>`;
  return `<li class="AmqDYq_item" data-files-entry="${entry}" data-files-path="/w/${name}">${body}${children}</li>`;
}

/** The Files pane as `FilesBody.tsx` renders it, with a level open. */
const filesPane = `<div class="AmqDYq_root" data-files-state="tree" data-files-root="/Users/zoukai/code/dsh-ccd-style">
<div class="AmqDYq_header"><span class="AmqDYq_path" data-files-path data-path-label title="/Users/zoukai/code/dsh-ccd-style"><span class="AmqDYq_text"><span class="AmqDYq_directory">~/code/</span><span class="AmqDYq_name">dsh-ccd-style</span></span></span><button type="button" class="AmqDYq_tool" data-files-reload aria-label="Reload">${glyphSvg}</button></div>
<div class="AmqDYq_body" data-files-body><ul class="AmqDYq_level">
${[
  row('directory', '.cache'),
  row('directory', 'artifacts', { expanded: 'true', children: `<ul class="AmqDYq_level">${row('file', 'shot.png')}</ul>` }),
  row('directory', 'docs'),
  row('file', 'AGENTS.md'),
  row('file', 'cordis.patch.yml'),
  row('file', 'LICENSE'),
].join('')}
</ul></div></div>`;

/** One dock column: the tab strip (with the panel's own chrome) over a body. */
function column(id, { title, tabBody, empty = false, withChrome = false }) {
  return `<div class="${empty ? '_6nhg2_emptyTabHost' : '_6nhg2_tabCell'}"${empty ? ' data-dockkit-empty' : ` data-dockkit-host="dock" data-dockkit-column="${id}"`} style="grid-column:${id * 2 + 1};grid-row:1">
<section class="_6nhg2_tabHost _6nhg2_pane" data-dockkit-content="t${id}" data-dockkit-pane="p${id}" tabindex="-1" data-dockkit-pane-active>
<div class="_6nhg2_tabHostHeader"><div class="_6nhg2_tabStrip" role="tablist" data-dockkit-strip="p${id}">
<div class="_6nhg2_stripTabs">${empty ? '' : `<div role="tab" aria-selected="true" class="_6nhg2_tab _6nhg2_tabActive" data-dockkit-tab="t${id}"><span class="_6nhg2_tabTitle" data-dockkit-tab-title>${titleIcon}${title}</span></div>`}</div>
<div class="_6nhg2_stripFill"></div>
<span><button type="button" class="_6nhg2_iconButton" data-dockkit-split-button="p${id}" aria-label="Split">${glyphSvg}</button></span>
${withChrome ? `<div class="_6nhg2_stripChrome" data-dockkit-strip-chrome><button type="button" class="irMxjq_iconButton" data-sidebar-right-mode="fullscreen" aria-label="Full">${glyphSvg}</button><button type="button" class="irMxjq_iconButton" data-sidebar-right-toggle aria-label="Collapse">${glyphSvg}</button></div>` : ''}
</div></div>
<div class="_6nhg2_tabHostBody"><div class="_6nhg2_paneBody">${empty ? '<p class="_6nhg2_empty">No tab is open in this column.</p>' : `<div class="irMxjq_tabBody">${tabBody}</div>`}</div></div>
</section></div>`;
}

/** A split panel: one dock column per pane, the divider between them. */
function layout(columns) {
  const divider = columns.length > 1
    ? `<div class="_6nhg2_divider _6nhg2_tabLayoutDivider" data-dockkit-divider="root:0" style="grid-column:2;grid-row:1"></div>` : '';
  return `<div class="_6nhg2_tabLayout" style="grid-template-columns:${columns.map(() => 'minmax(0, 1fr)').join(' 0px ')}">${columns.join('')}${divider}</div>`;
}

const fixture = `<main data-slot="root"><div class="_6Qf49G_frame" id="frame" style="grid-template-columns:264px minmax(400px, 1fr) minmax(0px, ${COLUMN_WIDTH}px)">
<div class="_6Qf49G_sidebarCol"><div data-slot="sidebar"></div></div>
<div class="_6Qf49G_centerCol" id="center"></div>
<div class="_6Qf49G_rightbarCol" id="rightbar">
<div class="irMxjq_session" data-sidebar-right-session="s1" style="display:contents">
<div class="irMxjq_panel" id="panel" data-sidebar-right-panel="push" data-sidebar-right-open style="width:${COLUMN_WIDTH}px;--dsh-sidebar-width:${COLUMN_WIDTH}px">
<div class="irMxjq_panelBody"><div class="_6nhg2_surface" data-dockkit-surface data-dockkit-drop-zones="horizontal" id="surface">${layout([column(0, { title: 'Files', tabBody: filesPane, withChrome: true })])}</div></div>
</div></div>
</div>
</div>
<div class="_6Qf49G_handle" data-side="rightbar" id="handle" style="left:${TRACK_LEFT}px"></div>
</div></main>`;

/* The host's own rules for exactly these boxes: AppFrame's frame and columns,
   SidebarRight's panel, DockLayout's surface / strip / tab / pane / divider and
   FilesBody's tree — including the fills this plugin has to outrank (the
   pane's `bg-base`, the active tab's tag fill and column 0's own hairline). */
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
._6nhg2_iconButton,.irMxjq_iconButton{display:inline-flex;flex:none;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;color:var(--dsw-alias-label-secondary);line-height:1;background:transparent;border:none;border-radius:var(--dsw-radius-sm);cursor:pointer}
._6nhg2_iconButton:hover,.irMxjq_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}
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
.AmqDYq_name{white-space:nowrap;text-overflow:ellipsis;min-width:0;overflow:hidden}
.AmqDYq_tool{width:28px;height:28px;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm);cursor:pointer;background:0 0;border:none;flex:none;justify-content:center;align-items:center;padding:6px;line-height:1;display:inline-flex}
`;

const CARD_SURFACE = 'rgb(255, 255, 255)';
const CARD_BORDER = 'rgb(215, 215, 214)';
const ROW_LINE = 'rgb(227, 227, 225)';
const MUTED = 'rgb(143, 143, 138)';
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
    computedWidth:s.width,computedHeight:s.height,computedTop:s.top,computedPosition:s.position,
    background:s.backgroundColor,borderWidth:s.borderTopWidth,borderColor:s.borderTopColor,
    radius:s.borderTopLeftRadius,shadow:s.boxShadow,display:s.display,color:s.color,
    mask:s.maskImage,transform:s.transform,marginLeft:s.marginLeft,marginTop:s.marginTop,
    paddingLeft:s.paddingLeft,fontSize:s.fontSize,lineHeight:s.lineHeight};
})()`);

test('the right panel is a floating card at every size, over the host’s own tree', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 60000,
}, async () => {
  const styles = (await Promise.all([
    'src/client/theme/tokens.css',
    'src/client/features/shell/shell.css',
    'src/client/features/shell/right-panel.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');

  for (const buildInfo of [PINNED_BUILD, WINDOWS_BUILD]) {
    const windows = buildInfo === WINDOWS_BUILD;
    const profile = await mkdtemp(join(tmpdir(), 'ccd-rightbar-card-test-'));
    try {
      await withPage({ url: 'about:blank', width: 1280, height: 800, scale: 2, profile }, async page => {
        await page.evaluate(`
          document.documentElement.dataset.dshCcdStyle='true';
          document.documentElement.dataset.platform=${JSON.stringify(windows ? 'win32' : 'darwin')};
          document.body.innerHTML=${JSON.stringify(aliasHostClasses(fixture, buildInfo))};
          const native=document.createElement('style');
          native.textContent=${JSON.stringify(aliasHostClasses(nativeStyles, buildInfo))};
          document.head.append(native);
          const style=document.createElement('style');
          style.textContent=${JSON.stringify(aliasHostClasses(styles, buildInfo))};
          document.head.append(style);
          window.pluginStyles=[style];
          /* The host's right handle: pointer capture, then a dx report against
             the drag origin, exactly as AppFrame's DragHandle does. */
          const panel=document.getElementById('panel');
          const handle=document.getElementById('handle');
          const origin={x:0,base:${COLUMN_WIDTH}};
          handle.addEventListener('pointerdown',event=>{
            handle.setPointerCapture(event.pointerId);
            origin.x=event.clientX;origin.base=parseFloat(panel.style.width);
          });
          handle.addEventListener('pointermove',event=>{
            if(!handle.hasPointerCapture(event.pointerId))return;
            const width=Math.round(origin.base-(event.clientX-origin.x));
            panel.style.width=width+'px';
            panel.style.setProperty('--dsh-sidebar-width',width+'px');
            handles.width=width;
          });
          const handles={width:${COLUMN_WIDTH}};
          window.handles=handles;`);

        const surface = await measure(page, '#surface');
        const track = await measure(page, '#rightbar');

        /* Inset on the top, right and bottom edges, and the card's own material:
           the reference's corner, surface, hairline outline and shadow. */
        assert.equal(surface.right, track.right - 8);
        assert.equal(surface.top, track.top + 8);
        assert.equal(surface.bottom, track.bottom - 8);
        assert.equal(surface.left, track.right - COLUMN_WIDTH + 8);
        assert.equal(surface.background, CARD_SURFACE);
        assert.equal(surface.borderWidth, '1px');
        assert.equal(surface.borderColor, CARD_BORDER);
        assert.equal(surface.radius, '12px');
        assert.match(surface.shadow, /rgba\(0, 0, 0, 0\.04\) 0px 1px 3px/u);
        assert.match(surface.shadow, /rgba\(0, 0, 0, 0\.08\) 0px 5px 14px/u);
        /* The panes give up their own canvas fill, so the card is one surface
           and no second column edge is drawn inside it. */
        assert.equal((await measure(page, '[data-dockkit-pane]')).background, TRANSPARENT);
        assert.equal((await measure(page, '[data-dockkit-pane]')).borderWidth, '0px');

        /* The header line: the reference's 32px strip, with the title's mark
           tinted behind the glyph the host draws. */
        const strip = await measure(page, '[data-dockkit-strip]');
        assert.equal(strip.height, 32);
        const title = await measure(page, '[data-dockkit-tab-title] > svg');
        assert.equal(title.width, 24);
        assert.equal(title.height, 24);
        assert.equal(title.background, TINT);
        assert.equal(title.radius, '6px');
        assert.equal(title.color, ACCENT);

        /* The pane's own header is the reference's rounded field: 26px, one
           hairline, 8px in from the card's sides and 3px under the strip. */
        const field = await measure(page, '[data-files-root] > div:not([data-files-body])');
        assert.equal(field.height, 26);
        assert.equal(field.borderWidth, '1px');
        assert.equal(field.borderColor, ROW_LINE);
        assert.equal(field.radius, '6px');
        assert.equal(field.marginLeft, '8px');
        assert.equal(field.marginTop, '3px');
        assert.equal(field.left, surface.left + 9);
        assert.equal(field.top, surface.top + 1 + 32 + 3);

        /* The tree's rows: the reference's 24px pitch, a disclosure chevron on a
           directory (the host's folder glyph gone, the shared chevron turned a
           quarter when the row says it is open) and the host's own type glyph
           before a file. */
        const first = await measure(page, '[data-files-entry="directory"] > button');
        const second = await measure(page, '[data-files-entry="directory"]:nth-of-type(2) > button');
        assert.equal(first.height, 24);
        assert.equal(second.top - first.top, 24);
        assert.equal(first.left, surface.left + 9);
        const folder = await measure(page, '[data-files-entry="directory"] > button > svg');
        assert.equal(folder.display, 'none');
        const chevron = await measure(page, '[data-files-entry="directory"] > button', '::before');
        assert.equal(chevron.computedWidth, '16px');
        assert.equal(chevron.computedHeight, '16px');
        assert.equal(chevron.color, MUTED);
        assert.match(chevron.mask, /url\("data:image\/svg\+xml/u);
        assert.equal(chevron.transform, 'none');
        const openChevron = await measure(page, '[data-files-entry="directory"]:nth-of-type(2) > button', '::before');
        assert.equal(openChevron.transform, 'matrix(0, 1, -1, 0, 0, 0)');
        const fileGlyph = await measure(page, '[data-files-entry="file"] > button > svg');
        assert.equal(fileGlyph.width, 16);
        assert.equal(fileGlyph.color, MUTED);
        assert.equal(fileGlyph.display, 'block');
        /* The name is the reference's 29px in from the card's inner edge — the
           pane's 8px gutter, the row's own 3px and the 16px mark with its 2px
           step — and a level below adds the host's own 18px. */
        const name = await measure(page, '[data-files-path="/w/AGENTS.md"] > button > span');
        assert.equal(name.left, surface.left + 1 + 29);
        const nested = await measure(page, '[data-files-path="/w/shot.png"] > button > span');
        assert.equal(nested.left, surface.left + 1 + 29 + 18);
        const openRow = await measure(page, '[data-files-path="/w/artifacts"] > button');
        assert.equal(openRow.height, 24);

        /* The single-column card is the shot that stands beside the reference. */
        if (!windows) {
          await mkdir(join(root, 'artifacts'), { recursive: true });
          const shot = await page.send('Page.captureScreenshot', {
            format: 'png', clip: { x: 740, y: 0, width: 540, height: 800, scale: 1 },
          });
          await writeFile(join(root, 'artifacts/rightbar-card-files.png'), Buffer.from(shot.data, 'base64'));
        }

        /* The drag handle keeps the column's own left edge: its 8px strip is
           centred on the track boundary, clear of the card's inset, and a drag
           over it still resizes the panel — the card follows the width and
           keeps its inset. */
        const hit = await page.evaluate(`(()=>{
          const at=x=>document.elementFromPoint(x,300)?.id ?? null;
          return {outside:at(${TRACK_LEFT - 3}), inside:at(${TRACK_LEFT + 3}), beyond:at(${TRACK_LEFT + 10})};
        })()`);
        assert.equal(hit.outside, 'handle');
        assert.equal(hit.inside, 'handle');
        assert.notEqual(hit.beyond, 'handle');
        await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: TRACK_LEFT, y: 300, button: 'left', clickCount: 1 });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: TRACK_LEFT - 60, y: 300, button: 'left' });
        await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: TRACK_LEFT - 60, y: 300, button: 'left', clickCount: 1 });
        const widened = await measure(page, '#surface');
        const widenedColumn = await measure(page, '#rightbar');
        assert.equal(await page.evaluate('window.handles.width'), COLUMN_WIDTH + 60);
        assert.equal(widened.right, widenedColumn.right - 8);
        assert.equal(widened.left, widenedColumn.right - COLUMN_WIDTH - 60 + 8);
        await page.evaluate(`(()=>{const panel=document.getElementById('panel');panel.style.width=${COLUMN_WIDTH}+'px';panel.style.setProperty('--dsh-sidebar-width',${COLUMN_WIDTH}+'px');})()`);

        /* Full screen: the panel spans the window, so the same inset reads as
           the window's own four sides. */
        await page.evaluate(`(()=>{
          const panel=document.getElementById('panel');
          panel.dataset.sidebarRightPanel='fullscreen';
          panel.style.width='100vw';
          document.getElementById('frame').setAttribute('data-rightbar-fullscreen','');})()`);
        const full = await measure(page, '#surface');
        const fullFrame = await measure(page, '#frame');
        assert.equal(full.left, fullFrame.left + 8);
        assert.equal(full.right, fullFrame.right - 8);
        assert.equal(full.top, fullFrame.top + 8);
        assert.equal(full.bottom, fullFrame.bottom - 8);
        await page.evaluate(`(()=>{
          const panel=document.getElementById('panel');
          panel.dataset.sidebarRightPanel='push';
          panel.style.width=${COLUMN_WIDTH}+'px';
          document.getElementById('frame').removeAttribute('data-rightbar-fullscreen');})()`);

        /* Collapsed: the panel keeps the column's height while it slides out, so
           the card's paint is scoped to the open state and nothing hangs over
           the centre column. */
        await page.evaluate(`document.getElementById('panel').removeAttribute('data-sidebar-right-open')`);
        const closed = await measure(page, '#surface');
        assert.equal(closed.background, TRANSPARENT);
        assert.equal(closed.borderWidth, '0px');
        assert.equal(closed.shadow, 'none');
        await page.evaluate(`document.getElementById('panel').setAttribute('data-sidebar-right-open','')`);

        /* The split state: two columns share the one card, the divider between
           them is the reference's hairline starting under the header line. */
        await page.evaluate(`(()=>{
          const surface=document.getElementById('surface');
          surface.innerHTML = ${JSON.stringify(layout([column(0, { title: 'Files', tabBody: filesPane, withChrome: true }), column(1, { title: 'Preview', tabBody: '', empty: true })]))};
        })()`);
        const divider = await measure(page, '[data-dockkit-divider]', '::before');
        assert.equal(divider.computedPosition, 'absolute');
        assert.equal(divider.computedTop, '32px');
        assert.equal(divider.background, ROW_LINE);
        const emptyLine = await measure(page, '[data-dockkit-empty] [data-dockkit-pane] > div:last-child > div > p');
        assert.equal(emptyLine.color, MUTED);
        assert.equal(emptyLine.fontSize, '13px');
        const emptyBox = await measure(page, '[data-dockkit-empty] [data-dockkit-pane] > div:last-child > div');
        assert.equal(emptyBox.display, 'flex');
        const secondColumn = await measure(page, '[data-dockkit-empty] > [data-dockkit-pane]');
        assert.equal(secondColumn.background, TRANSPARENT);

        if (!windows) {
          const shot = await page.send('Page.captureScreenshot', {
            format: 'png', clip: { x: 740, y: 0, width: 540, height: 800, scale: 1 },
          });
          await writeFile(join(root, 'artifacts/rightbar-card-split.png'), Buffer.from(shot.data, 'base64'));
        }
      });
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  }
});
