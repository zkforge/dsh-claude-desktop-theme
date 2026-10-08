import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Same optional browser coverage as the menus. */ }

test('an entirely empty tree shows a recoverable prompt and reconciles live catalog changes', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 20000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'ts', contents: `
      import {mountEmptyGroups} from './src/client/compat/empty-groups.ts';
      import {createSidebarSessionsPort} from './src/client/compat/adapter.ts';
      const listeners = new Set();
      const sessions = {phase:'pending',ids:['a'],byId:{a:{blank:true}}};
      const workspaces = {phase:'ready',archivedSessionIds:[],items:[
        {workspaceId:'first',path:'/first',sessionIds:['a']},
        {workspaceId:'second',path:'/second',sessionIds:[]},
      ]};
      const store = snapshot => ({getSnapshot:()=>snapshot,subscribe:notify=>{listeners.add(notify);return()=>listeners.delete(notify);}});
      const source = createSidebarSessionsPort({sessions:{list:store(sessions)},workspaces:{list:store(workspaces)}});
      let filter = 0;
      const settings = {getSnapshot:()=>({groups:[{selected:0},{selected:0},{selected:filter}]}),subscribe:store(null).subscribe};
      window.showAllCalls = 0;
      window.mountRule = (hideEmpty = true) => window.release = mountEmptyGroups(document,hideEmpty,error=>{throw error;},{source,settings,showAll:()=>window.showAllCalls++});
      window.updateCatalog = (blank, archive = false) => {
        sessions.phase='ready'; sessions.byId.a.blank=blank;
        workspaces.archivedSessionIds=archive?['a']:[];
        listeners.forEach(notify=>notify());
      };
      window.filterArchived = () => {filter=2;listeners.forEach(notify=>notify());};
      window.makeUngrouped = () => {workspaces.items=[];filter=0;listeners.forEach(notify=>notify());};
      window.mountRule();
    ` }, bundle: true, write: false, format: 'iife',
  });
  const styles = (await Promise.all(['src/client/theme/tokens.css', 'src/client/features/sidebar/sidebar.css']
    .map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-empty-groups-test-'));
  try {
    await withPage({ url: 'about:blank', width: 600, height: 650, scale: 2, profile }, async page => {
      await page.evaluate(`document.documentElement.lang='en';document.documentElement.setAttribute('data-dsh-ccd-style','true');document.body.innerHTML='<div class="_7514NG_listArea" style="width:270px;height:500px"><div class="_7514NG_treeBody"><div class="_7514NG_groupSection"><div data-row-key="workspace:first" aria-expanded="false">First project</div></div><div class="_7514NG_groupSection"><div data-row-key="workspace:second" aria-expanded="true">Second project</div></div></div></div>';const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);`);
      await page.evaluate(bundle.outputFiles[0].text);
      const pause = () => page.evaluate('new Promise(resolve=>setTimeout(resolve,70))');
      await pause();
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-empty-state]')`), false, 'loading does not invent an empty tree');
      await page.evaluate('window.updateCatalog(true)'); await pause();
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-empty-state]').length`), 1);
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-empty-state] > div').textContent`), 'Sessions you start will show up here');
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-empty-state] button')`), false, 'no filter recovery action when there is no history');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-empty-state] svg').getAttribute('aria-hidden')`), 'true');
      assert.equal(await page.evaluate(`(()=>{const area=document.querySelector('._7514NG_listArea').getBoundingClientRect();const state=document.querySelector('[data-ccd-empty-state]').getBoundingClientRect();return Math.abs(state.y+state.height/2-area.y-area.height/2)<1})()`), true, 'the prompt fills and centers in the remaining list area');
      assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('._7514NG_groupSection'),node=>getComputedStyle(node).display)`), ['none', 'none'], 'the first collapsed empty project is hidden too');
      await page.evaluate('window.updateCatalog(false)'); await pause();
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-empty-state]')`), false);
      assert.notEqual(await page.evaluate(`getComputedStyle(document.querySelector('._7514NG_groupSection')).display`), 'none', 'collapsed history stays reachable');
      await page.evaluate('window.updateCatalog(false,true)'); await pause();
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-empty-state]')`), true, 'archiving the last active session creates the prompt');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-empty-state] > div').textContent`), 'No sessions match the current filters');
      const p = await page.evaluate(`(()=>{const r=document.querySelector('[data-ccd-empty-state] button').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await page.send('Input.dispatchMouseEvent', {type:'mousePressed',...p,button:'left',clickCount:1});
      await page.send('Input.dispatchMouseEvent', {type:'mouseReleased',...p,button:'left',clickCount:1});
      assert.equal(await page.evaluate('window.showAllCalls'), 1);
      await page.evaluate('window.filterArchived()'); await pause();
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-empty-state]')`), false, 'changing the native filter restores matching history');
      await page.evaluate(`window.release();document.documentElement.lang='zh';window.updateCatalog(true);window.mountRule(false)`); await pause();
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-empty-state] > div').textContent`), '你发起的会话会显示在这里');
      assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('._7514NG_groupSection'),node=>getComputedStyle(node).display)`), ['none', 'none'], 'even Show empty groups has no orphan headings without any history');
      await page.evaluate(`window.updateCatalog(false)`); await pause();
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-empty-state]')`), false, 'the first durable session restores headings with Show empty groups enabled');
      await page.evaluate(`window.release();window.updateCatalog(false,false);window.mountRule()`); await pause();
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-empty-state] button').textContent`), '显示所有会话');
      await page.evaluate('window.release()'); await pause();
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-empty-state], [data-ccd-empty-group], [data-ccd-list-empty]').length`), 0, 'release removes every plugin marker and prompt');
      await page.evaluate(`document.querySelector('._7514NG_treeBody').innerHTML='<div data-row-key="session:a" data-ccd-blank-session></div>';window.mountRule()`); await pause();
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-empty-state]').length`), 1, 'a flat list containing only the hidden provisional row is empty too');
      await page.evaluate(`window.release();document.querySelector('._7514NG_treeBody').innerHTML='<div data-row-key="empty">Native empty placeholder</div>';window.mountRule()`); await pause();
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-row-key="empty"]')).display`), 'none', 'the native placeholder does not duplicate our prompt');
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-empty-state]').length`), 1);
      await page.evaluate('window.release()');
      await page.evaluate(`window.makeUngrouped();window.updateCatalog(true);document.querySelector('._7514NG_treeBody').innerHTML='<div class="_7514NG_groupSection"><div data-row-key="workspace:" aria-expanded="false">未分组</div></div>';window.mountRule(false)`); await pause();
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('._7514NG_groupSection')).display`), 'none', 'an empty collapsed Ungrouped bucket never replaces the welcome prompt');
      await page.evaluate(`window.release();window.updateCatalog(false);window.mountRule()`); await pause();
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-empty-state]')`), false);
      assert.notEqual(await page.evaluate(`getComputedStyle(document.querySelector('._7514NG_groupSection')).display`), 'none', 'collapsed Ungrouped history is retained from the catalog');
      await page.evaluate('window.release()');
    });
  } finally { await rm(profile, {recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});
