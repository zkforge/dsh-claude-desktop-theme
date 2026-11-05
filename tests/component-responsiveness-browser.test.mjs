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
try { chrome = findChrome(); } catch { /* Optional local Chrome. */ }
const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
  import React from 'react';
  import {createRoot} from 'react-dom/client';
  import {ConfigPage} from './src/client/features/settings/ConfigPage.tsx';
  import {adoptConfig} from './src/shared/config.ts';
  import {EffortPanel} from './src/client/features/model-controls/EffortPanel.tsx';
  import {ModelPanel} from './src/client/features/model-controls/ModelControls.tsx';
  import {SearchPalette} from './src/client/features/search-palette/SearchPalette.tsx';
  import {ClaudePet} from './src/client/features/composer-pet/ClaudePet.tsx';
  import {ComposerPet} from './src/client/features/composer-pet/ComposerPet.tsx';
  import {mountHeroCanvas} from './src/client/compat/hero-canvas.ts';
  import {createHeroSpace} from './src/client/features/new-session/space.ts';
  import {drawHeroRipples} from './src/client/features/new-session/ripples.ts';
  import {mountStatisticsCard} from './src/client/features/statistics/mount.ts';
  import {CleanupScope} from './src/client/core/cleanup.ts';
  import {mountSchedulePage} from './src/client/compat/schedule-page.ts';
  import {mountScheduleDetail} from './src/client/compat/schedule-detail.ts';
  import {mountScheduleCardMenus} from './src/client/compat/schedule-card-menu.ts';
  let app, release;
  window.errors=[];
  const listeners=new Set();
  let config=adoptConfig({enabled:true}), snapshot={status:'ready',revision:0,value:config};
  const form={getSnapshot:()=>snapshot,subscribe:l=>{listeners.add(l);return()=>listeners.delete(l);},
    mutate:async ops=>{
      config=structuredClone(config);
      for(const op of ops){let target=config;for(const key of op.path.slice(0,-1))target=target[key];
        if(op.op==='set')target[op.path.at(-1)]=op.value;else delete target[op.path.at(-1)];}
      snapshot={status:'ready',revision:snapshot.revision+1,value:config};listeners.forEach(l=>l());return true;
    }};
  window.unmount=()=>{app?.unmount();app=null;release?.();release=null;};
  window.mountScheduleExtras=()=>{
    const task={id:'demo-task',sessionId:'demo-session',title:'用户任务',prompt:'保留我的原始指令。',scheduledAt:new Date().toISOString(),status:'active'};
    const detail=mountScheduleDetail(document,{list:async()=>[task],history:async()=>({id:task.id,records:[]}),subscribe:()=>()=>{}},e=>window.errors.push(String(e)));
    const menus=mountScheduleCardMenus(document,{find:async()=>task,remove:async()=>window.deleted=true},e=>window.errors.push(String(e)));
    const previous=release;release=()=>{menus();detail();previous?.();};
  };
  window.mount=kind=>{
    window.unmount();
    if(kind==='ripples'||kind==='space'){
      const renderer=kind==='space'?createHeroSpace():drawHeroRipples;
      release=mountHeroCanvas(document,renderer,e=>window.errors.push(String(e)));return;
    }
    if(kind==='schedule'){
      release=mountSchedulePage(document,e=>window.errors.push(String(e)),prompt=>window.template=prompt);return;
    }
    if(kind==='statistics'){
      const totals={sessions:1000,messages:10000,tokens:1000000,activeDays:182,topModel:'demo',models:[['demo',1000000]]};
      const current={version:2,ranges:{all:totals,'30d':totals,'7d':totals},busyHour:10,
        days:[],modelDays:[],modelIO:[['demo',800000,200000]],pending:0,missed:0,computedAt:1};
      const subs=new Set();
      const source={current,subscribe:l=>{subs.add(l);return()=>subs.delete(l);},setActive(){},dispose(){}};
      window.updateStats=()=>subs.forEach(l=>l({...current,computedAt:2}));
      const scope=new CleanupScope(e=>window.errors.push(String(e)));
      mountStatisticsCard(document,scope,{error:(m,e)=>window.errors.push(m+String(e))},source);
      release=()=>scope.dispose();return;
    }
    app=createRoot(document.getElementById('root'));
    const anchor={current:document.querySelector('#anchor')};
    const close=()=>window.unmount();
    if(kind==='models'){
      const state={groups:[{id:'demo',name:'Demo',models:Array.from({length:500},(_,i)=>({id:String(i),name:'Model '+i}))}],
        current:null,pending:null,failures:[],error:null,status:'ready',routable:true};
      app.render(<ModelPanel showModelIcons={true} anchor={anchor} state={state} disabled={false} load={()=>{}}
        t={key=>key} onClose={close} onSelect={value=>window.modelSelection=value}/>);return;
    }
    if(kind==='search'){
      const catalog={sessions:Array.from({length:2000},(_,i)=>({id:String(i),title:'Demo session '+i,
        workspace:'demo',updatedAt:Date.now()-i*1000,running:false,archived:false,pinned:false})),projects:[],schedules:[]};
      let open=true;const subs=new Set();
      const state={isOpen:()=>open,subscribe:l=>{subs.add(l);return()=>subs.delete(l);},
        close:()=>{open=false;subs.forEach(l=>l());},open:()=>{open=true;subs.forEach(l=>l());}};
      const port={getSnapshot:()=>catalog,subscribe:()=>()=>{},refreshSchedules:()=>{},
        searchContent:async()=>[],scheduleRuns:async()=>({count:0,more:false}),openSession:id=>window.openedSession=id,
        startSession:()=>{},openSchedule:()=>{},setPinned:async()=>{},setArchived:async()=>{},fork:async()=>{},copy:async()=>{}};
      app.render(<SearchPalette state={state} port={port} report={e=>window.errors.push(String(e))}/>);return;
    }
    const node=kind==='settings'?<ConfigPage form={form}/>:
      kind==='effort'?<EffortPanel anchor={anchor} choices={['Low','Medium','High','Ultra'].map((name,id)=>({id:String(id),name}))}
        selected={0} defaultIndex={1} disabled={false} busy={false} error={null}
        onCommit={value=>window.committed=value} onClose={close}/>:
      kind==='claude'?<ClaudePet/>:<ComposerPet/>;
    app.render(node);
  };
` }, bundle: true, write: false, format: 'iife', jsx: 'automatic' });
const styles = (await Promise.all([
  'src/client/theme/tokens.css', 'src/client/theme/menus.css', 'src/client/theme/composer.css',
  'src/client/theme/schedule.css', 'src/client/features/settings/settings.css',
  'src/client/features/model-controls/controls.css', 'src/client/features/model-controls/effort.css',
  'src/client/features/composer-pet/pet.css', 'src/client/features/new-session/new-session.css',
  'src/client/features/statistics/statistics.css',
].map(path => readFile(join(root, path), 'utf8')))).join('\n');

async function fixture(callback) {
  const profile = await mkdtemp(join(tmpdir(), 'ccd-responsive-'));
  try {
    await withPage({ url: 'about:blank', width: 1392, height: 932, scale: 2, profile }, async page => {
      await page.evaluate(`
        document.documentElement.setAttribute('data-dsh-ccd-style','true');document.documentElement.lang='zh-CN';
        document.body.innerHTML='<button id="anchor" style="position:fixed;right:30px;bottom:30px">Anchor</button><div id="root"></div>';
        const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);
        window.pendingFrames=new Set();
        const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
        window.requestAnimationFrame=callback=>{const id=request(time=>{pendingFrames.delete(id);callback(time);});pendingFrames.add(id);return id;};
        window.cancelAnimationFrame=id=>{pendingFrames.delete(id);cancel(id);};
        window.measure=window.__ccdPerf?.measure??(async(name,action,ready=()=>true)=>{
          const start=performance.now();await action();
          while(!ready()){if(performance.now()-start>5000)throw new Error(name+' timed out');await new Promise(requestAnimationFrame);}
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        });
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      await callback(page);
      await page.evaluate("measure('unmount',()=>window.unmount())");
      assert.equal(await page.evaluate('pendingFrames.size'), 0, 'component animation frames are cancelled');
      assert.deepEqual(await page.evaluate('window.errors'), []);
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}
const options = { skip: chrome ? false : 'Chrome unavailable', timeout: 30000 };

test('settings mounts, saves switches, opens choice/font/colour controls and cleans up', options, async () => fixture(async page => {
  await page.evaluate("measure('settings:mount',()=>mount('settings'),()=>!!document.querySelector('#ccd-settings-enabled'))");
  await page.evaluate("measure('settings:toggle',()=>document.querySelector('#ccd-settings-enabled').click(),()=>document.querySelector('#ccd-settings-enabled').getAttribute('aria-checked')==='false')");
  for (const label of ['关闭', '宠物畅游', '字符水波纹']) {
    await page.evaluate(`measure('background:open',()=>document.querySelector('#ccd-settings-hero-background').click(),()=>!!document.querySelector('[role=listbox]'))`);
    await page.evaluate(`measure('background:select',()=>Array.from(document.querySelectorAll('[role=option]')).find(button=>button.textContent===${JSON.stringify(label)}).click(),()=>document.querySelector('#ccd-settings-hero-background').textContent===${JSON.stringify(label)})`);
  }
  await page.evaluate("measure('settings:choice',()=>document.querySelector('#ccd-settings-pet-style').click(),()=>!!document.querySelector('.ccd-settings-menu'))");
  await page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await page.evaluate("measure('settings:font',()=>document.querySelector('#ccd-settings-font-uiLatin').click(),()=>!!document.querySelector('.ccd-settings-font-menu'))");
  await page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await page.evaluate("measure('settings:colour',()=>document.querySelector('.ccd-settings-colour-swatch').click(),()=>!!document.querySelector('.ccd-settings-colour-menu'))");
}));

test('effort opens, responds to keyboard choice, draws ultra and cancels animation', options, async () => fixture(async page => {
  await page.evaluate("measure('effort:open',()=>mount('effort'),()=>!!document.querySelector('.ccd-effort:popover-open'))");
  await page.evaluate("measure('effort:select-ultra',()=>document.querySelector('.ccd-effort .range').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})),()=>window.committed===3&&document.querySelector('.ccd-effort').hasAttribute('data-ultra'))");
  await page.evaluate('new Promise(r=>setTimeout(r,500))');
  assert.ok(await page.evaluate('document.querySelector(".pixel-field").width') > 0);
}));

test('effort language changes update the open panel and help without changing the selected tier', options, async () => fixture(async page => {
  await page.evaluate("measure('effort:locale-open',()=>mount('effort'),()=>!!document.querySelector('.ccd-effort:popover-open'))");
  await page.evaluate("measure('effort:locale-select',()=>document.querySelector('.ccd-effort .range').dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true})),()=>window.committed===3)");
  for (const [language,title,tier,faster,smarter,marker] of [
    ['en-US','Effort','Ultra','Faster','Smarter','Default'],
    ['zh-CN','思考强度','超高','更快','更深入','默认'],
  ]) {
    await page.evaluate(`measure('effort:language',()=>document.documentElement.lang=${JSON.stringify(language)},()=>document.querySelector('.ccd-effort').getAttribute('aria-label')===${JSON.stringify(title)})`);
    const state=await page.evaluate(`(()=>{const panel=document.querySelector('.ccd-effort');return {
      tier:panel.querySelector('.level-current').textContent,value:panel.querySelector('.range').value,
      axis:[...panel.querySelectorAll('.axis span')].map(e=>e.textContent),marker:panel.querySelector('.default-marker').textContent,
      help:panel.querySelector('.tooltip').textContent};})()`);
    assert.equal(state.tier,tier);assert.equal(state.value,'3');assert.deepEqual(state.axis,[faster,smarter]);assert.equal(state.marker,marker);
    assert.equal(/[\u3400-\u9fff]/u.test(state.help),language.startsWith('zh'));
    assert.equal(await page.evaluate('window.committed'),3);
  }
}));

test('statistics language changes preserve tabs and range and translate all card copy', options, async () => fixture(async page => {
  await page.evaluate(`document.querySelector('#root').innerHTML='<div data-phase="hero"><div class="ST7X_W_composerStack ST7X_W_composerHero"><div class="bocITq_root">Hello</div></div></div>';
    measure('statistics:locale-mount',()=>mount('statistics'),()=>!!document.querySelector('[data-ccd-stats-card]'))`);
  await page.evaluate("measure('statistics:locale-models',()=>document.querySelector('[data-option=models]').click(),()=>!!document.querySelector('.ccd-stats-models'))");
  await page.evaluate("measure('statistics:locale-range',()=>document.querySelector('[data-option=\"7d\"]').click())");
  await page.evaluate("measure('statistics:locale-en',()=>document.documentElement.lang='en-US',()=>!!document.querySelector('[aria-label=\"Daily token usage by model\"]'))");
  assert.equal(await page.evaluate('document.querySelector("[data-option=models]").getAttribute("aria-pressed")'),'true');
  assert.equal(await page.evaluate('document.querySelector(\'[data-option="7d"]\').getAttribute("aria-pressed")'),'true');
  assert.equal(await page.evaluate('document.querySelector(".ccd-stats-legend-usage").textContent'),'Input 800k · Output 200k');
  await page.evaluate("measure('statistics:locale-overview',()=>document.querySelector('[data-option=overview]').click(),()=>!!document.querySelector('.ccd-stats-overview'))");
  const labels=await page.evaluate('[...document.querySelectorAll(".ccd-stats-label")].map(e=>e.textContent)');
  assert.deepEqual(labels,['Sessions','Messages','Total tokens','Active days','Peak hour','Favorite model']);
  assert.match(await page.evaluate('document.querySelector(".ccd-stats-note").textContent'),/^You've used about /);
  await page.evaluate("measure('statistics:locale-zh',()=>document.documentElement.lang='zh-CN',()=>!!document.querySelector('[aria-label=\"每日活跃热力图\"]'))");
  assert.equal(await page.evaluate('document.querySelector(".ccd-stats-label").textContent'),'会话数');
  assert.equal(await page.evaluate('document.querySelector(\'[data-option="7d"]\').getAttribute("aria-pressed")'),'true');
}));

test('both pets mount and animate without retaining frames after unmount', options, async () => fixture(async page => {
  for (const kind of ['whale', 'claude']) {
    await page.evaluate("measure(" + JSON.stringify(kind + ':mount') + ",()=>mount(" + JSON.stringify(kind) + "),()=>!!document.querySelector('.ccd-composer-pet'))");
    await page.evaluate('new Promise(r=>setTimeout(r,500))');
    await page.evaluate("measure('pet:unmount',()=>window.unmount())");
    assert.equal(await page.evaluate('pendingFrames.size'), 0);
  }
}));

test('hero ripple and statistics respond to phase changes, tabs, ranges and snapshots', options, async () => fixture(async page => {
  await page.evaluate(`
    document.querySelector('#root').innerHTML='<div class="ST7X_W_root" data-phase="hero" style="position:relative;width:1000px;height:700px"><div class="ST7X_W_composerStack ST7X_W_composerHero"><div class="bocITq_root">Hello</div></div></div>';
    measure('ripples:mount',()=>mount('ripples'),()=>!!document.querySelector('canvas.ccd-hero-ripples'));
  `);
  await page.evaluate('new Promise(r=>setTimeout(r,500))');
  await page.evaluate("measure('ripples:leave-hero',()=>document.querySelector('[data-phase]').setAttribute('data-phase','active'),()=>!document.querySelector('canvas.ccd-hero-ripples'))");
  await page.evaluate("document.querySelector('[data-phase]').setAttribute('data-phase','hero')");
  await page.evaluate("measure('space:mount',()=>mount('space'),()=>!!document.querySelector('.ccd-hero-space'))");
  await page.evaluate("window.previousSpaceCanvas = new WeakRef(document.querySelector('.ccd-hero-space'))");
  await page.evaluate(`document.querySelector('[data-phase]').dispatchEvent(new PointerEvent('pointermove',{clientX:120,clientY:310}));`);
  await page.evaluate("measure('space:leave-hero',()=>document.querySelector('[data-phase]').setAttribute('data-phase','active'),()=>!document.querySelector('canvas.ccd-hero-ripples'))");
  await page.send('HeapProfiler.collectGarbage');
  assert.equal(await page.evaluate('previousSpaceCanvas.deref() === undefined'), true, 'chat releases the previous space canvas');
  await page.evaluate("document.querySelector('[data-phase]').setAttribute('data-phase','hero')");
  await page.evaluate("measure('statistics:mount',()=>mount('statistics'),()=>!!document.querySelector('[data-ccd-stats-card]'))");
  await page.evaluate("measure('statistics:models',()=>document.querySelector('[data-option=\"models\"]').click(),()=>!!document.querySelector('[aria-label=\"各模型每日 Token 用量\"]'))");
  await page.evaluate("measure('statistics:range',()=>document.querySelector('[data-option=\"7d\"]').click())");
  await page.evaluate("measure('statistics:snapshot',()=>window.updateStats())");
}));

test('schedule page mounts templates, filters and search with native actions intact', options, async () => fixture(async page => {
  await page.evaluate(`
    document.querySelector('#root').innerHTML='<div data-testid="task-manager-page"><div><div><h1>自动化任务</h1><button id="new-task">新建</button></div><div><button>全部</button></div><div><input placeholder="搜索"/></div><div role="status"><h2>还没有自动化任务，在会话中创建的任务会显示在这里</h2><button>新建</button></div></div></div>';
    window.newTasks=0;document.querySelector('#new-task').onclick=()=>window.newTasks++;
    measure('schedule:mount',()=>mount('schedule'),()=>!!document.querySelector('.ccd-schedule-tabs'));
  `);
  await page.evaluate("measure('schedule:templates',()=>document.querySelector('.ccd-schedule-tabs button:last-child').click(),()=>document.querySelector('[data-testid]').getAttribute('data-ccd-schedule')==='templates')");
  await page.evaluate("measure('schedule:template-action',()=>document.querySelector('.ccd-schedule-template').click(),()=>window.newTasks===1&&typeof window.template==='string')");
  await page.evaluate("measure('schedule:mine',()=>document.querySelector('.ccd-schedule-tabs button:first-child').click())");
  await page.evaluate("measure('schedule:filter',()=>document.querySelector('[aria-label=\"筛选任务\"]').click(),()=>document.querySelector('[data-testid]').hasAttribute('data-ccd-filter-open'))");
  await page.evaluate("measure('schedule:search',()=>document.querySelector('[aria-label=\"搜索任务\"]').click(),()=>document.activeElement.tagName==='INPUT')");
}));

test('schedule language changes preserve controls and query and use the matching template draft', options, async () => fixture(async page => {
  await page.evaluate(`document.querySelector('#root').innerHTML='<div data-testid="task-manager-page"><div><div><h1>自动化任务</h1><button id="new-task">新建</button></div><div><button>全部</button></div><div><input placeholder="搜索"/></div><div role="status"><h2>还没有自动化任务，在会话中创建的任务会显示在这里</h2><button>新建</button></div></div></div>';
    window.newTasks=0;document.querySelector('#new-task').onclick=()=>window.newTasks++;
    measure('schedule:locale-mount',()=>mount('schedule'),()=>!!document.querySelector('.ccd-schedule-tabs'))`);
  await page.evaluate(`document.querySelector('.ccd-schedule-tabs button:last-child').click();
    document.querySelector('[data-ccd-schedule-tool=search]').click();document.querySelector('input').value='My task';
    window.firstTemplate=document.querySelector('.ccd-schedule-template');
    measure('schedule:locale-en',()=>document.documentElement.lang='en-US',()=>document.querySelector('h1').textContent==='Scheduled tasks')`);
  assert.deepEqual(await page.evaluate('[...document.querySelectorAll(".ccd-schedule-tabs button")].map(e=>e.textContent)'),['Mine','Templates']);
  assert.equal(await page.evaluate('document.querySelector("[data-testid]").getAttribute("data-ccd-schedule")'),'templates');
  assert.equal(await page.evaluate('document.querySelector("input").value'),'My task');
  assert.equal(await page.evaluate('document.querySelector("h2").textContent'),'No scheduled tasks yet.');
  assert.equal(await page.evaluate('document.querySelector("#new-task").textContent'),'New task');
  assert.equal(await page.evaluate('document.querySelector(".ccd-schedule-template-name").textContent'),'Daily briefing');
  assert.equal(await page.evaluate('document.querySelector(".ccd-schedule-template-frequency").textContent'),'Weekdays at 09:00');
  assert.equal(await page.evaluate('document.querySelectorAll(".ccd-schedule-frequency-clock svg").length'),8);
  await page.evaluate(`document.querySelector('[data-ccd-schedule-tool=filter]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
    measure('schedule:locale-template',()=>firstTemplate.click(),()=>typeof window.template==='string')`);
  assert.match(await page.evaluate('window.template'),/^Every weekday at 9 AM/);
  assert.equal(await page.evaluate('window.newTasks'),1);
  await page.evaluate("measure('schedule:locale-zh',()=>document.documentElement.lang='zh-CN',()=>document.querySelector('h1').textContent==='定时任务')");
  assert.equal(await page.evaluate('document.querySelector(".ccd-schedule-template")===firstTemplate'),true);
  assert.equal(await page.evaluate('document.querySelector("input").value'),'My task');
  assert.equal(await page.evaluate('document.querySelector("[data-testid]").getAttribute("data-ccd-schedule")'),'templates');
  await page.evaluate("measure('schedule:locale-release',()=>window.unmount())");
  assert.equal(await page.evaluate('document.querySelector("h1").textContent'),'自动化任务');
  assert.equal(await page.evaluate('document.querySelector("input").getAttribute("placeholder")'),'搜索');
}));

test('schedule details and delete confirmation localize without translating saved task content', options, async () => fixture(async page => {
  await page.evaluate(`document.documentElement.lang='en-US';
    document.querySelector('#root').innerHTML='<div data-testid="task-manager-page"><div><div><h1>Tasks</h1><button>New</button></div><div></div><div><input/></div><div><ul><li><button id="task" aria-label="用户任务" aria-describedby="detail-metadata-demo-task"><span><span>用户任务</span><span><span>Daily at 09:00</span></span></span></button></li></ul></div></div></div>';
    measure('schedule:detail-mount',()=>mount('schedule'),()=>!!document.querySelector('.ccd-schedule-tabs'));
    mountScheduleExtras()`);
  await page.evaluate("measure('schedule:detail-open',()=>document.querySelector('#task').click(),()=>document.querySelector('.ccd-schedule-detail-history').textContent==='No runs yet')");
  assert.deepEqual(await page.evaluate('[...document.querySelectorAll(".ccd-schedule-detail h2")].map(e=>e.textContent)'),['History','Instructions','Repeat frequency']);
  assert.equal(await page.evaluate('document.querySelector(".ccd-schedule-detail h1").textContent'),'用户任务');
  assert.equal(await page.evaluate('document.querySelector(".ccd-schedule-detail-prompt").textContent'),'保留我的原始指令。');
  await page.evaluate("measure('schedule:detail-zh',()=>document.documentElement.lang='zh-CN',()=>document.querySelector('.ccd-schedule-detail-history').textContent==='暂无运行记录')");
  assert.deepEqual(await page.evaluate('[...document.querySelectorAll(".ccd-schedule-detail h2")].map(e=>e.textContent)'),['历史记录','指令','重复频率']);
  await page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));measure('schedule:menu-en',()=>document.documentElement.lang='en-US',()=>document.querySelector('h1').textContent==='Scheduled tasks')");
  await page.evaluate("measure('schedule:menu-open',()=>document.querySelector('.ccd-schedule-card-more').click(),()=>!document.querySelector('.ccd-schedule-card-menu').hidden)");
  assert.equal(await page.evaluate('document.querySelector(".ccd-schedule-card-menu [role=menuitem]").textContent'),'Delete task');
  await page.evaluate("measure('schedule:confirmation',()=>document.querySelector('.ccd-schedule-card-menu [role=menuitem]').click(),()=>!!document.querySelector('dialog:modal button.ccd-schedule-delete-confirm:not(:disabled)'))");
  assert.equal(await page.evaluate('document.querySelector("dialog h2").textContent'),'Delete scheduled task?');
  assert.match(await page.evaluate('document.querySelector("dialog p").textContent'),/Delete “用户任务”/);
  assert.equal(await page.evaluate('window.deleted'),undefined);
  await page.evaluate("document.querySelector('dialog button').click()");
}));

test('large model and session catalogs open, filter and select without losing native actions', options, async () => fixture(async page => {
  await page.evaluate(`
    window.typeInto=(selector,text)=>{
      const field=document.querySelector(selector);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,text);
      field.dispatchEvent(new Event('input',{bubbles:true}));
    };
    measure('models:open-500',()=>mount('models'),()=>document.querySelectorAll('[data-model-option]').length===500);
  `);
  await page.evaluate("measure('models:filter-500',()=>typeInto('.ccd-model-search','Model 499'),()=>document.querySelectorAll('[data-model-option]').length===1)");
  await page.evaluate("measure('models:select',()=>document.querySelector('[data-model-option]').click(),()=>window.modelSelection?.model==='499')");
  await page.evaluate("measure('search:open-2000',()=>mount('search'),()=>!!document.querySelector('.ccd-search-palette:modal'))");
  await page.evaluate("measure('search:filter-2000',()=>typeInto('.ccd-search-palette input','Demo session 1999'),()=>document.querySelectorAll('[role=option][data-key^=session]').length===1)");
  await page.evaluate("measure('search:select',()=>document.querySelector('[role=option][data-key^=session]').click(),()=>window.openedSession==='1999')");
}));
