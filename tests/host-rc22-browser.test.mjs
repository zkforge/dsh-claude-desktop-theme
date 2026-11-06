import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Browser coverage requires Chrome. */ }

// Minimal DOM from Windows rc22 c59d10af FileNavigator, Menu, Modal and
// UserContent/MarkdownText. No host event handlers or React-owned nodes move.
const rows = '<ul><li data-files-entry="file" data-files-path="C:/demo/a.ts"><div style="display:flex"><button style="display:flex"><svg></svg><span>a.ts</span></button><div data-accessory><button>more</button></div></div></li><li data-files-entry="file" data-files-path="C:/demo/b.md"><div><button><svg></svg><span>b.md</span></button><div data-accessory></div></div></li></ul>';

test('rc22 shared primitives and both FileNavigator modes retain plugin behavior', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 60000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: root, contents: `
    import {mountFilesPane} from './src/client/compat/files-pane.ts';
    import {hostSelectors,menuRowClasses} from './src/client/compat/host-dom.ts';
    import {mountSchedulePage} from './src/client/compat/schedule-page.ts';
    import {mountScheduleDetail} from './src/client/compat/schedule-detail.ts';
    import {mountScheduleCardMenus} from './src/client/compat/schedule-card-menu.ts';
    import {createDomPort} from './src/client/compat/dom.ts';
    window.selectors=hostSelectors(document);window.classes=menuRowClasses(document);
    window.mount=()=>window.release=mountFilesPane(document,e=>{throw e});
    window.schedule=()=>{
      const port={list:async()=>[{id:'t',target:{kind:'new'},title:'Paused task',prompt:'demo',status:'paused'}],history:async()=>{throw Error('legacy history called')},subscribe:()=>()=>{}};
      const stops=[mountSchedulePage(document,e=>{throw e}),mountScheduleDetail(document,port,e=>{throw e}),mountScheduleCardMenus(document,{find:()=>{throw Error('legacy delete called')},remove:()=>{throw Error('legacy delete called')}},e=>{throw e})];
      window.releaseSchedule=()=>stops.reverse().forEach(stop=>stop());
    };
    window.style=css=>createDomPort(document).mountStyles(css);
  ` }, bundle: true, write: false, format: 'iife' });
  const css = (await Promise.all(['src/client/theme/tokens.css','src/client/theme/base.css','src/client/theme/dialogs.css','src/client/theme/schedule.css','src/client/features/conversation/conversation.css','src/client/features/right-panel/right-panel.css'].map(path=>readFile(join(root,path),'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(),'ccd-rc22-'));
  try {
    await withPage({url:'about:blank',width:1200,height:800,profile},async page=>{
      await page.evaluate(`document.documentElement.dataset.platform='win32';document.documentElement.dataset.dshCcdStyle='true';${bundle.outputFiles[0].text};window.style(${JSON.stringify(css)});`);
      const shared = await page.evaluate(`(()=>{
        document.body.innerHTML='<div class="_itemLabel_1p5el_208"></div><article class="_markdown_rve47_5"></article><div class="_dialog_14mp3_33"></div><div data-message-bubble>hello</div>';
        const row=document.createElement('button');row.className=window.classes.item;document.body.append(row);
        return {menu:!!document.querySelector(window.selectors.menuItemLabel),markdown:!!document.querySelector(window.selectors.markdownBody),row:row.classList.contains('_item_1p5el_105'),select:getComputedStyle(document.querySelector('[data-message-bubble]')).userSelect,dialog:getComputedStyle(document.querySelector('._dialog_14mp3_33')).borderRadius};
      })()`);
      assert.equal(shared.menu,true);assert.equal(shared.markdown,true);assert.equal(shared.row,true);
      assert.equal(shared.select,'text');assert.notEqual(shared.dialog,'0px');
      for (const legacy of [false,true]) {
        for (const session of [false,true]) {
          await page.evaluate(`document.body.innerHTML='<article class="an3WzG_root" data-phase="hero"><header class="an3WzG_header an3WzG_headerBlank ${legacy&&!session?'an3WzG_headerSessionless':''}"></header><div data-conversation-content ${session?'data-conversation-session="s"':''}></div></article>'`);
          assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('header')).minHeight`),session?'40px':'50px');
        }
      }
      for (const preview of [false,true]) {
        const fixture = `<section data-sidebar-right-panel data-sidebar-right-session="s"><div data-dockkit-content="${preview?'preview':'files'}"><aside data-files-navigator="pane1" data-files-root="C:/demo" style="display:flex;flex-direction:column;width:260px">${preview?'<div role="separator" tabindex="0" style="width:4px;height:100px"></div>':''}<div data-files-body>${rows}</div></aside></div></section>`;
        await page.evaluate(`document.body.innerHTML=${JSON.stringify(fixture)};window.original=document.querySelector('[role=separator]');window.mount();`);
        assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-files-filter] input')`),true);
        assert.equal(await page.evaluate(`!!document.querySelector('[role=separator] [data-ccd-files-filter]')`),false);
        assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-files-entry] > div > button')).minHeight`),'24px');
        assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-files-entry] > div > button > svg')).display`),'none');
        assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-accessory] > button')).minHeight`),'0px');
        if(preview) assert.equal(await page.evaluate(`getComputedStyle(window.original).height`),'100px');
        await page.evaluate(`(()=>{const input=document.querySelector('[data-ccd-files-filter] input');input.value='a.ts';input.dispatchEvent(new Event('input'));})()`);
        assert.equal(await page.evaluate(`document.querySelector('[data-files-path="C:/demo/b.md"]').hasAttribute('data-ccd-files-hidden')`),true);
        await page.evaluate(`window.release()`);
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-files-filter],[data-ccd-files-header],[data-ccd-files-tree]').length`),0);
        if(preview) assert.equal(await page.evaluate(`document.querySelector('[role=separator]')===window.original`),true);
      }
      // TaskManagerPage rc22: four statuses, nested searchTools + cleanup,
      // split creation, and native editable detail. Preserve React handlers.
      await page.evaluate(`document.body.innerHTML='<section data-testid="task-manager-page"><div><div><div><div><h1>Tasks</h1><div><button id="chat">Create</button><button id="manual">Method</button></div></div><div><div role="group"><button>Active</button><button>Paused</button><button>Ended</button><button>All</button></div></div><div><div><input type="search"><button id="clear">Clear</button></div><button id="cleanup">Clean ended</button></div><div><ul><li><button id="task" aria-describedby="detail-metadata-t"><span><span>Paused task</span><span><span>Paused</span><span>Daily</span></span></span></button></li></ul></div></div></div></div><aside id="detail"><button id="run">Run</button><button id="pause">Resume</button></aside></section>';window.nativeClicks=[];for(const id of ['task','manual','cleanup','clear','run','pause'])document.getElementById(id).onclick=()=>window.nativeClicks.push(id);window.schedule();`);
      await page.evaluate('new Promise(resolve=>setTimeout(resolve,30))');
      await page.evaluate(`document.getElementById('task').click();document.getElementById('manual').click();document.getElementById('cleanup').click();document.getElementById('run').click();document.getElementById('pause').click()`);
      assert.deepEqual(await page.evaluate('window.nativeClicks'),['task','manual','cleanup','run','pause'],'task selection and native editing actions must reach host handlers');
      assert.equal(await page.evaluate(`document.querySelector('[data-testid]').hasAttribute('data-ccd-schedule-native')`),true);
      assert.equal(await page.evaluate(`document.querySelectorAll('.ccd-schedule-detail,.ccd-schedule-card-more').length`),0);
      assert.notEqual(await page.evaluate(`getComputedStyle(document.getElementById('cleanup')).display`),'none');
      assert.equal(await page.evaluate(`(()=>{const search=document.querySelector('[data-ccd-schedule-part="search-tools"]').getBoundingClientRect();const list=document.querySelector('[data-ccd-schedule-part="list"]').getBoundingClientRect();return search.bottom<=list.top})()`),true,'cleanup and list occupy distinct grid rows');
      await page.evaluate(`document.querySelector('[data-ccd-schedule-tool="search"]').click();document.querySelector('.ccd-schedule-search-close').click()`);
      assert.deepEqual(await page.evaluate('window.nativeClicks'),['task','manual','cleanup','run','pause','clear']);
      assert.equal(await page.evaluate(`(()=>{const search=document.querySelector('[data-ccd-schedule-part="search-tools"]').getBoundingClientRect();const list=document.querySelector('[data-ccd-schedule-part="list"]').getBoundingClientRect();return search.bottom<=list.top})()`),true);
      await page.evaluate('window.releaseSchedule()');
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-schedule-native],[data-ccd-schedule-part]').length`),0);

    });
  } finally { await rm(profile,{recursive:true,force:true,maxRetries:6,retryDelay:150}); }
});
