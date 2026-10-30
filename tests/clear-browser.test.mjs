import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
let chrome;
try { chrome = findChrome(); } catch { /* CI provides Chrome. */ }

test('clear hides old turns and paged rows, allows history inspection, and restores on disposal', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 30000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import {mountClearHistory} from './src/client/compat/clear-history.ts';
    window.mount=()=>mountClearHistory(window.ctx,document,error=>{throw error});
  ` }, bundle: true, write: false, format: 'iife' });
  const styles = await readFile('src/client/theme/composer.css', 'utf8');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-clear-'));
  try {
    await withPage({ url: 'about:blank', width: 800, height: 600, profile }, async page => {
      await page.evaluate(`
        document.body.innerHTML='<main data-conversation-session="a"><div id="frame"><div><nav>Turns</nav></div><div><div><div data-chat-flow>'+
          '<div id="older"><button>Load older</button></div><div data-slot="conversation.chat.flow">'+
          '<div id="old" data-chat-flow-key="old" data-chat-node-key="old" data-chat-turn="1">Old secret</div>'+
          '<div id="group" data-chat-flow-key="group" data-chat-turn="1">Old tools</div>'+
          '<div id="command" data-chat-flow-key="command" data-chat-node-key="command">clear</div>'+
          '<div id="internal" data-chat-flow-key="internal" data-chat-node-key="internal"></div>'+
          '<div id="fresh" data-chat-flow-key="fresh" data-chat-node-key="fresh" data-chat-turn="2">New question</div>'+
          '</div></div></div></div></div></main>';
        const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);
        window.boundary={seq:10,turn:1,lastTurn:2};window.listeners=new Set();
        window.nodes=new Map([['old',{id:'old',anchorSeq:1}],['command',{id:'cmd',anchorSeq:9}],
          ['internal',{id:'ccd-clear:cmd',anchorSeq:10}],['fresh',{id:'fresh',anchorSeq:12}]]);
        window.ctx={sessions:{list:{getSnapshot:()=>({projectionsBySession:{a:{values:{ccdClear:window.boundary}}}}),
          subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}}},
          uiConversation:{binding:()=>({snapshot:{getSnapshot:()=>({views:{get:()=>({nodes:window.nodes})}})}})}};
        window.tick=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      await page.evaluate('window.dispose=window.mount()');
      const visible = id => page.evaluate(`getComputedStyle(document.getElementById(${JSON.stringify(id)})).display !== 'none'`);
      for (const id of ['old', 'group', 'command', 'internal', 'older']) assert.equal(await visible(id), false, id);
      assert.equal(await visible('fresh'), true);
      await page.evaluate('document.querySelector("[data-ccd-clear-notice] button").click()');
      for (const id of ['old', 'group', 'command', 'older']) assert.equal(await visible(id), true, id);
      assert.equal(await visible('internal'), false, 'implementation markers are never shown');
      await page.evaluate('window.dispose();window.dispose=window.mount()');
      assert.equal(await visible('old'), false, 'remount defaults to the current segment');
      await page.evaluate(`
        nodes.set('paged',{id:'paged',anchorSeq:0});
        document.querySelector('[data-slot]').insertAdjacentHTML('afterbegin','<div id="paged" data-chat-flow-key="paged" data-chat-node-key="paged" data-chat-turn="1">Older page</div>');
        tick();
      `);
      assert.equal(await visible('paged'), false, 'older pages obey the persisted boundary');
      await page.evaluate('window.boundary={seq:15,turn:2,lastTurn:2};for(const fn of listeners)fn();tick()');
      assert.equal(await visible('fresh'), false, 'second clear hides the next segment');
      await page.evaluate('document.querySelector("main").setAttribute("data-conversation-session","b");for(const fn of listeners)fn();tick()');
      assert.equal(await visible('old'), true, 'a different session is not filtered');
      assert.equal(await page.evaluate('document.querySelector("[data-ccd-clear-notice]") === null'), true);
      await page.evaluate('window.dispose()');
      assert.equal(await page.evaluate('listeners.size'), 0);
      assert.equal(await page.evaluate('document.querySelector("[data-ccd-clear-hidden]") === null'), true);
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
});
