import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {build} from 'esbuild';
import {findChrome,withPage} from '../scripts/lib/headless-chrome.mjs';
let chrome;try{chrome=findChrome()}catch{/* Requires Chrome. */}
const options={skip:chrome?false:'Chrome unavailable',timeout:60000};
const pause=page=>page.evaluate('new Promise(resolve=>setTimeout(resolve,80))');
const native=(await Promise.all(['layout','sidebar','plugin-manager','market','schedule','account','primitives'].map(name=>readFile(`tests/fixtures/rc22/${name}.css`,'utf8')))).join('\n');
const css=(await Promise.all(['src/client/theme/tokens.css','src/client/theme/base.css','src/client/theme/menus.css','src/client/theme/management.css','src/client/theme/plugins.css','src/client/theme/schedule.css','src/client/features/sidebar/account-menu.css','src/client/features/sidebar/sidebar.css'].map(path=>readFile(path,'utf8')))).join('\n');
const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
import {mountPluginPage} from './src/client/compat/plugin-page.ts';
import {mountSchedulePage} from './src/client/compat/schedule-page.ts';
import {mountAccountMore} from './src/client/compat/account-more.ts';
import {resolveConfig} from './src/shared/config.ts';
import {resolveThemeTokens} from './src/client/theme/tokens.ts';
import {createDomPort} from './src/client/compat/dom.ts';
import {attach} from './tests/fixtures/rc22/header-scroll.mjs';
window.attachHeader=attach;
window.surfaceKeys=[];
window.applySurfaces=(sidebar,canvas,dark)=>{
 for(const key of window.surfaceKeys)document.body.style.removeProperty(key);
 const tokens=resolveThemeTokens(resolveConfig({appearance:{sidebar,canvas}}));
 window.surfaceKeys=Object.keys(tokens);
 for(const [key,modes]of Object.entries(tokens))document.body.style.setProperty(key,modes[dark?'dark':'light']);
 document.body.toggleAttribute('data-ds-dark-theme',dark);
};
window.style=css=>createDomPort(document).mountStyles(css);
window.mountPlugins=()=>{const bar=document.querySelector('[data-plugin-bar]');if(bar)window.stopHeader=attach(bar);window.stopPlugins=mountPluginPage(document,e=>window.errors.push(String(e)))};
window.mountSchedule=()=>window.stopSchedule=mountSchedulePage(document,e=>window.errors.push(String(e)));
window.mountMore=()=>window.stopMore=mountAccountMore(document.querySelector('[data-ccd-account-menu]'));
`},bundle:true,write:false,format:'iife'});
async function browser(callback){
 const profile=await mkdtemp(join(tmpdir(),'ccd-win-layout-'));
 try{await withPage({url:'about:blank',width:1392,height:932,profile},async page=>{
  await page.evaluate(`document.documentElement.dataset.platform='win32';document.documentElement.lang='zh-CN';document.documentElement.dataset.dshCcdStyle='true';window.errors=[];const native=document.createElement('style');native.textContent=${JSON.stringify(native)};document.head.append(native);const reset=document.createElement('style');reset.textContent='html,body{height:100%;margin:0;overflow:hidden}body{--dsw-alias-bg-base:#fff;--dsw-alias-label-primary:#111;--dsw-alias-label-secondary:#666;--dsw-alias-button-primary-fill:#44474b;--dsw-alias-label-primary-foreground:white;--dsw-radius-lg:16px;--dsw-radius-md:8px;font:14px/20px system-ui}button{font:inherit}';document.head.append(reset);${bundle.outputFiles[0].text};window.style(${JSON.stringify(css)});`);
  await callback(page);assert.deepEqual(await page.evaluate('window.errors'),[]);
 });}finally{await rm(profile,{recursive:true,force:true,maxRetries:6,retryDelay:150})}
}
const cards=(prefix,count=24)=>`<ul class="${prefix}_cards">${Array.from({length:count},(_,i)=>`<li class="${prefix}_card"><div class="${prefix}_cardHead"><span class="${prefix}_cardIcon">◇</span><div class="${prefix}_cardMain"><div class="${prefix}_titleRow"><button class="${prefix}_cardTitle ${prefix}_cardOpen">Demo ${i+1}</button></div><span class="${prefix}_cardDesc">Demo plugin description</span></div></div></li>`).join('')}</ul>`;
const marketCards=`<ul class="m2i3Fa_cards">${Array.from({length:24},(_,i)=>`<li class="m2i3Fa_card" data-market-entry="demo-${i}"><span class="m2i3Fa_icon" aria-hidden="true">◇</span><div class="m2i3Fa_main"><div class="m2i3Fa_titleRow"><button class="m2i3Fa_cardOpen">Demo market ${i+1}</button></div><span class="m2i3Fa_description">Demo market description</span><span class="m2i3Fa_meta">v1.0 · Demo</span></div><div class="m2i3Fa_cardEnd"><button aria-label="安装 Demo ${i+1}">安装</button></div></li>`).join('')}</ul>`;
const header=`<div class="V7pFBG_pageBar V7pFBG_pageBarWithTabs" data-plugin-bar><header class="V7pFBG_pageHead"><div class="V7pFBG_pageHeading"><h1 class="V7pFBG_pageTitle" data-plugin-header-part="title">插件</h1><div class="V7pFBG_pageIntro" data-plugin-header-part="intro"><span>安装、启用和配置插件</span><button aria-label="About">i</button></div></div><div class="V7pFBG_toolbar" data-plugin-toolbar data-plugin-header-part="toolbar"><span>1 个插件可更新</span><button>刷新</button><button class="V7pFBG_addButton">添加插件</button></div><div class="V7pFBG_pageTabs" data-plugin-header-part="tabs"><div class="V7pFBG_pageTabList" role="tablist"><button role="tab" id="demo-installed">我的</button><button role="tab" id="demo-discover">发现</button></div></div></header></div>`;
const shell=body=>`<div data-slot="root" style="height:100%"><div class="mP3x-q_frame" style="grid-template-columns:264px minmax(0,1fr) 0"><div class="mP3x-q_centerCol"><div class="mP3x-q_mainPanel" data-global-panel><div data-slot="main" style="display:contents">${body}</div></div></div></div></div>`;
async function wheelToEnd(page,selector,delta=850){
 const box=await page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:Math.min(r.bottom-40,880)}})()`);
 for(let i=0;i<8;i++){await page.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:box.x,y:box.y,deltaX:0,deltaY:delta});await pause(page)}
}

test('Windows rc22 plugin page scrolls by wheel through My, Discover and detail without header overlap',options,async()=>browser(async page=>{
 await page.evaluate(`document.body.innerHTML=${JSON.stringify(shell(`<section class="V7pFBG_page" data-plugin-panel><div class="V7pFBG_pageBody" data-plugin-body>${header}<div class="V7pFBG_installedPanel"><section class="V7pFBG_group" data-plugin-group="basic"><h3 class="V7pFBG_groupTitle">插件</h3>${cards('V7pFBG')}</section></div></div></section>`))};window.myMarkup=document.querySelector('[data-plugin-body]').innerHTML;window.mountPlugins();window.infoClicks=0;document.querySelector('[aria-label=About]').onclick=()=>window.infoClicks++`);await pause(page);
 const start=await page.evaluate(`(()=>{const body=document.querySelector('[data-plugin-body]'),first=document.querySelector('.V7pFBG_card'),title=document.querySelector('h1'),tabs=document.querySelector('[role=tablist]');return{client:body.clientHeight,scroll:body.scrollHeight,titleBottom:title.getBoundingClientRect().bottom,tabsBottom:tabs.getBoundingClientRect().bottom,firstTop:first.getBoundingClientRect().top,titleLeft:title.getBoundingClientRect().left,cardLeft:first.getBoundingClientRect().left,bodyLeft:body.getBoundingClientRect().left}})()`);
 console.log('plugin-start',JSON.stringify(start));
 assert.ok(start.client<=932,'the real scroll body must fit the constrained MainPanel');
 assert.ok(start.scroll>start.client,'the scroll body owns overflowing cards');
 assert.ok(Math.abs(start.titleLeft-start.cardLeft)<1,'title and cards share a left edge');
 assert.ok(start.firstTop>=start.titleBottom&&start.firstTop>=start.tabsBottom,'header must be above the first card');
 await mkdir('artifacts',{recursive:true});
 await writeFile('artifacts/windows-customize-top.png',Buffer.from((await page.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await wheelToEnd(page,'[data-plugin-body]');
 const end=await page.evaluate(`(()=>{const body=document.querySelector('[data-plugin-body]'),last=document.querySelector('.V7pFBG_card:last-child');return{top:body.scrollTop,lastBottom:last.getBoundingClientRect().bottom,bodyBottom:body.getBoundingClientRect().bottom,window:document.documentElement.scrollTop+document.body.scrollTop}})()`);
 console.log('plugin-end',JSON.stringify(end));assert.ok(end.top>0,'real mouseWheel must advance the host body');assert.ok(end.lastBottom<=end.bodyBottom,'wheel reaches last plugin');assert.equal(end.window,0);
 const compact=await page.evaluate(`(()=>{const bar=document.querySelector('[data-plugin-bar]'),button=bar.querySelector('.V7pFBG_addButton'),r=button.getBoundingClientRect();window.compactClicks=0;button.onclick=()=>window.compactClicks++;return{background:getComputedStyle(bar,'::before').backgroundColor,x:r.x+r.width/2,y:r.y+r.height/2,translate:button.style.translate,width:button.style.width}})()`);
 assert.equal(compact.background,'rgb(255, 255, 255)','native compact header remains opaque');
 await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:compact.x,y:compact.y});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:compact.x,y:compact.y});assert.equal(await page.evaluate('window.compactClicks'),1,'compact toolbar remains physically clickable');
 await writeFile('artifacts/windows-customize-bottom.png',Buffer.from((await page.send('Page.captureScreenshot',{format:'png'})).data,'base64'));
 // Host swaps content and retains pageBody as the scroll owner.
 await page.evaluate(`document.querySelector('[data-plugin-body]').scrollTop=0;document.querySelector('.V7pFBG_installedPanel').outerHTML='<div class="V7pFBG_tabPanel"><div class="m2i3Fa_section" data-plugin-tab="discover"><div class="m2i3Fa_toolbar"><button class="m2i3Fa_marketButton">Market</button><label class="m2i3Fa_search"><input type="search"></label></div>${marketCards}</div></div>';`);await pause(page);
 await wheelToEnd(page,'[data-plugin-body]');assert.ok(await page.evaluate(`document.querySelector('[data-plugin-body]').scrollTop`)>0,'Discover keeps wheel scrolling');
 await page.evaluate(`window.stopHeader();document.querySelector('[data-plugin-body]').innerHTML='<div class="V7pFBG_detail"><div class="V7pFBG_detailTop"><button class="V7pFBG_crumb">插件</button><div class="V7pFBG_detailHead"><span class="V7pFBG_cardIcon">◇</span></div></div><div class="V7pFBG_detailMain"><h1 class="V7pFBG_detailTitle">Demo details</h1></div>'+Array.from({length:80},(_,i)=>'<p>Demo detail '+i+'</p>').join('')+'</div>';document.querySelector('[data-plugin-body]').scrollTop=0;`);await pause(page);
 assert.ok(await page.evaluate(`document.querySelector('.V7pFBG_crumb').getBoundingClientRect().top`)>=47,'detail back row keeps its top inset');
 await wheelToEnd(page,'[data-plugin-body]');assert.ok(await page.evaluate(`document.querySelector('[data-plugin-body]').scrollTop`)>0,'detail keeps wheel scrolling');
 await page.evaluate(`document.querySelector('[data-plugin-panel]').innerHTML='<header class="V7pFBG_moreHead"><button class="V7pFBG_moreBack" aria-label="Back"><svg></svg></button><h1 class="V7pFBG_pageTitle">更多插件</h1></header><div class="V7pFBG_pageBody" data-plugin-body><div class="V7pFBG_installedPanel">${cards('V7pFBG')}</div></div>'`);await pause(page);
 assert.ok(await page.evaluate(`document.querySelector('.V7pFBG_moreBack').getBoundingClientRect().top`)>=47,'More back row keeps its top inset');
 await wheelToEnd(page,'[data-plugin-body]');assert.ok(await page.evaluate(`document.querySelector('[data-plugin-body]').scrollTop`)>0,'More owns its scrolling body');
 await page.evaluate(`document.querySelector('.V7pFBG_moreHead').remove()`);

 await page.evaluate(`document.querySelector('[data-plugin-body]').innerHTML=window.myMarkup;window.stopHeader=window.attachHeader(document.querySelector('[data-plugin-bar]'));`);await pause(page);
 await wheelToEnd(page,'[data-plugin-body]');
 await wheelToEnd(page,'[data-plugin-body]',-850);
 const returned=await page.evaluate(`(()=>{const title=document.querySelector('h1').getBoundingClientRect(),first=document.querySelector('.V7pFBG_card').getBoundingClientRect(),intro=document.querySelector('[data-plugin-header-part="intro"]');return{top:document.querySelector('[data-plugin-body]').scrollTop,titleBottom:title.bottom,firstTop:first.top,inert:intro.inert}})()`);
 assert.equal(returned.top,0);assert.equal(returned.inert,false,'native header resets Info interaction when scrolled back to top');assert.ok(returned.firstTop>=returned.titleBottom);
 const info=await page.evaluate(`(()=>{const r=document.querySelector('[aria-label=About]').getBoundingClientRect();window.returnInfo=0;document.querySelector('[aria-label=About]').onclick=()=>window.returnInfo++;return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...info});await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...info});assert.equal(await page.evaluate('window.returnInfo'),1,'Info remains physically clickable after native inline header state changes');
 await page.evaluate('window.stopHeader();window.stopPlugins()');assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-plugin-page],[data-ccd-plugin-part]').length`),0);
}));

test('Windows task creation split button shares fill and seam while its native menu stays compact',options,async()=>browser(async page=>{
 await page.evaluate(`document.body.innerHTML=${JSON.stringify(shell('<section class="olCj9W_page" data-testid="task-manager-page"><div class="olCj9W_listPane"><div class="olCj9W_pageScroll"><div class="olCj9W_pageContent"><div class="olCj9W_pageHeading"><h1>自动化任务</h1><div class="olCj9W_creationActions"><span class="olCj9W_createGroup" role="group"><button id="new" class="_button_1ulci_2 _sm_1ulci_28 _primary_1ulci_36 olCj9W_headerAction olCj9W_createPrimary">新建任务</button><span class="_root_1p5el_1"><button id="method" class="_button_1ulci_2 _sm_1ulci_28 _primary_1ulci_36 olCj9W_createMore" aria-haspopup="menu">⌄</button></span></span></div></div><div><div role="group"><button>Active</button><button>Paused</button><button>Ended</button><button>All</button></div></div><div class="olCj9W_searchTools"><div class="olCj9W_searchField"><input></div></div><div class="olCj9W_list"></div></div></div></div></section>'))};window.mountSchedule();window.creation=[];document.querySelector('#new').onclick=()=>window.creation.push('chat');document.querySelector('#method').onclick=()=>{const menu=document.createElement('div');menu.className='_list_1p5el_7 _portal_1p5el_46 olCj9W_createMenu';menu.setAttribute('role','menu');menu.setAttribute('data-menu-material','translucent');menu.innerHTML='<div class="_viewport_1p5el_19"><button role="menuitem" class="_item_1p5el_105"><span class="_itemLabel_1p5el_208">在会话中创建</span></button><button role="menuitem" class="_item_1p5el_105"><span class="_itemLabel_1p5el_208">手动创建</span></button></div>';document.body.append(menu);menu.querySelectorAll('button').forEach((button,index)=>button.onclick=()=>window.creation.push(index?'manual':'chat'))};`);await pause(page);
 const split=await page.evaluate(`(()=>{const a=document.querySelector('#new'),b=document.querySelector('#method'),s=getComputedStyle(a),t=getComputedStyle(b);return{left:s.backgroundColor,right:t.backgroundColor,inner:s.borderTopRightRadius,outer:t.borderTopRightRadius,leftHeight:a.getBoundingClientRect().height,rightHeight:b.getBoundingClientRect().height}})()`);console.log('split',JSON.stringify(split));
 assert.equal(split.left,split.right,'both halves use the same primary fill');assert.equal(split.inner,'0px');assert.equal(split.leftHeight,split.rightHeight);
 await page.evaluate(`document.querySelector('#method').click()`);assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[role=menuitem]')).fontSize`),'13px');assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[role=menuitem]')).minHeight`),'30px');
 await page.evaluate(`document.querySelectorAll('[role=menuitem]')[1].click();document.querySelector('#new').click()`);assert.deepEqual(await page.evaluate('window.creation'),['manual','chat']);await page.evaluate('window.stopSchedule()');
}));

test('account More displays one replacement glyph and restores the native contact icon on release',options,async()=>browser(async page=>{
 await page.evaluate(`document.body.innerHTML='<div data-ccd-account-menu data-menu-material role="menu"><button role="menuitem"><span class="_itemLabel_1p5el_208">设置</span></button><button role="menuitem" id="contact" class="_item_1p5el_105"><span class="_itemIcon_1p5el_165" aria-hidden="true"><svg data-native-plane></svg></span><span class="_itemLabel_1p5el_208">联系我们</span></button><button role="menuitem">退出</button></div>';window.nativeContactIcon=document.querySelector('[data-native-plane]').parentElement;window.mountMore()`);await pause(page);
 const visible=await page.evaluate(`getComputedStyle(window.nativeContactIcon).display`);console.log('account-native-icon',visible);assert.equal(visible,'none','original plane must be hidden while the information glyph is drawn');
 await page.evaluate('window.stopMore()');assert.notEqual(await page.evaluate(`getComputedStyle(window.nativeContactIcon).display`),'none');assert.equal(await page.evaluate(`document.querySelector('[data-ccd-account-more]')`),null);
}));


test('native macOS and Windows sidebar paint follows resolved surfaces across light, dark, custom and drawer states',options,async()=>browser(async page=>{
 await page.evaluate(`document.body.innerHTML='<div data-slot="root" style="height:100%"><div class="mP3x-q_frame" style="grid-template-columns:264px minmax(0,1fr)"><aside class="mP3x-q_sidebarCol"><div class="wtg9ga_root"></div></aside><main class="mP3x-q_centerCol"></main></div></div>';document.documentElement.style.setProperty('--dsh-windows-titlebar-height','40px')`);
 for(const platform of ['darwin','win32'])for(const dark of [false,true])for(const custom of [false,true])for(const drawer of [false,true]){
  await page.evaluate(`document.documentElement.dataset.platform=${JSON.stringify(platform)};document.documentElement.toggleAttribute('data-windows-titlebar',${platform==='win32'});document.querySelector('.mP3x-q_frame').toggleAttribute('data-sidebar-drawer',${drawer});window.applySurfaces(${JSON.stringify(custom?'#ead1c2':'')},${JSON.stringify(custom?'#f3f0dd':'')},${dark})`);
  const paint=await page.evaluate(`(()=>{const frame=document.querySelector('.mP3x-q_frame'),column=document.querySelector('.mP3x-q_sidebarCol'),root=document.querySelector('.wtg9ga_root'),canvas=document.querySelector('.mP3x-q_centerCol');const resolve=token=>{const probe=document.createElement('span');probe.style.backgroundColor='var('+token+')';document.body.append(probe);const value=getComputedStyle(probe).backgroundColor;probe.remove();return value};return{expected:resolve('--ccd-sidebar'),canvasExpected:resolve('--ccd-canvas'),column:getComputedStyle(column).backgroundColor,image:getComputedStyle(column).backgroundImage,root:getComputedStyle(root).backgroundColor,frame:getComputedStyle(frame).backgroundColor,caption:getComputedStyle(frame,'::before').backgroundColor,canvas:getComputedStyle(canvas).backgroundColor}})()`);
  const mode=JSON.stringify({platform,dark,custom,drawer});
  console.log('sidebar-paint',mode,JSON.stringify(paint));
  assert.equal(paint.image,'none',mode+' sidebar stays flat');
  assert.equal(paint.column,paint.expected,mode+' column paints configured sidebar');
  assert.equal(paint.root,platform==='darwin'?'rgba(0, 0, 0, 0)':paint.expected,mode+' native sidebar root preserves the same surface');
  assert.equal(paint.frame,paint.expected,mode+' frame follows sidebar');
  if(platform==='win32')assert.equal(paint.caption,paint.expected,mode+' Windows caption follows sidebar');
  assert.equal(paint.canvas,paint.canvasExpected,mode+' canvas is independent');
 }
}));

test('plugin update actions retain readable primary, outline and ghost states without running updates',options,async()=>browser(async page=>{
 await page.evaluate(`document.body.innerHTML=${JSON.stringify(shell('<section class="V7pFBG_page" data-plugin-panel><div class="V7pFBG_pageBody" data-plugin-body><div class="V7pFBG_detail"><div class="V7pFBG_detailActions"><button id="primary-update" class="_button_1ulci_2 _sm_1ulci_28 _primary_1ulci_36">更新到 1.2</button><button id="outline-update" class="_button_1ulci_2 _sm_1ulci_28 _outline_1ulci_56">更新</button><button id="disabled-update" disabled class="_button_1ulci_2 _sm_1ulci_28 _primary_1ulci_36">更新中</button></div><span class="V7pFBG_versionAction"><button id="version-update" class="_button_1ulci_2 _sm_1ulci_28 _outline_1ulci_56">更新版本</button></span></div><div data-plugin-tab="discover" class="m2i3Fa_section"><div class="m2i3Fa_cardEnd"><button id="market-update" class="_button_1ulci_2 _sm_1ulci_28 _ghost_1ulci_46" aria-label="打开已安装 Demo">更新</button></div></div></div></section>'))};window.mountPlugins();window.updateCalls=0;document.querySelectorAll('button').forEach(button=>button.onclick=()=>window.updateCalls++)`);await pause(page);
 const results=[];
 for(const dark of [false,true]){
  await page.evaluate(`window.applySurfaces('','',${dark});document.body.style.setProperty('--dsw-alias-button-primary-fill',${JSON.stringify(dark?'#ddd':'#444')});document.body.style.setProperty('--dsw-alias-label-primary-foreground',${JSON.stringify(dark?'#111':'#fff')});document.body.style.setProperty('--dsw-alias-button-primary-hover',${JSON.stringify(dark?'#eee':'#555')});document.body.style.setProperty('--dsw-alias-label-primary',${JSON.stringify(dark?'#eee':'#111')})`);
  for(const id of ['primary-update','outline-update','version-update','market-update','disabled-update']){
   const box=await page.evaluate(`(()=>{const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   for(const state of ['hover','active']){
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...box});
    if(state==='active')await page.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...box});
    await page.evaluate('new Promise(resolve=>setTimeout(resolve,180))');
    results.push(await page.evaluate(`(()=>{const s=getComputedStyle(document.getElementById(${JSON.stringify(id)}));return{id:${JSON.stringify(id)},dark:${dark},state:${JSON.stringify(state)},background:s.backgroundColor,color:s.color,opacity:s.opacity}})()`));
    // Release outside the button: exercise :active, never invoke update.
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:900});
    if(state==='active')await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:10,y:900});
   }
  }
 }
 console.log('update-states',JSON.stringify(results));
 for(const row of results.filter(row=>row.id!=='disabled-update')){
  const rgb=value=>value.match(/[\d.]+/g).slice(0,3).map(Number);
  const luminance=value=>rgb(value).map(channel=>{const s=channel/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[.2126,.7152,.0722][index],0);
  const surface=row.background==='rgba(0, 0, 0, 0)'?(row.dark?'rgb(20, 20, 20)':'rgb(252, 252, 251)'):row.background;
  const a=luminance(surface),b=luminance(row.color);
  assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,JSON.stringify(row)+' text remains readable');
 }
 assert.equal(await page.evaluate('window.updateCalls'),0,'no update handler was invoked');
 assert.equal(results.find(row=>row.id==='disabled-update').opacity,'0.4','disabled keeps the native disabled state');
 await page.evaluate(`document.getElementById('primary-update').className='_button_1ulci_2 _outline_1ulci_56'`);await pause(page);
 assert.equal(await page.evaluate(`document.getElementById('primary-update').hasAttribute('data-ccd-plugin-action')`),false,'React variant changes remove the filled classification');
 await page.evaluate('window.stopPlugins()');
}));
