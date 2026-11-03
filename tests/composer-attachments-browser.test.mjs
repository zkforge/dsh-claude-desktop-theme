import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, PINNED_BUILD, WINDOWS_BUILD, MACOS_BUILD } from '../src/client/compat/host-builds.ts';

let chrome;
try { chrome = findChrome(); } catch { /* Optional browser coverage. */ }
const styles = (await Promise.all(['tokens', 'composer'].map(name =>
  readFile(new URL(`../src/client/theme/${name}.css`, import.meta.url), 'utf8')))).join('\n');
// InputBar, DraftEditor and ComposerAttachments use this tree and geometry in
// the shipped host. The inner AttachmentRail is a horizontal 64px tile strip.
const hostCss = `
*{box-sizing:border-box}body{margin:0;background:var(--ccd-canvas);font:14px/24px system-ui}
.yhfFVG_card{width:100%;display:flex;flex-direction:column;position:relative;gap:12px;padding-top:8px}
.yhfFVG_scroll{max-height:160px;margin-right:4px;overflow-y:auto}
.yhfFVG_grow{position:relative}
.yhfFVG_input{min-height:36px;white-space:pre-wrap;outline:none;padding:4px 8px 0 14px}
.yhfFVG_row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;padding:2px 8px 6px;min-width:0;container-type:inline-size}
.yhfFVG_tools{display:flex;align-items:center}
.yhfFVG_add,.yhfFVG_primary{display:grid;place-items:center;border:0}
.dVdiKa_rail{min-width:0;margin-bottom:-6px;padding:2px 10px 0}
.attachment-root{position:relative;min-width:0}.attachment-strip{display:flex;gap:10px;overflow:auto hidden;scrollbar-width:none}
.attachment-item{flex:none;height:64px}.dVdiKa_imageItem{position:relative;width:64px;height:64px}
.dVdiKa_thumbnail{width:64px;height:64px;padding:0;border:.5px solid #999;overflow:hidden}
.dVdiKa_thumbnail img{display:block;object-fit:cover;width:100%;height:100%}
`;
const tile = '<div class="attachment-item"><div class="dVdiKa_imageItem"><button class="dVdiKa_thumbnail"><img alt="演示图片" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'64\' height=\'64\'%3E%3Cpath fill=\'%23ce906b\' d=\'M0 0h64v64H0z\'/%3E%3C/svg%3E"></button></div></div>';
const markup = `<div class="yhfFVG_card">
<div data-slot="conversation.input.attachments" style="display:contents"><div class="dVdiKa_rail"><div class="attachment-root"><div class="attachment-strip">${tile}</div></div></div></div>
<div class="yhfFVG_scroll"><div class="yhfFVG_grow"><div class="yhfFVG_input" contenteditable="true"><p style="margin:0">描述任务或提出问题</p></div><div class="yhfFVG_placeholder">描述任务或提出问题</div></div></div>
<div class="yhfFVG_row"><div class="yhfFVG_tools"><button class="yhfFVG_add">+</button><span>本电脑</span></div><button class="yhfFVG_primary">↵</button></div></div>`;

for (const mode of ['seam', 'alignment']) test(`draft attachments: ${mode}`, {
  skip: chrome ? false : 'Chrome unavailable', timeout: 30000,
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ccd-attachments-'));
  try {
    await withPage({ url: 'about:blank', width: 900, height: 450, profile }, async page => {
      for (const build of [PINNED_BUILD, MACOS_BUILD, WINDOWS_BUILD]) for (const theme of ['light', 'dark']) for (const width of [770, 320]) {
        await page.evaluate(`(() => {
          document.documentElement.dataset.dshCcdStyle='true';
          document.body.toggleAttribute('data-ds-dark-theme', ${theme === 'dark'});
          document.head.innerHTML='<style>'+${JSON.stringify(aliasHostClasses(hostCss + styles, build))}+'</style>';
          document.body.innerHTML='<main style="width:${width}px;margin:60px auto">'+${JSON.stringify(aliasHostClasses(markup, build))}+'</main>';
          if (${width} === 320) {
            const strip=document.querySelector('.attachment-strip');
            strip.append(...Array.from({length:7},()=>strip.firstElementChild.cloneNode(true)));
            const input=document.querySelector('[contenteditable]');
            input.append(...Array.from({length:12},()=>input.firstElementChild.cloneNode(true)));
            input.focus();
          }
        })()`);
        const view = await page.evaluate(aliasHostClasses(`(() => {
          const rail=document.querySelector('.dVdiKa_rail').getBoundingClientRect();
          const input=document.querySelector('.yhfFVG_input');
          const text=document.createRange();text.selectNodeContents(input.firstChild);
          const tile=document.querySelector('.dVdiKa_thumbnail').getBoundingClientRect();
          const add=document.querySelector('.yhfFVG_add').getBoundingClientRect();
          const placeholder=document.querySelector('.yhfFVG_placeholder');
          return { seam:rail.bottom,x:rail.left+20,textLeft:text.getBoundingClientRect().left,
            tileLeft:tile.left,tileWidth:tile.width,tileHeight:tile.height,addRight:add.right,
            tileBottom:tile.bottom,stripBottom:document.querySelector('.attachment-strip').getBoundingClientRect().bottom,
            placeholderLeft:placeholder.getBoundingClientRect().left+parseFloat(getComputedStyle(placeholder).paddingLeft),
            railOverflow:document.querySelector('.attachment-strip').scrollWidth>document.querySelector('.attachment-strip').clientWidth,
            editorOverflow:document.querySelector('.yhfFVG_scroll').scrollHeight>document.querySelector('.yhfFVG_scroll').clientHeight,
            tileHit:document.elementFromPoint(tile.left+32,tile.top+32)?.closest('.dVdiKa_thumbnail')!==null };
        })()`, build));
        if (mode === 'alignment') {
          assert.equal(view.tileWidth, 120); assert.equal(view.tileHeight, 120);
          assert(view.tileBottom <= view.stripBottom, 'the enlarged preview fits inside the scrolling rail');
          assert.equal(view.tileLeft, view.textLeft, `${build.id}/${theme}: image and text share a left edge`);
          assert.equal(view.tileLeft, view.placeholderLeft);
          assert(view.addRight < view.textLeft, 'the plus has its own column');
          assert(view.tileHit, 'the shared backdrop leaves previews clickable');
          if (width === 320) {
            assert(view.railOverflow, 'multiple attachments scroll horizontally');
            assert(view.editorOverflow, 'a long draft scrolls independently');
          }
        } else {
          const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
          if (process.env.CCD_ATTACHMENT_CAPTURE) await writeFile(join(process.env.CCD_ATTACHMENT_CAPTURE, `attachments-${theme}.png`), Buffer.from(data, 'base64'));
          const pixels = await page.evaluate(`(async () => {
            const img=new Image();img.src='data:image/png;base64,${data}';await img.decode();
            const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
            const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);
            return Array.from({length:12},(_,i)=>Array.from(ctx.getImageData(${view.x},${view.seam}-6+i,1,1).data));
          })()`);
          assert(pixels.every(pixel => pixel.every((value,i) => value===pixels[0][i])),
            `${build.id}/${theme}: a flat fill across the join, got ${JSON.stringify(pixels)}`);
        }
      }
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 }); }
});
