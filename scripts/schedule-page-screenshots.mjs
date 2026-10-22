#!/usr/bin/env node
/** Render the installed TaskManagerPage with an empty demo catalog, native CSS
 * and the real enhancement. No accounts or running-app state are accessed.
 * Usage: node scripts/schedule-page-screenshots.mjs [before|after]
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readAsar } from './lib/host-prefixes.mjs';
import { withPage } from './lib/headless-chrome.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, '.cache/schedule-page-screenshots');
await mkdir(work, { recursive: true });
const files = readAsar(process.env.DSH_ASAR ?? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar', p =>
  p.endsWith('/dsh-client-ui-schedule/lib/client.js') || /dsh-web-frontend\/dist\/assets\/.*\.css$/.test(p));
const host = [...files].find(([p]) => p.endsWith('/dsh-client-ui-schedule/lib/client.js'))?.[1].toString();
assert.ok(host, 'installed ui-schedule bundle required');
const component = host.slice(host.indexOf('function TaskManagerPage(props)'), host.indexOf('\n\t\t//#endregion', host.indexOf('function TaskManagerPage(props)')));
const mapping = host.match(/var TaskManagerPage_module_css_default = (\{[\s\S]*?\n\t\t\});/)?.[1];
const hostSheet = JSON.parse(host.match(/const css\$5 = ("(?:\\.|[^"\\])*");/)?.[1] ?? '""');
assert.ok(component && mapping && hostSheet, 'pinned TaskManagerPage source and styles required');
const primitiveSheet = [...files].filter(([p]) => p.endsWith('.css')).map(([,b]) => b.toString()).join('\n');
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import * as react from 'react';
    import * as react_jsx_runtime from 'react/jsx-runtime';
    import {createRoot} from 'react-dom/client';
    import {mountSchedulePage} from './src/client/compat/schedule-page.ts';
    const clsx=(...values)=>values.filter(Boolean).join(' ');
    const useRelativeClock=()=>Date.now();
    const useTaskDetail=()=>({id:'demo-detail',task:undefined,record:undefined,confirmId:null,setConfirmId:()=>{},setTab:()=>{}});
    const CatalogFeedback=()=>null;
    const translations={title:'自动化任务','new.action':'新建','empty.action':'新建自动化任务',
      'list.empty':'还没有自动化任务，在会话中创建的任务会显示在这里',
      'statusFilter.label':'筛选任务','statusFilter.all':'全部','status.active':'已开启','status.inactive':'已结束',
      'search.label':'搜索自动化任务','search.placeholder':'搜索自动化任务','list.label':'自动化任务'};
    const t=key=>translations[key]??key;
    const Icon=props=><svg width="24" height="24" viewBox="0 0 24 24" {...props}><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor"/></svg>;
    const _deepseek_ai_dsh_client_ui_primitives={
      Button:({children,icon,variant='ghost',size='md',className='',...props})=><button className={clsx('_button_1rv3m_2',size==='sm'?'_sm_1rv3m_28':'_md_1rv3m_23',variant==='primary'?'_primary_1rv3m_36':variant==='outline'?'_outline_1rv3m_54':'',className)} {...props}>{icon&&<span className="_icon_1rv3m_71">{icon}</span>}{children}</button>,
      Input:({icon,...props})=><label style={{display:'inline-flex',alignItems:'center',gap:6}}>{icon}<input style={{border:0,background:'transparent'}} {...props}/></label>,
      IconPlusOutlineRegular:()=> <svg width="13" height="13" viewBox="0 0 24 24"><path d="M12 3v18M3 12h18" stroke="currentColor"/></svg>,
      IconSearchOutlineRegular:Icon,IconClockOutlineRegular:Icon,IconCloseOutlineRegular:Icon,
    };
    const TaskManagerPage_module_css_default=${mapping};
    ${component}
    window.demoErrors=[];
    window.demoNewTasks=0;
    createRoot(document.getElementById('app')).render(<TaskManagerPage useCatalog={select=>select({records:[],status:'ready'})} onNewTask={()=>window.demoNewTasks++} t={t}/>);
    window.stopSchedule=mountSchedulePage(document,error=>window.demoErrors.push(String(error)));
  ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
});
const tokens = await readFile(join(root, 'src/client/theme/tokens.css'), 'utf8');
const css = (await Promise.all(['composer.css','menus.css','dialogs.css','scrollbars.css','schedule.css'].map(file=>readFile(join(root,'src/client/theme',file),'utf8')))).join('\n');
const font = (await readFile(join(root, 'assets/fonts/Geist-Variable.ttf'))).toString('base64');
const phase = process.argv[2] ?? 'after';
await withPage({ url: 'about:blank', width: 1392, height: 932, scale: 2, profile: join(work, 'profile') }, async page => {
  await page.evaluate(`(()=>{
    document.documentElement.setAttribute('data-dsh-ccd-style','true');document.documentElement.lang='zh-CN';
    window.renderErrors=[];window.addEventListener('error',e=>window.renderErrors.push(e.message));
    document.body.innerHTML='<aside aria-hidden="true">定时任务 · 演示预览</aside><main id="app"></main>';
    const style=document.createElement('style');
    style.textContent=${JSON.stringify(primitiveSheet+'\n'+hostSheet+'\n'+tokens+'\n'+css)}+
      '@font-face{font-family:Geist;src:url(data:font/ttf;base64,${font}) format("truetype");font-weight:100 900}'+
      '*{box-sizing:border-box}body{margin:0;font-family:Geist,"PingFang SC",sans-serif;background:var(--ccd-card);color:var(--ccd-text)}'+
      'aside{position:absolute;inset:0 auto 0 0;width:264px;padding:100px 24px;background:var(--ccd-sidebar);border-right:1px solid var(--ccd-border-soft);font-size:13px;color:var(--ccd-text-secondary)}'+
      '#app{position:absolute;inset:0 0 0 264px;--dsw-alias-label-tertiary:var(--ccd-text-muted);--dsw-alias-label-primary:var(--ccd-text);--dsw-alias-interactive-bg-hover:var(--ccd-hover);--dsw-alias-bg-base:var(--ccd-card)}';
    document.head.append(style);
  })()`);
  await page.evaluate(bundle.outputFiles[0].text);
  await page.evaluate('document.fonts.ready');
  const settle = () => page.evaluate('new Promise(resolve=>setTimeout(resolve,100))');
  await settle();
  assert.deepEqual(await page.evaluate('window.renderErrors'),[], 'native page rendered without errors');
  for (const theme of ['light','dark']) {
    await page.evaluate(`document.body.toggleAttribute('data-ds-dark-theme',${theme==='dark'})`);
    await settle();
    const shot=await page.send('Page.captureScreenshot',{format:'png'});
    const path=join(work,`${phase}-${theme}.png`);
    await writeFile(path,Buffer.from(shot.data,'base64'));
    console.log(path);
  }
  const facts=await page.evaluate(`(()=>{
    const measure=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),s=getComputedStyle(el);return {width:r.width,height:r.height,padding:s.padding,lineHeight:s.lineHeight}};
    return {tab:measure('.ccd-schedule-tabs button'),topNew:measure('[data-ccd-schedule-part="new"]'),emptyNew:measure('[data-ccd-schedule-part="empty"] button'),frequency:measure('.ccd-schedule-template-frequency'),clock:document.querySelector('.ccd-schedule-stopwatch circle')?.outerHTML,circle:measure('.ccd-schedule-stopwatch circle'),frequencyClock:measure('.ccd-schedule-frequency-clock svg'),errors:window.demoErrors};
  })()`);
  console.log(JSON.stringify(facts,null,2));
  if(phase==='after') {
    assert.equal(facts.tab.height,26);
    assert.equal(facts.topNew.height,26);
    assert.equal(facts.emptyNew.height,26);
    assert.ok(facts.clock?.includes('r="41"'));
    assert.ok(Math.abs(facts.circle.width-facts.circle.height)<.01,'stopwatch circle keeps equal rendered axes');
    assert.equal(facts.frequencyClock.width,16);
    assert.equal(facts.frequencyClock.height,16);
    assert.deepEqual(facts.errors,[]);
  }
  const stableLayout=()=>page.evaluate(`(()=>{
    const selectors=['h1','.ccd-schedule-toolbar','.ccd-schedule-tabs','[data-ccd-schedule-part="new"]','.ccd-schedule-tool[aria-label="筛选任务"]','[data-ccd-schedule-part="list"]','.ccd-schedule-templates'];
    return selectors.map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,x:r.x,y:r.y,width:r.width,height:r.height};});
  })()`);
  for (const width of [1392,820]) {
    await page.send('Emulation.setDeviceMetricsOverride',{width,height:932,deviceScaleFactor:2,mobile:false});
    await settle();
    const closed=await stableLayout();
    await page.evaluate(`document.querySelector('[aria-label="搜索任务"]').click()`);
    await settle();
    const opened=await stableLayout();
    assert.deepEqual(opened,closed,`${width}px: expanding search preserves all toolbar and content geometry`);
    await page.evaluate(`document.querySelector('.ccd-schedule-search-close').click()`);
    await settle();
    assert.deepEqual(await stableLayout(),closed,`${width}px: closing search also preserves layout`);
  }
  await page.send('Emulation.setDeviceMetricsOverride',{width:1392,height:932,deviceScaleFactor:2,mobile:false});
  await settle();
  console.log('Search opening and closing preserve heading, tabs, actions, list and templates at desktop and narrow widths.');
  await page.evaluate(`document.body.removeAttribute('data-ds-dark-theme');document.querySelector('[aria-label="搜索任务"]').click()`);
  await page.send('Input.insertText',{text:'简报'});
  await settle();
  assert.equal(await page.evaluate(`document.querySelector('[data-ccd-schedule-part="search"] input').value`),'简报');
  const searchFacts=await page.evaluate(`(()=>{
    const search=document.querySelector('[data-ccd-schedule-part="search"]').getBoundingClientRect();
    const action=document.querySelector('[data-ccd-schedule-part="new"]').getBoundingClientRect();
    return {centerDifference:Math.abs((search.top+search.height/2)-(action.top+action.height/2)),visible:getComputedStyle(document.querySelector('[data-ccd-schedule-part="search"]')).display};
  })()`);
  assert.ok(searchFacts.centerDifference<1,'search expands on the toolbar line');
  assert.equal(searchFacts.visible,'flex');
  let capture=await page.send('Page.captureScreenshot',{format:'png'});
  await writeFile(join(work,phase+'-search.png'),Buffer.from(capture.data,'base64'));
  await page.evaluate(`document.querySelector('.ccd-schedule-search-close').click()`);
  await settle();
  assert.equal(await page.evaluate(`document.querySelector('[data-ccd-schedule-part="search"] input').value`),'');
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-ccd-schedule-part="search"]')).display`),'none');
  await page.evaluate(`document.activeElement?.blur();document.querySelector('.ccd-schedule-tool[aria-label="筛选任务"]').click()`);
  await settle();
  const filterFacts=await page.evaluate(`(()=>{
    const menu=document.querySelector('[data-ccd-schedule-part="filters"]'),r=menu.getBoundingClientRect();
    const buttons=[...menu.querySelectorAll('button')].map(b=>b.getBoundingClientRect().top);
    return {visible:getComputedStyle(menu).display,inViewport:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,vertical:buttons.every((v,i)=>!i||v>buttons[i-1])};
  })()`);
  assert.equal(filterFacts.visible,'block');assert.ok(filterFacts.inViewport);assert.ok(filterFacts.vertical);
  capture=await page.send('Page.captureScreenshot',{format:'png'});
  await writeFile(join(work,phase+'-filter.png'),Buffer.from(capture.data,'base64'));
  await page.evaluate(`document.querySelectorAll('[data-ccd-schedule-part="filters"] button')[1].click()`);
  await settle();
  assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-schedule-part="filters"] button')[1].getAttribute('aria-pressed')`),'true');
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-ccd-schedule-part="filters"]')).display`),'none');
  await page.evaluate(`document.querySelectorAll('[data-ccd-schedule-part="filters"] button')[0].click()`);
  console.log('Inline controlled search clears on close; vertical filter selects native status and stays in viewport.');
  await page.evaluate(`document.querySelector('.ccd-schedule-tabs button:last-child').click()`);
  await settle();
  for (const theme of ['light','dark']) {
    await page.evaluate(`document.body.toggleAttribute('data-ds-dark-theme',${theme==='dark'})`);
    await settle();
    const shot=await page.send('Page.captureScreenshot',{format:'png'});
    const path=join(work,`${phase}-templates-${theme}.png`);
    await writeFile(path,Buffer.from(shot.data,'base64'));console.log(path);
    const hoverPoint=await page.evaluate(`(()=>{const r=document.querySelector('.ccd-schedule-template').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...hoverPoint});
    await settle();
    const hoverFacts=await page.evaluate(`(()=>{
      const card=document.querySelector('.ccd-schedule-template'),icon=card.querySelector('.ccd-schedule-template-icon');
      return {card:getComputedStyle(card).backgroundColor,icon:getComputedStyle(icon).backgroundColor,art:getComputedStyle(icon.querySelector('svg')).visibility,plus:getComputedStyle(icon,'::after').backgroundImage};
    })()`);
    assert.notEqual(hoverFacts.card,hoverFacts.icon);
    assert.equal(hoverFacts.art,'hidden');assert.ok(hoverFacts.plus.includes('linear-gradient'));
    const hoverShot=await page.send('Page.captureScreenshot',{format:'png'});
    const hoverPath=join(work,`${phase}-template-hover-${theme}.png`);
    await writeFile(hoverPath,Buffer.from(hoverShot.data,'base64'));console.log(hoverPath);
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:1,y:1});
    await page.evaluate(`document.querySelector('.ccd-schedule-template').focus()`);
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('.ccd-schedule-template-icon svg')).visibility`),'hidden','keyboard focus shows the same create affordance');
    await page.evaluate(`document.activeElement.blur()`);
  }
  const templateFacts=await page.evaluate(`(()=>{
    const cards=[...document.querySelectorAll('.ccd-schedule-template')];
    const first=cards[0].getBoundingClientRect(),secondRow=cards[2].getBoundingClientRect();
    const tabs=document.querySelector('.ccd-schedule-toolbar').getBoundingClientRect();
    const icon=cards[0].querySelector('.ccd-schedule-template-icon').getBoundingClientRect();
    return {firstRowGap:first.top-tabs.bottom,rowPitch:secondRow.top-first.top,iconSize:icon.width,columns:getComputedStyle(document.querySelector('.ccd-schedule-templates')).gridTemplateColumns.split(' ').length};
  })()`);
  assert.equal(templateFacts.columns,2);assert.equal(templateFacts.iconSize,36);
  assert.ok(templateFacts.firstRowGap<=32,'template grid follows tabs without a phantom row');
  assert.equal(templateFacts.rowPitch,88);
  console.log('Template page geometry',templateFacts);
  await page.send('Emulation.setDeviceMetricsOverride',{width:820,height:932,deviceScaleFactor:2,mobile:false});
  await page.evaluate(`document.body.removeAttribute('data-ds-dark-theme')`);
  await settle();
  const narrow=await page.evaluate(`(()=>{const grid=document.querySelector('.ccd-schedule-templates');return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,overflow:grid.scrollWidth>grid.clientWidth}})()`);
  assert.equal(narrow.columns,1);assert.equal(narrow.overflow,false);
  const narrowShot=await page.send('Page.captureScreenshot',{format:'png'});
  await writeFile(join(work,phase+'-narrow.png'),Buffer.from(narrowShot.data,'base64'));
  console.log('Narrow single-column layout has no horizontal overflow.');
  await page.evaluate(`document.querySelector('.ccd-schedule-tabs button:first-child').click()`);
  await page.evaluate(`document.querySelector('[data-ccd-schedule-part="empty"] button').click()`);
  assert.equal(await page.evaluate('window.demoNewTasks'),1);
  await page.evaluate(`document.querySelector('.ccd-schedule-tabs button:last-child').click()`);
  assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-ccd-schedule-part="list"]')).display`),'none');
  await page.evaluate(`document.querySelector('.ccd-schedule-tabs button:first-child').click();document.querySelector('[aria-label="搜索任务"]').click()`);
  await page.send('Input.insertText',{text:'待清除'});await settle();
  await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
  await settle();
  assert.equal(await page.evaluate(`document.querySelector('[data-ccd-schedule-part="search"] input').value`),'');
  assert.equal(await page.evaluate(`document.querySelector('[data-ccd-schedule]').hasAttribute('data-ccd-search-open')`),false);
  await page.evaluate(`window.stopSchedule()`);
  assert.equal(await page.evaluate(`document.querySelectorAll('.ccd-schedule-toolbar,.ccd-schedule-templates,.ccd-schedule-stopwatch,[data-ccd-schedule-part]').length`),0);
  console.log('Native create action, template tab and enhancement cleanup passed.');
});
