import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, MACOS_BUILD, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Optional local Chrome. */ }
const reply = (id, live = '') => `<div data-chat-flow-kind="assistant-step"><div class="gKv1-q_root" ${live}>
  <div id="${id}" class="_markdown_1ypvv_5"><p>Hello</p><pre><code>code</code></pre><div data-code-wrap><div class="code">native code rows</div></div><a href="#">link</a></div>
</div></div>`;

test('streaming fades in only new native text, survives React swaps and fully cleans up', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 60000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import {mountConversationStream} from './src/client/compat/conversation-stream.ts';
    window.errors=[];window.release=mountConversationStream(document,e=>window.errors.push(String(e)));
  ` }, bundle: true, write: false, format: 'iife' });
  for (const host of [MACOS_BUILD, WINDOWS_BUILD]) {
    const profile = await mkdtemp(join(tmpdir(), 'ccd-stream-'));
    try {
      await withPage({ url: 'about:blank', width: 800, height: 500, profile }, async page => {
        const html = `<main data-slot="root"><div class="${host.frameClass}">${reply('live', 'data-streaming')}${reply('history')}
          <div data-chat-flow-kind="assistant-step" data-variant="think" data-streaming><div class="gKv1-q_root"><div class="_markdown_1ypvv_5" data-markdown-variant="compact"><p id="thought">private</p></div></div></div>
        </div></main>`;
        await page.evaluate(`document.documentElement.setAttribute('data-dsh-ccd-style','true');
          document.body.innerHTML=${JSON.stringify(aliasHostClasses(html, host))};
          document.documentElement.style.setProperty('--ccd-accent','blue');
          document.documentElement.style.setProperty('--ccd-text','black');
          window.waitPaint=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          window.ranges=()=>[...CSS.highlights].filter(([key])=>key.startsWith('ccd-stream-')).map(([key,h])=>({key,text:[...h].map(r=>r.toString()).join('')}));
          window.foreign=new Highlight();CSS.highlights.set('foreign',window.foreign);
          window.p=document.querySelector('#live p');window.nativeText=p.firstChild;`);
        await page.evaluate(bundle.outputFiles[0].text);
        assert.deepEqual(await page.evaluate('ranges()'), [], 'mounting does not animate existing text');
        await page.evaluate(`p.firstChild.data+=' 世界';waitPaint()`);
        assert.deepEqual(await page.evaluate('window.errors'), []);
        assert.deepEqual((await page.evaluate('ranges()')).map(r => r.text), [' 世界']);
        const ink = await page.evaluate(`(()=>{const canvas=document.createElement('canvas');
          const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(p,'::highlight('+ranges()[0].key+')').color;
          ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];})()`);
        assert.deepEqual(ink.slice(0, 3), [0, 0, 0], 'new words retain the normal text hue, without the blue accent');
        assert.ok(ink[3] > 0 && ink[3] < 255, 'new words fade in through text opacity');
        assert.equal(await page.evaluate('p.firstChild===nativeText && p.childNodes.length===1'), true, 'no text wrapper or duplicate');
        await page.evaluate(`p.firstChild.data+=' again';waitPaint()`);
        assert.deepEqual((await page.evaluate('ranges()')).map(r => r.text), [' 世界', ' again'], 'nodeValue updates do not collapse older fade ranges');
        const beforeSwap = await page.evaluate('ranges().map(r=>r.key)');
        await page.evaluate(`p.textContent=p.textContent;waitPaint()`);
        assert.deepEqual(await page.evaluate('ranges().map(r=>r.key)'), beforeSwap, 'equal text replaced by React does not start another entrance');
        assert.deepEqual((await page.evaluate('ranges()')).map(r => r.text), [' 世界', ' again']);
        await page.evaluate(`p.insertAdjacentHTML('beforeend','<strong> 加粗</strong>');waitPaint()`);
        assert.equal((await page.evaluate('ranges()')).at(-1).text, ' 加粗');
        const count = await page.evaluate('ranges().length');
        await page.evaluate(`document.querySelector('#live code').textContent+=' more code';
          document.querySelector('#live .code').textContent+=' more native code';
          document.querySelector('#live a').textContent+=' more link';
          document.querySelector('#history p').firstChild.data+=' old reply';
          document.querySelector('#thought').firstChild.data+=' private thought';waitPaint()`);
        assert.equal(await page.evaluate('ranges().length'), count, 'code, links, history and compact reasoning are untouched');
        assert.equal(await page.evaluate('document.querySelectorAll("#live span").length'), 0);
        // The original cohort's age is preserved as later text arrives.
        await page.evaluate('new Promise(r=>setTimeout(r,760))');
        assert.deepEqual(await page.evaluate('ranges()'), []);
        await page.evaluate(`p.append(document.createTextNode(' tail'));waitPaint()`);
        assert.ok((await page.evaluate('ranges()')).length > 0);
        await page.evaluate(`p.textContent='Markdown reparsed';waitPaint()`);
        assert.deepEqual(await page.evaluate('ranges()'), [], 'a changed prefix invalidates old ranges without replay');
        await page.evaluate(`p.firstChild.data+=' next';waitPaint()`);
        assert.ok((await page.evaluate('ranges()')).length > 0);
        await page.evaluate(`document.querySelector('#live').parentElement.removeAttribute('data-streaming');waitPaint()`);
        assert.deepEqual(await page.evaluate('ranges()'), [], 'completion clears the effect');
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await page.evaluate(`document.querySelector('#live').parentElement.setAttribute('data-streaming','');p.firstChild.data+=' reduced';waitPaint()`);
        assert.deepEqual(await page.evaluate('ranges()'), []);
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        await page.evaluate('waitPaint()');
        assert.deepEqual(await page.evaluate('ranges()'), [], 'reenabling motion does not replay text');
        await page.evaluate(`p.firstChild.data+=' final';waitPaint()`);
        assert.ok((await page.evaluate('ranges()')).length > 0);
        await page.evaluate('window.release();waitPaint()');
        assert.deepEqual(await page.evaluate('ranges()'), []);
        assert.equal(await page.evaluate('CSS.highlights.get("foreign")===window.foreign'), true);
        assert.equal(await page.evaluate('document.querySelector("[data-ccd-stream-style]")===null'), true);
        assert.deepEqual(await page.evaluate('window.errors'), []);
      });
    } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  }
});
