import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Local Chrome enables browser coverage. */ }

const NATIVE = `
._6Qf49G_frame{position:absolute;inset:0}._6Qf49G_sidebarCol{position:absolute;left:0;top:0;bottom:0;width:280px}
*{box-sizing:border-box}body{margin:0;background:#eaeae8;font:13px system-ui}
.panel{position:absolute;right:0;top:0;bottom:0;width:600px;display:flex;flex-direction:column;pointer-events:none;padding:8px}
.surface{flex:1;display:flex;min-height:0}
.layout{display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr);flex:1;min-height:0}
.cell[data-dockkit-host=float]{z-index:60}.cell{display:flex;min-width:0;min-height:0;grid-column:1;grid-row:1}
[data-dockkit-content]{display:flex;flex-direction:column;min-width:0;min-height:0;flex:1;pointer-events:auto}
[data-dockkit-float]{position:fixed;overflow:hidden;background:#fff;z-index:60}
.header{flex:none}.body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto}
[data-dockkit-strip],[data-dockkit-float-grip]{display:flex;align-items:center;height:32px;flex:none;gap:4px}
[data-dockkit-float-title]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-dockkit-tab-title]{display:flex;align-items:center;gap:5px;min-width:0}
button{border:0;background:none;flex:none;cursor:pointer}.fill{flex:1;min-width:0}
[data-files-root]{height:100%;min-height:0;display:flex;flex-direction:column}
.filesHeader{display:flex;align-items:center;flex:none}
[data-files-body]{flex:1;min-height:0;overflow:auto}
[data-files-body] ul{list-style:none;padding:0;margin:0}
[data-files-entry]>button{display:flex;align-items:center;width:100%}
.browserRoot{height:100%;min-height:0;display:flex;flex-direction:column}.browserRoot>[aria-busy]{flex:1;min-height:0;position:relative}.browserRoot form{height:38px;display:flex;flex:none}
[hidden]{display:none!important}
`;

const fixture = session => `<div data-sidebar-right-session="${session}"><div class="panel" data-sidebar-right-panel="push" data-sidebar-right-open><div class="surface" data-dockkit-surface><div class="layout">
<div class="cell"><section data-dockkit-content="${session}-guide" data-dockkit-pane="dock"><div class="header"><div data-dockkit-strip><span data-dockkit-tab>Guide</span><span class="fill"></span><div data-dockkit-strip-chrome><button data-sidebar-right-mode="fullscreen" aria-label="全屏">full</button><button data-sidebar-right-toggle aria-label="收起侧边栏">hide</button></div></div></div><div class="body">Guide body</div></section></div>
</div></div></div></div>`;
const wait = page => page.evaluate('new Promise(resolve => setTimeout(resolve, 60))');
const boxes = page => page.evaluate(`Object.fromEntries([...document.querySelectorAll('[data-ccd-pane]:not([data-ccd-pane-inactive])')].map(node => {
 const b = node.getBoundingClientRect(); return [node.getAttribute('data-dockkit-content'), {x:b.x,y:b.y,width:b.width,height:b.height}]; }))`);
const click = (page, selector) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const drag = (page, key, delta, { up = true, pointer = 7 } = {}) => page.evaluate(`(() => {
 const node = document.querySelector('[data-ccd-pane-seam="${key}"]'); const b = node.getBoundingClientRect();
 const x=b.x+b.width/2,y=b.y+b.height/2,row=node.getAttribute('data-ccd-pane-axis')==='row';
 const send=(type,target,d,pointer=${pointer})=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:pointer,button:0,clientX:x+(row?0:d),clientY:y+(row?d:0)}));
 send('pointerdown',node,0);send('pointermove',window,${delta});${up ? "send('pointerup',window," + delta + ');' : ''}
})()`);

async function bundleAndSheet() {
  const sheet = (await Promise.all(['src/client/theme/tokens.css', 'src/client/features/shell/shell.css', 'src/client/features/shell/right-panel.css'].map(path => readFile(join(root,path),'utf8')))).join('\n');
  const bundle = await build({ stdin: { resolveDir: root, contents: `
import { mountRightPanes } from './src/client/compat/right-panes.ts';
import { mountFilesPane } from './src/client/compat/files-pane.ts';
window.errors=[];window.tabs=[];window.listeners=[];window.calls={float:[],dock:[],open:[],toggle:0};
window.session=()=>[...document.querySelectorAll('[data-sidebar-right-session]')].find(node=>!node.hidden)?.getAttribute('data-sidebar-right-session');
window.notify=()=>window.listeners.forEach(listener=>listener());
window.bodyFor=(tab)=>tab.kind==='files' ? '<div data-files-root="/repo"><div class="filesHeader"><span data-files-path>/repo</span><button data-files-reload aria-label="重新加载">reload</button><div data-slot="sidebar.right.tab.files.actions" style="display:contents"><button aria-label="Open folder in app">editor</button></div></div><div data-files-body><ul><li data-files-entry="file" data-files-path="/repo/README.md"><button><svg></svg><span>README.md</span></button></li><li data-files-entry="file" data-files-path="/repo/app.ts"><button><svg></svg><span>app.ts</span></button></li></ul></div></div>' : tab.kind==='browser' ? '<div class="browserRoot"><form><button type="button" disabled>back</button><button type="button" disabled>forward</button><button type="button" disabled>reload</button><div><input aria-label="Address"><button type="submit">Go</button></div></form><div aria-busy="false"><div>Enter URL</div></div></div>' : '<div data-test-content>'+tab.tabId+' content</div>';
window.add=(id,kind,session=window.session(),contentId)=>{
 const record={sessionId:session,tabId:id,kind,...(contentId?{contentId}:{})};window.tabs.push(record);
 const cell=document.createElement('div');cell.className='cell';cell.innerHTML='<section data-dockkit-content="'+id+'"><div class="body">'+window.bodyFor(record)+'</div></section>';
 document.querySelector('[data-sidebar-right-session="'+session+'"] .layout').append(cell);window.notify();
};
window.closeTab=id=>{
 window.tabs=window.tabs.filter(tab=>tab.tabId!==id);const node=document.querySelector('[data-dockkit-content="'+id+'"]');node?.parentElement.remove();window.notify();
};
const sidebar={openTabs:{getSnapshot:()=>window.tabs,subscribe:fn=>{window.listeners.push(fn);return()=>{window.listeners=window.listeners.filter(item=>item!==fn)}}},
 float:(id,rect)=>{
  window.calls.float.push({id,rect});const node=document.querySelector('[data-dockkit-content="'+id+'"]');
  if(!node||node.hasAttribute('data-dockkit-float'))return;
  node.parentElement.setAttribute('data-dockkit-host','float');node.setAttribute('data-dockkit-float','float-'+id);
  node.style.cssText='left:'+rect.x+'px;top:'+rect.y+'px;width:'+rect.width+'px;height:'+rect.height+'px';
  const header=document.createElement('div');header.className='header';header.innerHTML='<header data-dockkit-float-grip><div data-dockkit-float-title><span data-dockkit-tab-title>'+id+'</span></div><span class="fill"></span><button data-dockkit-float-dock>dock</button><button data-dockkit-float-close aria-label="关闭"><svg viewBox="0 0 16 16"><path d="M4 4l8 8m0-8-8 8"/></svg></button></header>';
  node.prepend(header);node.querySelector('[data-dockkit-float-close]').onclick=()=>window.closeTab(id);
  window.notify();
 },dock:id=>window.calls.dock.push(id),focus:id=>{window.focused=id;document.querySelectorAll('[data-dockkit-float-active]').forEach(node=>node.removeAttribute('data-dockkit-float-active'));document.querySelector('[data-dockkit-content="'+id+'"]')?.setAttribute('data-dockkit-float-active','')},
 openTab:kind=>{window.calls.open.push(kind);window.add(kind==='files'?'auto-files':'auto-terminal-'+window.calls.open.length,kind)},
 toggleExpanded:()=>{window.calls.toggle++;const node=document.querySelector('[data-sidebar-right-session="'+window.session()+'"] .panel');node.toggleAttribute('data-sidebar-right-open')}
};
document.addEventListener('click',event=>{if(event.target.closest('[data-sidebar-right-toggle]'))sidebar.toggleExpanded()});
const ctx={inject:(_names,fn)=>({dispose:fn({sidebarRight:sidebar})})};
window.mount=()=>{
 window.filesRelease=mountFilesPane(document,error=>window.errors.push(String(error)));
 window.release=mountRightPanes(ctx,document,error=>window.errors.push(String(error)));
};
` }, bundle:true,write:false,format:'iife' });
  return { sheet, script:bundle.outputFiles[0].text };
}

async function withFixture(callback) {
  const {sheet,script}=await bundleAndSheet();
  const profile=await mkdtemp(join(tmpdir(),'ccd-right-panes-'));
  try {
    await withPage({url:'about:blank',width:1200,height:830,scale:1,profile},async page=>{
      await page.evaluate(`document.documentElement.dataset.dshCcdStyle='true';document.documentElement.lang='zh';document.body.innerHTML=${JSON.stringify('<main class="_6Qf49G_frame"><aside class="_6Qf49G_sidebarCol"></aside>'+fixture('s1')+'</main>')};const style=document.createElement('style');style.textContent=${JSON.stringify(NATIVE+'\n'+sheet)};document.head.append(style);`);
      await page.evaluate(script);await page.evaluate('window.mount()');await wait(page);
      await callback(page);
      assert.deepEqual(await page.evaluate('window.errors'),[]);
      await page.evaluate('window.release();window.filesRelease()');
    });
  } finally { await rm(profile,{recursive:true,force:true,maxRetries:6,retryDelay:150}); }
}
const options={skip:chrome?false:'Chrome unavailable',timeout:60000};

test('recording: independent columns, close-in-place, zoom, collapse and teardown',options,async()=>withFixture(async page=>{
  await page.evaluate("window.add('terminal','terminal')");await wait(page);
  let b=await boxes(page);
  assert.equal(b.terminal.y,8,'no extra global header row');
  assert.equal(b.terminal.height,814,'the single card fills the available height');
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-dockkit-strip]')).display"),'none');
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-pane-popout]')!==null"),false);
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-ccd-pane-seam]')??document.body).pointerEvents"),'auto');
  await page.evaluate("window.add('diff','diff')");await wait(page);
  b=await boxes(page);assert.equal(b.terminal.x,b.diff.x);assert.equal(b.terminal.height,b.diff.height);
  await drag(page,'row:0:0',80);await wait(page);
  const draggedTwo=await boxes(page);assert.equal(Math.round(draggedTwo.terminal.height-b.terminal.height),80);
  await page.evaluate("window.add('browser','browser');window.add('terminal2','diff')");await wait(page);
  b=await boxes(page);
  assert.equal(b.terminal.x,b.diff.x);assert.equal(b.browser.x,b.terminal2.x);
  assert.ok(b.browser.x>b.terminal.x);assert.equal(b.browser.y,8);
  assert.ok(b.terminal.height>b.diff.height,'existing left row proportions survived opening right column');
  assert.equal(await page.evaluate("document.querySelectorAll('[data-ccd-pane-seam]').length"),3);
  const screenshot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/ccd-sidebar-four.png',Buffer.from(screenshot.data,'base64'));
  const hit=await page.evaluate(`(()=>{const n=document.querySelector('[data-ccd-pane-seam="row:1:0"]'),b=n.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===n})()`);
  assert.equal(hit,true,'seams receive real pointer hits through the host pointer-events:none panel');
  await drag(page,'row:0:0',55);await wait(page);
  let after=await boxes(page);assert.deepEqual(after.browser,b.browser);assert.deepEqual(after.terminal2,b.terminal2);
  const left=after.terminal;
  await drag(page,'row:1:0',70);await wait(page);after=await boxes(page);assert.deepEqual(after.terminal,left);
  const right=after.browser;
  await page.evaluate("window.closeTab('terminal')");await wait(page);after=await boxes(page);
  assert.equal(after.diff.height,814);assert.deepEqual(after.browser,right,'closing only grows same-column neighbour');
  await click(page,'[data-dockkit-content="browser"] [data-ccd-pane-zoom]');await wait(page);
  b=await boxes(page);assert.deepEqual(Object.keys(b),['browser']);assert.equal(b.browser.x,288);assert.equal(b.browser.width,904);assert.equal(b.browser.height,814);
  await page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))");await wait(page);
  assert.equal(Object.keys(await boxes(page)).length,3);
  await click(page,'[data-ccd-pane-more]');await wait(page);
  await page.evaluate("[...document.querySelectorAll('[data-ccd-pane-menu] button')].find(node=>node.textContent==='Hide sidebar').click()");await wait(page);
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-ccd-pane]')).display"),'none');
  await page.evaluate("document.querySelector('.panel').setAttribute('data-sidebar-right-open','')");await wait(page);
  await page.evaluate("window.release();window.filesRelease()");
  assert.equal(await page.evaluate("document.querySelectorAll('[data-ccd-pane],[data-ccd-pane-seam],[data-ccd-pane-controls]').length"),0);
  assert.deepEqual((await page.evaluate('window.calls.dock')).sort(),['float-browser','float-diff','float-terminal2']);
}));

test('file previews stay inside Files, tree collapse preserves preview, tabs can switch',options,async()=>withFixture(async page=>{
  await page.evaluate("window.add('files','files')");await wait(page);
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-ccd-files-landing]')).display"),'flex');
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-slot=\"sidebar.right.tab.files.actions\"]')).display"),'none','inline display:contents does not steal filter width');
  const parent=await page.evaluate("document.querySelector('[data-files-root]').parentElement.getAttribute('class')");
  await page.evaluate("window.add('readme','text','s1','dsh-resource://file/session/s1/repo/README.md')");await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-dockkit-surface]').getAttribute('data-ccd-panes')"),'1');
  assert.equal(await page.evaluate("document.querySelector('[data-files-root]').parentElement.getAttribute('class')"),parent,'the tree stays in the host body');
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-pane-preview]').getAttribute('data-dockkit-content')"),'readme');
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-ccd-files-landing]')).display"),'none');
  assert.equal(await page.evaluate("document.querySelector('[data-dockkit-float-title][data-ccd-files-tab]')!==null"),true,'floating Files receives the list mark');
  let b=await boxes(page);const preview=b.readme;
  const width=b.files.width;await drag(page,'files:tree',45);await wait(page);b=await boxes(page);
  assert.equal(Math.round(b.files.width-width),45);assert.deepEqual(b.readme,preview);
  const originalWidth=b.files.width;
  await click(page,'[data-ccd-pane-preview] [data-ccd-files-switch]');await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-files-root]').getAttribute('data-ccd-files-tree')"),'hidden');
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-files-body]')).display"),'none');
  assert.notEqual(await page.evaluate("getComputedStyle(document.querySelector('[data-ccd-pane-preview]')).display"),'none');
  await click(page,'[data-ccd-pane-preview] [data-ccd-files-switch]');await wait(page);assert.equal((await boxes(page)).files.width,originalWidth);
  await page.evaluate("window.add('app','text','s1','dsh-resource://file/session/s1/repo/app.ts')");await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-dockkit-content=readme]').hasAttribute('data-ccd-pane-inactive')"),true);
  await click(page,'[data-dockkit-content=app] [data-ccd-pane-more]');await wait(page);
  await page.evaluate("[...document.querySelectorAll('[data-ccd-pane-menu] button')].find(node=>node.textContent==='README.md').click()");await wait(page);
  assert.equal(await page.evaluate('window.focused'),'readme');assert.ok((await boxes(page)).readme);assert.equal((await boxes(page)).app,undefined);
  await page.evaluate("document.querySelector('[data-dockkit-content=readme]').removeAttribute('data-dockkit-float-active');document.querySelector('[data-dockkit-content=app]').setAttribute('data-dockkit-float-active','')");await wait(page);
  assert.ok((await boxes(page)).app,'host focus of an existing file switches the preview without new membership');
  const treeHit=await page.evaluate("(()=>{const n=document.querySelector('[data-files-entry] button'),b=n.getBoundingClientRect();return n.contains(document.elementFromPoint(b.x+60,b.y+b.height/2))})()");
  assert.equal(treeHit,true,'the tree remains above the preview cell stacking context');
  await page.evaluate("window.closeTab('readme');window.closeTab('app')");await wait(page);
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-ccd-files-landing]')).display"),'flex');
  await page.evaluate("window.closeTab('files')");await wait(page);
  assert.equal(await page.evaluate('window.calls.toggle'),1,'closing the last card collapses the right panel');
  assert.equal(await page.evaluate("document.querySelector('[data-dockkit-surface]').hasAttribute('data-ccd-panes')"),false);
}));

test('closing the Files card removes all previews and the tree, preserving other panes',options,async()=>withFixture(async page=>{
  await page.evaluate("window.add('terminal','terminal');window.add('files','files');window.add('readme','text','s1','dsh-resource://file/session/s1/repo/README.md');window.add('app','text','s1','dsh-resource://file/session/s1/repo/app.ts')");await wait(page);
  await click(page,'[data-ccd-pane-preview] [data-dockkit-float-close]');await wait(page);
  assert.deepEqual(await page.evaluate('window.tabs.map(tab=>tab.tabId)'),['terminal']);
  assert.deepEqual(Object.keys(await boxes(page)),['terminal']);
  assert.equal(await page.evaluate('window.calls.toggle'),0,'another pane keeps the panel open');
  await page.evaluate("window.add('files2','files')");await wait(page);
  await click(page,'[data-dockkit-content="files2"] [data-dockkit-float-close]');await wait(page);
  assert.deepEqual(await page.evaluate('window.tabs.map(tab=>tab.tabId)'),['terminal'],'a Files card without previews also closes');
}));

test('session switch and panel replacement keep independent proportions; dragging aborts safely',options,async()=>withFixture(async page=>{
  await page.evaluate("window.add('a','terminal');window.add('b','browser')");await wait(page);
  await drag(page,'row:0:0',105);await wait(page);const s1=await boxes(page);
  await page.evaluate(`document.querySelector('[data-sidebar-right-session=s1]').hidden=true;document.body.insertAdjacentHTML('beforeend',${JSON.stringify(fixture('s2'))});window.add('c','terminal','s2');window.add('d','browser','s2');`);await wait(page);
  let b=await boxes(page);assert.equal(b.c.height,b.d.height,'new session starts with its own ratios');
  await drag(page,'row:0:0',-60);await wait(page);
  await page.evaluate("document.querySelector('[data-sidebar-right-session=s2]').hidden=true;document.querySelector('[data-sidebar-right-session=s1]').hidden=false");await wait(page);
  b=await boxes(page);assert.deepEqual(b.a,s1.a);assert.deepEqual(b.b,s1.b);
  // A host replacement occurs on the panel's parent, outside the watched surface.
  await page.evaluate("const old=document.querySelector('[data-sidebar-right-session=s1] .panel');old.replaceWith(old.cloneNode(true))");await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-sidebar-right-session=s1] [data-ccd-pane-seam]')!==null"),true);
  assert.equal(await page.evaluate("document.querySelector('[data-sidebar-right-session=s1] [data-dockkit-float-grip]').querySelectorAll('[data-ccd-pane-caption]').length"),1,'panel replacement cannot duplicate captions');
  await drag(page,'row:0:0',20,{up:false});await wait(page);
  await page.evaluate("window.closeTab('b')");await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-pane-dragging]')"),null);
  await page.evaluate("window.dispatchEvent(new PointerEvent('pointermove',{pointerId:7,clientY:700}))");await wait(page);
  assert.deepEqual(Object.keys(await boxes(page)),['a']);
  assert.equal((await boxes(page)).a.height,814);
}));

test('keyboard seams, pointer identity, window blur, and width changes remain usable',options,async()=>withFixture(async page=>{
  await page.evaluate("window.add('a','terminal');window.add('b','browser')");await wait(page);
  let before=await boxes(page);
  await page.evaluate("document.querySelector('[data-ccd-pane-seam]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}))");await wait(page);
  let after=await boxes(page);assert.equal(Math.round(after.a.height-before.a.height),24);
  before=after;
  await drag(page,'row:0:0',0,{up:false,pointer:7});
  await page.evaluate("window.dispatchEvent(new PointerEvent('pointermove',{pointerId:8,clientY:780}));window.dispatchEvent(new PointerEvent('pointerup',{pointerId:8}))");await wait(page);
  assert.deepEqual(await boxes(page),before);assert.equal(await page.evaluate("document.querySelector('[data-ccd-pane-dragging]')!==null"),true);
  await page.evaluate("window.dispatchEvent(new Event('blur'))");await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-pane-dragging]')"),null);
  await page.evaluate("document.querySelector('.panel').style.width='450px'");await wait(page);
  after=await boxes(page);assert.equal(after.a.width,434);assert.equal(after.a.height,before.a.height);
  await page.evaluate("document.querySelector('[data-ccd-pane-seam]').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true,cancelable:true}))");await wait(page);
  assert.ok((await boxes(page)).a.height>=96-0.01,'keyboard resizing respects minimum body space');
}));

test('a conversation file link opens Files once and joins its preview',options,async()=>withFixture(async page=>{
  await page.evaluate("window.add('doc','text','s1','dsh-resource://file/session/s1/repo/README.md')");await wait(page);
  assert.deepEqual(await page.evaluate('window.calls.open'),['files']);
  assert.equal(await page.evaluate("document.querySelector('[data-dockkit-surface]').getAttribute('data-ccd-panes')"),'1');
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-pane-preview]').getAttribute('data-dockkit-content')"),'doc');
  const shot=await page.send('Page.captureScreenshot',{format:'png'});
  await writeFile('/tmp/ccd-sidebar-files-preview.png',Buffer.from(shot.data,'base64'));
}));


test('reference chrome preserves button order and native browser navigation; unavailable actions retain their icons',options,async()=>withFixture(async page=>{
  await page.evaluate("window.add('t','terminal');window.add('f','files');window.add('w','browser')");await wait(page);
  const readOrder=kind=>page.evaluate(`[...document.querySelector('[data-ccd-pane-kind="${kind}"] [data-ccd-pane-controls]').children].map(node=>[...node.attributes].find(a=>a.name.startsWith('data-ccd-'))?.name)`);
  assert.deepEqual(await readOrder('terminal'),['data-ccd-pane-more','data-ccd-pane-zoom']);
  assert.deepEqual(await readOrder('files'),['data-ccd-pane-search','data-ccd-pane-more','data-ccd-pane-zoom']);
  assert.deepEqual(await readOrder('browser'),['data-ccd-browser-back','data-ccd-browser-forward','data-ccd-browser-pick','data-ccd-browser-reload','data-ccd-pane-more','data-ccd-pane-zoom']);
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-ccd-pane-zoom]')).borderTopWidth"),'0px');
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-ccd-pane-zoom] svg')).width"),'16px');
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-ccd-browser-toolbar]')).display"),'flex','address form is visible in the header');
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-browser-wait]').textContent"),'Awaiting server…');
  await page.evaluate("const original=document.querySelector('[data-ccd-browser-toolbar]>button');original.disabled=false;original.onclick=()=>window.backSeen=true");await wait(page);
  await click(page,'[data-ccd-browser-back]');assert.equal(await page.evaluate('window.backSeen'),true);
  await click(page,'[data-ccd-browser-address]');await wait(page);
  assert.equal(await page.evaluate("document.activeElement===document.querySelector('[data-ccd-browser-toolbar] input')"),true);
  await page.evaluate("document.querySelector('[data-dockkit-content=t] [data-dockkit-tab-title]').textContent='renamed'");await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-dockkit-content=t] [data-ccd-pane-caption]').textContent"),'Terminal renamed','native rename is reflected by the reference caption');
  await click(page,'[data-dockkit-content=w] [data-ccd-browser-pick]');await wait(page);
  assert.match(await page.evaluate("document.querySelector('[data-ccd-pane-menu]').textContent"),/页面元素/);
  await page.evaluate("document.querySelector('[data-ccd-pane-menu]').hidePopover()");
  // Same geometry in dark mode and no invisible seams swallowing body input.
  await page.evaluate("document.body.dataset.dsDarkTheme=''");await wait(page);
  const screenshot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/ccd-sidebar-chrome-dark.png',Buffer.from(screenshot.data,'base64'));
}));


test('plain titles, Files header tree switch, full conversation expansion and terminal tabs',options,async()=>withFixture(async page=>{
  await page.evaluate("window.add('t','terminal');window.add('f','files');window.add('w','browser')");await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-pane-caption]').closest('[data-dockkit-float-title]')"),null);
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-dockkit-float-title]')).display"),'none');
  assert.equal(await page.evaluate("document.querySelector('[data-dockkit-content=t] [data-ccd-pane-caption]').querySelector('[role=tab]')"),null,'one terminal has plain text');
  await page.evaluate("document.querySelector('[data-dockkit-content=t] [data-dockkit-float-title]').ondblclick=()=>window.renameSeen=true;document.querySelector('[data-dockkit-content=t] [data-ccd-pane-caption]>span').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  assert.equal(await page.evaluate('window.renameSeen??false'),false);
  await click(page,'[data-dockkit-content=f] [data-ccd-files-switch]');await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-files-root]').getAttribute('data-ccd-files-tree')"),'hidden');
  assert.equal(await page.evaluate("document.querySelector('[data-dockkit-content=f] [data-ccd-files-switch]').getAttribute('aria-expanded')"),'false');
  await click(page,'[data-dockkit-content=f] [data-ccd-files-switch]');await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-files-root]').hasAttribute('data-ccd-files-tree')"),false);
  await page.evaluate("document.querySelectorAll('[data-dockkit-float-grip]').forEach(node=>node.addEventListener('pointerdown',()=>window.headerDrags=(window.headerDrags??0)+1));document.querySelector('[data-ccd-terminal-add]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0}));document.querySelector('[data-dockkit-content=f] [data-ccd-files-switch]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0}));document.querySelector('[data-dockkit-content=t] [data-ccd-pane-caption]>span').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0}))");
  assert.equal(await page.evaluate('window.headerDrags??0'),0,'real pointer presses cannot initiate host float dragging');
  const initial=await boxes(page);
  for (const id of ['f','t','w']) {
    await click(page,'[data-dockkit-content='+id+'] [data-ccd-pane-zoom]');await wait(page);
    const b=await boxes(page);assert.deepEqual(Object.keys(b),[id]);assert.deepEqual(b[id],{x:288,y:8,width:904,height:814});
    await click(page,'[data-dockkit-content='+id+'] [data-ccd-pane-zoom]');await wait(page);
    assert.deepEqual(await boxes(page),initial,'restore keeps all split ratios');
  }
  await page.evaluate("document.documentElement.setAttribute('data-windows-titlebar','');document.documentElement.style.setProperty('--dsh-windows-titlebar-height','40px')");
  await click(page,'[data-dockkit-content=t] [data-ccd-pane-zoom]');await wait(page);
  assert.deepEqual((await boxes(page)).t,{x:288,y:48,width:904,height:774},'Windows expansion leaves the native caption visible');
  await click(page,'[data-dockkit-content=t] [data-ccd-pane-zoom]');await wait(page);
  await page.evaluate("document.documentElement.removeAttribute('data-windows-titlebar')");
  await click(page,'[data-dockkit-content=t] [data-ccd-pane-zoom]');await wait(page);
  await click(page,'[data-dockkit-content=t] [data-ccd-terminal-add]');await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-dockkit-surface]').getAttribute('data-ccd-panes')"),'3','a new terminal is a tab rather than another card');
  assert.deepEqual(Object.keys(await boxes(page)),['auto-terminal-1'],'adding a tab retains expanded state');
  assert.equal(await page.evaluate("document.querySelector('[data-dockkit-content=auto-terminal-1] [role=tablist]').querySelectorAll('[role=tab]').length"),2);
  await click(page,'[data-dockkit-content=auto-terminal-1] [role=tab]');await wait(page);
  assert.deepEqual(Object.keys(await boxes(page)),['t']);
  await page.evaluate("document.querySelector('[data-dockkit-content=t] [role=tab]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}))");await wait(page);
  assert.deepEqual(Object.keys(await boxes(page)),['auto-terminal-1']);
  await click(page,'[data-dockkit-content=auto-terminal-1] [data-ccd-terminal-add]');await wait(page);
  const active=await boxes(page);assert.deepEqual(Object.keys(active),['auto-terminal-2']);
  const shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/ccd-sidebar-terminal-tabs.png',Buffer.from(shot.data,'base64'));
  assert.equal(await page.evaluate("document.querySelector('[data-dockkit-content=auto-terminal-2] [role=tablist]').querySelectorAll('[role=tab]').length"),3);
  await page.evaluate("[...document.querySelectorAll('[data-dockkit-content=auto-terminal-2] [data-ccd-terminal-close]')].at(-1).click()");await wait(page);
  assert.deepEqual(Object.keys(await boxes(page)),['auto-terminal-1']);
  await click(page,'[data-dockkit-content=auto-terminal-1] [data-dockkit-float-close]');await wait(page);
  assert.deepEqual((await page.evaluate('window.tabs')).map(tab=>tab.kind),['files','browser'],'card close closes all terminal tabs');
  assert.equal(await page.evaluate("document.querySelector('[data-sidebar-right-panel]').hasAttribute('data-ccd-pane-expanded')"),false);
}));


test('browser globe edits the address without a dropdown; capture delegates to the guest and stops after removal',options,async()=>withFixture(async page=>{
  await page.evaluate("window.add('browser','browser')");await wait(page);
  await click(page,'[data-ccd-pane-zoom]');await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-browser-wait]').getAttribute('data-ccd-browser-wait')"),'idle');
  assert.equal(await page.evaluate("getComputedStyle(document.querySelector('[data-ccd-browser-wait-mark]')).display"),'none','idle browser is the reference blank canvas');
  const field=await page.evaluate("(()=>{const button=document.querySelector('[data-ccd-browser-address]'),b=button.getBoundingClientRect(),icons=[...button.querySelectorAll('svg')].map(n=>n.getBoundingClientRect()),f=document.querySelector('[data-ccd-browser-toolbar]'),r=f.getBoundingClientRect(),s=document.querySelector('[data-ccd-browser-address-slot]').getBoundingClientRect();return {iconCenter:icons[0].left+icons[0].width/2,buttonCenter:b.left+b.width/2,iconY:icons[0].top+icons[0].height/2,buttonY:b.top+b.height/2,fieldY:r.top+r.height/2,left:r.left,buttonRight:b.right,width:r.width,slotWidth:s.width,parent:f.parentElement.className,popover:f.hasAttribute('popover')}})()");
  assert.equal(field.iconCenter,field.buttonCenter,'globe is centred in its button');
  assert.equal(field.iconY,field.buttonY);assert.equal(field.fieldY,field.buttonY);
  assert.equal(field.left,field.buttonRight+4);assert.equal(field.width,field.slotWidth);assert.ok(field.width>200);
  assert.equal(field.parent,'browserRoot','the controlled form retains its native React parent');assert.equal(field.popover,false);
  await page.evaluate("document.querySelector('[data-ccd-browser-toolbar]').onsubmit=event=>{event.preventDefault();window.submittedAddress=event.currentTarget.querySelector('input').value}");
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',x:field.left+80,y:field.fieldY,button:'left',clickCount:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:field.left+80,y:field.fieldY,button:'left',clickCount:1});
  assert.equal(await page.evaluate("document.activeElement===document.querySelector('[data-ccd-browser-toolbar] input')"),true,'the header field receives real pointer hits through the native scroll body');
  await page.send('Input.insertText',{text:'http://localhost:3000'});
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await wait(page);
  assert.equal(await page.evaluate('window.submittedAddress'),'http://localhost:3000','direct entry keeps native Enter submission');
  await click(page,'[data-ccd-browser-address]');await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-browser-menu]')"),null,'globe does not open a menu');
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-browser-address]').hasAttribute('aria-haspopup')"),false);
  assert.equal(await page.evaluate("document.querySelectorAll('[data-ccd-browser-address] svg').length"),1,'dropdown caret is removed');
  assert.equal(await page.evaluate("document.activeElement===document.querySelector('[data-ccd-browser-toolbar] input')"),true);
  await click(page,'[data-ccd-pane-more]');await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-browser-menu]').textContent"),'Save screenshot');
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-browser-save-screenshot]').disabled"),true);
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-browser-menu]').getBoundingClientRect().width"),130);
  const shot=await page.send('Page.captureScreenshot',{format:'png'});await writeFile('/tmp/ccd-browser-capture-menu.png',Buffer.from(shot.data,'base64'));
  await page.evaluate("document.querySelector('[data-ccd-browser-menu]').hidePopover()");await wait(page);
  await page.evaluate("document.querySelector('[data-ccd-browser-address]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");await wait(page);
  assert.equal(await page.evaluate("document.activeElement===document.querySelector('[data-ccd-browser-toolbar] input')"),true,'native address editing remains reachable');
  await page.evaluate("window.captureCount=0;window.downloads=[];const view=document.createElement('webview');view.getURL=()=> 'http://localhost:3000';view.isLoading=()=>false;view.capturePage=()=>{window.captureCount++;return new Promise(resolve=>window.finishCapture=()=>resolve({isEmpty:()=>false,toDataURL:()=> 'data:image/png;base64,iVBORw0KGgo='}))};document.querySelector('[aria-busy]').append(view);document.addEventListener('click',event=>{const a=event.target.closest('a[download]');if(a){event.preventDefault();window.downloads.push({name:a.download,url:a.href})}})");await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-browser-wait]')"),null);
  await click(page,'[data-ccd-pane-more]');await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-browser-save-screenshot]').disabled"),false);
  await click(page,'[data-ccd-browser-save-screenshot]');await wait(page);
  await click(page,'[data-ccd-pane-more]');await wait(page);
  assert.equal(await page.evaluate("document.querySelector('[data-ccd-browser-save-screenshot]').disabled"),true,'pending capture cannot run twice');
  await page.evaluate('window.finishCapture()');await wait(page);
  assert.equal(await page.evaluate('window.captureCount'),1);
  assert.deepEqual(await page.evaluate('window.downloads'),[{name:'browser-screenshot.png',url:'data:image/png;base64,iVBORw0KGgo='}]);
  await page.evaluate("document.querySelector('[data-ccd-browser-menu]').hidePopover()");
  await click(page,'[data-ccd-pane-more]');await wait(page);
  await click(page,'[data-ccd-browser-save-screenshot]');await wait(page);
  await page.evaluate("window.closeTab('browser');window.finishCapture()");await wait(page);
  assert.equal(await page.evaluate('window.downloads.length'),1,'closing the browser while capture is pending cannot download stale content');
}));
