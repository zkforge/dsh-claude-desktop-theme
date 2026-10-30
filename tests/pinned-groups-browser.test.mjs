import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, MACOS_BUILD, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Browser coverage follows the other sidebar tests. */ }

test('pointer pinning matches pickup slots, section frame, unpin pill and confirmed landing', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, contents: `
      import {mountStatusGroups} from './src/client/compat/status-groups.ts';
      const listeners=new Set();
      const store=value=>({getSnapshot:()=>value,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}});
      const workspace={pinnedSessionIds:['b','a']};
      const statuses=new Map([['a',{running:true}],['b',{}],['c',{}]]);
      const ctx={sessions:{list:store({byId:{
        a:{id:'a',displayTitle:'输入框居中对齐问题',running:true},b:{id:'b',displayTitle:'圆形按钮收起状态显示问题'},c:{id:'c',displayTitle:'Thinking 与工具调用同行滚动'},
        child:{id:'child',origin:'subagent',parentId:'a',displayTitle:'检查布局',running:true}
      }})},workspaces:{list:store(workspace)},uiSession:{sessionStatus:store(statuses)},uiWorkspace:{
        openSession:id=>window.opens.push(id),
        pinSession:async id=>{window.calls.push(['pin',id]);if(window.hold)await new Promise(resolve=>window.resolveHost=resolve);if(window.fail)throw Error('Host refused');window.pins([id,...workspace.pinnedSessionIds.filter(x=>x!==id)]);},
        unpinSession:async id=>{window.calls.push(['unpin',id]);window.pins(workspace.pinnedSessionIds.filter(x=>x!==id));}
      }};
      window.pins=ids=>{workspace.pinnedSessionIds=ids;for(const row of document.querySelectorAll('[data-row-key]')){const badge=row.querySelector('[data-fixture-pin]');if(badge)badge.hidden=!ids.includes(row.dataset.rowKey.slice(8));}listeners.forEach(fn=>fn());};
      window.setStatus=(id,value)=>{statuses.set(id,value);listeners.forEach(fn=>fn());};
      window.calls=[];window.errors=[];window.opens=[];window.native=[];
      window.mount=()=>window.release=mountStatusGroups(document,ctx,error=>window.errors.push(String(error)));
      window.row=id=>document.querySelector('[data-row-key="session:'+id+'"]');
      window.heading=group=>document.querySelector('[data-ccd-status-owned="'+group+'"]');
      window.listenerCount=()=>listeners.size;
    ` }, bundle: true, write: false, format: 'iife',
  });
  const css = (await Promise.all(['src/client/theme/tokens.css','src/client/features/sidebar/sidebar.css']
    .map(path => readFile(join(root,path),'utf8')))).join('\n');
  const font = (await readFile(join(root,'assets/fonts/Geist-Variable.ttf'))).toString('base64');
  const nativeCss = `@font-face{font-family:Geist;src:url(data:font/ttf;base64,${font});font-weight:100 900}
    html[data-dsh-ccd-style=true]{--ccd-font-ui:Geist,"PingFang SC",sans-serif}
    body{margin:0;background:var(--ccd-sidebar);font-family:var(--ccd-font-ui);color:var(--ccd-text)}
    ._7514NG_flatList{width:250px;padding:10px;box-sizing:border-box}
    .jJkEga_sessionRow{display:flex;align-items:center;gap:6px;min-height:28px;font-size:13px;border-radius:6px}
    .jJkEga_title{flex:1}.jJkEga_rowActions button{border:0;background:transparent;color:inherit}
    .jJkEga_sessionRow:hover{background:var(--ccd-hover)}
    .jJkEga_slot{display:inline-flex;width:16px;flex:none}`;
  const fixture = `<main data-slot="root"><div class="_6Qf49G_frame"><div class="_7514NG_flatList">${[
    ['a','输入框居中对齐问题'],['b','圆形按钮收起状态显示问题'],['c','Thinking 与工具调用同行滚动']
  ].map(([id,title])=>`<div class="wrapper"><div class="jJkEga_sessionRow" role="treeitem" draggable="true" data-row-key="session:${id}" tabindex="-1"><span class="jJkEga_slot">◇</span><span class="jJkEga_title">${title}</span><span data-fixture-pin class="jJkEga_pinIndicator" role="img" aria-label="已置顶" ${id==='c'?'hidden':''}>⌖</span><span class="jJkEga_rowActions"><button aria-label="更多">⋯</button></span></div></div>`).join('')}
    <div data-row-key="session:blank" data-ccd-blank-session>新会话</div></div><div id="outside">外部区域</div></div></main>`;
  for (const host of [MACOS_BUILD, WINDOWS_BUILD]) {
    const profile = await mkdtemp(join(tmpdir(),'ccd-pins-test-'));
    try {
      await withPage({url:'about:blank',width:1392,height:932,scale:2,profile},async page=>{
        await page.evaluate(`document.documentElement.lang='zh-CN';document.documentElement.dataset.platform=${JSON.stringify(host===MACOS_BUILD?'darwin':'win32')};document.documentElement.dataset.dshCcdStyle='true';document.body.innerHTML=${JSON.stringify(aliasHostClasses(fixture,host))};const style=document.createElement('style');style.textContent=${JSON.stringify(aliasHostClasses(nativeCss+css,host))};document.head.append(style);`);
        await page.evaluate(bundle.outputFiles[0].text);
        await page.evaluate(`window.originalRows=[...document.querySelectorAll('[data-row-key]')];for(const row of window.originalRows)for(const type of ['dragstart','dragover','drop'])row.addEventListener(type,()=>window.native.push(type));window.mount()`);
        const settle=()=>page.evaluate('new Promise(resolve=>setTimeout(resolve,30))');
        const point=expression=>page.evaluate(`(()=>{document.getAnimations().forEach(a=>a.finish());const el=(${expression}),r=el.getBoundingClientRect();return{x:r.x+Math.min(60,r.width/2),y:r.y+r.height*(el.classList.contains('ccd-status-heading')?.85:.5)}})()`);
        let pointer={x:0,y:0};
        const move=async location=>{pointer=location;await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...pointer,buttons:1});await settle();};
        const start=async id=>{
          pointer=await point(`window.row('${id}')`);
          await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...pointer});
          await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...pointer,button:'left',clickCount:1});
          await move({x:pointer.x+6,y:pointer.y+3});
        };
        const hover=async expression=>move(await point(expression));
        const release=async()=>{await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...pointer,button:'left',clickCount:1});await settle();};
        const cancel=async()=>{
          await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
          await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
          await release();
        };
        await settle();
        assert.deepEqual(await page.evaluate(`['a','b','c'].map(id=>window.row(id).dataset.ccdStatusGroup)`),['pinned','pinned','ended']);
        assert(await page.evaluate(`+window.row('b').dataset.ccdStatusOrder<+window.row('a').dataset.ccdStatusOrder`),'global pin order wins over native order');
        assert.equal(await page.evaluate(`window.row('blank').hasAttribute('data-ccd-status-order')`),false);
        assert.equal(await page.evaluate(`getComputedStyle(window.row('a').querySelector('[data-fixture-pin]')).display`),'none','the Pinned section replaces the persistent native pin badge');
        assert.equal(await page.evaluate(`document.querySelector('[data-ccd-status-owned="children:a"]').textContent`),'检查布局');
        await page.evaluate(`window.setStatus('b',{pendingInteraction:{kind:'approval'}})`);await settle();
        assert.equal(await page.evaluate(`window.row('b').dataset.ccdStatusGroup`),'pinned');
        // Source space is retained while the custom overlay follows the cursor.
        const height=await page.evaluate(`window.row('a').getBoundingClientRect().height`);
        await start('a');
        assert.equal(await page.evaluate(`getComputedStyle(window.row('a')).visibility`),'hidden');
        assert(Math.abs(await page.evaluate(`window.row('a').getBoundingClientRect().height`)-height)<.01);
        assert.equal(await page.evaluate(`document.querySelector('.ccd-pin-floating').dataset.action`),'move');
        await hover(`window.row('c')`);
        assert.equal(await page.evaluate(`document.querySelector('.ccd-pin-floating').dataset.action`),'unpin');
        assert.equal(await page.evaluate(`document.querySelector('[data-ccd-pin-warning]').textContent`),'松开以取消置顶');
        assert.equal(await page.evaluate(`document.querySelector('.ccd-pin-target-frame').hidden`),true,'unpin feedback follows the pointer instead of highlighting Idle');
        await hover(`window.heading('pinned')`);
        assert.equal(await page.evaluate(`document.querySelector('.ccd-pin-floating').dataset.action`),'move','returning to the source restores the white title card');
        await hover(`window.row('c')`);await release();
        assert.equal(await page.evaluate(`window.row('a').dataset.ccdStatusGroup`),'working');
        assert.deepEqual(await page.evaluate('window.calls'),[['unpin','a']]);
        assert.equal(await page.evaluate(`window.row('a').getAnimations().length`),0,'unpin lands directly while the empty section closes');
        // A folded destination receives a whole-section frame, including its pin hint.
        await page.evaluate(`window.heading('pinned').click()`);await settle();
        await start('c');await hover(`window.heading('pinned')`);
        assert.equal(await page.evaluate(`document.querySelector('[data-ccd-status-owned="pin-hint"] span').textContent`),'松开');
        assert.notEqual(await page.evaluate(`getComputedStyle(document.querySelector('.ccd-pin-hint svg')).display`),'none','the drop hint keeps its outline pin');
        assert(await page.evaluate(`(()=>{const f=document.querySelector('.ccd-pin-target-frame').getBoundingClientRect(),h=window.heading('pinned').getBoundingClientRect(),hint=document.querySelector('.ccd-pin-hint').getBoundingClientRect();return f.top<=h.top&&f.bottom>=hint.bottom&&f.height>h.height})()`));
        await page.evaluate('window.hold=true');await release();
        assert.equal(await page.evaluate(`getComputedStyle(window.row('c')).visibility`),'hidden','no flash back to the source while Host confirmation is pending');
        assert.equal(await page.evaluate(`document.querySelector('.ccd-pin-floating').hidden`),true,'the floating preview disappears on release');
        await page.evaluate('window.hold=false;window.resolveHost()');await settle();
        assert.equal(await page.evaluate(`window.row('c').dataset.ccdStatusGroup`),'pinned');
        assert.equal(await page.evaluate(`window.row('c').getAnimations().length`),0,'the dropped row never flies across the list a second time');
        await page.evaluate(`window.heading('pinned').click();window.pins(['b']);window.clicks=[];for(const row of window.originalRows)row.addEventListener('click',()=>window.clicks.push(row.dataset.rowKey))`);await settle();
        await start('c');await hover(`window.heading('pinned')`);await cancel();
        assert.equal(await page.evaluate('window.calls.length'),2);
        assert.deepEqual(await page.evaluate('window.clicks'),[],'a canceled drag cannot open the Session');
        await start('c');await move({x:400,y:500});await release();
        assert.equal(await page.evaluate('window.calls.length'),2,'outside release cancels');
        assert.equal(await page.evaluate(`document.querySelectorAll('.ccd-pin-floating,.ccd-pin-target-frame,[data-ccd-pin-dragging]').length`),0);
        // Rejections restore the original slot and expose accessible feedback.
        await page.evaluate('window.fail=true');await start('c');await hover(`window.heading('pinned')`);await release();
        assert.equal(await page.evaluate(`window.row('c').dataset.ccdStatusGroup`),'ended');
        assert.equal(await page.evaluate(`getComputedStyle(window.row('c')).visibility`),'visible');
        assert.match(await page.evaluate(`document.querySelector('[role=alert]').textContent`),/失败/);
        await page.evaluate('window.fail=false');await start('c');await hover(`window.heading('pinned')`);await release();
        assert.equal(await page.evaluate(`document.querySelector('[role=alert]')`),null);
        assert.deepEqual(await page.evaluate('window.native'),[],'HTML DnD and React account reordering never start');
        await page.evaluate(`window.pins([])`);await settle();
        assert.equal(await page.evaluate(`window.heading('pinned').hidden`),true,'an empty section does not permanently occupy space');
        await start('c');
        assert.equal(await page.evaluate(`window.heading('pinned').hidden`),false,'pickup reveals the empty destination');
        assert.equal(await page.evaluate(`document.querySelector('.ccd-pin-hint span').textContent`),'拖放到此处');
        await cancel();
        assert.equal(await page.evaluate(`window.heading('pinned').hidden`),true);
        await page.evaluate(`window.pins(['a','b','c'])`);await settle();
        assert.equal(await page.evaluate(`window.heading('ended').hidden`),false,'all-pinned lists retain an unpin destination');
        await page.evaluate(`window.pins(['a']);window.release();window.mount()`);await settle();
        assert.equal(await page.evaluate(`window.row('a').dataset.ccdStatusGroup`),'pinned','remounts use the same Host pin set');
        // Capture the actual pickup, whole-group target and red-pill states in both themes.
        if(host===MACOS_BUILD){
          await mkdir(join(root,'artifacts'),{recursive:true});
          for(const theme of ['light','dark']){
            await page.evaluate(`document.body.toggleAttribute('data-ds-dark-theme',${theme==='dark'});document.getElementById('outside').hidden=true;window.row('blank').hidden=true;window.pins([]);window.setStatus('a',{running:false});window.setStatus('b',{});window.setStatus('child',{running:false});document.fonts.ready`);await settle();
            const shot=async phase=>{
              const image=await page.send('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:250,height:270,scale:1}});
              await writeFile(join(root,`artifacts/pinned-${phase}-${theme}.png`),Buffer.from(image.data,'base64'));
            };
            await start('c');await shot('pickup');await hover(`window.heading('pinned')`);await shot('target');await release();await shot('group');
            await start('c');await hover(`window.row('b')`);await shot('unpin');await release();
            if(theme==='light' && process.env.CCD_PIN_RECORD){
              const frames=[];
              page.events.set('Page.screencastFrame',[frame=>{frames.push(frame);void page.send('Page.screencastFrameAck',{sessionId:frame.sessionId});}]);
              await page.send('Page.startScreencast',{format:'jpeg',quality:90,maxWidth:1392,maxHeight:932,everyNthFrame:1});
              const pause=()=>new Promise(resolve=>setTimeout(resolve,300));
              const travel=async expression=>{
                const from={...pointer},to=await point(expression);
                for(let step=1;step<=16;step++)await move({x:from.x+(to.x-from.x)*step/16,y:from.y+(to.y-from.y)*step/16});
              };
              await pause();await start('c');await pause();await travel(`window.heading('pinned')`);await pause();await release();await pause();
              await start('c');await pause();await travel(`window.row('b')`);await pause();await release();await pause();
              await page.send('Page.stopScreencast');page.events.delete('Page.screencastFrame');
              const output=join(root,'artifacts/pinned-motion');await mkdir(output,{recursive:true});
              const lines=['ffconcat version 1.0'];
              for(let i=0;i<frames.length;i++){
                const name=`frame-${String(i).padStart(4,'0')}.jpg`;
                await writeFile(join(output,name),Buffer.from(frames[i].data,'base64'));
                lines.push(`file '${name}'`);
                lines.push(`duration ${Math.max(.02,(frames[i+1]?.metadata.timestamp??frames[i].metadata.timestamp+.3)-frames[i].metadata.timestamp)}`);
              }
              lines.push(`file 'frame-${String(frames.length-1).padStart(4,'0')}.jpg'`);
              await writeFile(join(output,'frames.ffconcat'),lines.join('\n'));
            }
          }
        }
        await start('c');await page.evaluate('window.release()');await release();
        assert.equal(await page.evaluate('window.listenerCount()'),0);
        assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-status-owned],[data-ccd-status-order],[data-ccd-status-wrapper],.ccd-pin-floating,.ccd-pin-target-frame,[data-ccd-pin-gesture],[data-ccd-pin-dragging]').length`),0);
        assert(await page.evaluate(`window.originalRows.every(row=>row.isConnected&&row.getAttribute('tabindex')===(row.dataset.rowKey==='session:blank'?null:'-1'))`));
        assert.deepEqual(await page.evaluate('window.errors'),['Error: Host refused']);
      });
    }finally{await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
  }
});
