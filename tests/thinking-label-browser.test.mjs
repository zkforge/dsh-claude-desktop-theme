import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Optional local Chrome. */ }

// Native titles use the secondary (13px) size. The plugin normalizes the base
// title to 14px; a second copy can retain 13px and drift even with equal clocks.
// Keep the native animation and pseudo-text so that regression is represented.
const hostCss = `
  .host_row{display:flex;position:relative;overflow:hidden;align-items:center}
  .host_title{flex:none;color:inherit;font-size:13px;line-height:24px}
  .host_shimmer{position:relative;display:inline-grid;width:max-content;max-width:100%;min-width:0}
  .host_content{display:flex;align-items:center;min-width:0}
  .host_text[data-shimmer-text]::after{content:attr(data-shimmer-text)}
  .host_decoration{position:absolute;inset:0;overflow:clip;pointer-events:none}
  .host_sweep{position:absolute;inset:0;overflow:hidden;mask-image:linear-gradient(105deg,transparent,black 40% 60%,transparent);animation:host-sweep 1.5s .3s steps(48,end) infinite}
  .host_sweep *{color:inherit!important}
  .host_highlight{width:100%;height:100%;animation:host-highlight 1.5s .3s steps(48,end) infinite}
  @keyframes host-sweep{from{transform:translateX(-100%)}66.6667%,to{transform:translateX(100%)}}
  @keyframes host-highlight{from{transform:translateX(100%)}66.6667%,to{transform:translateX(-100%)}}
`;
const thinking = (id, legacy) => `<section id="${id}" data-variant="think" data-state="running">
  <div data-disclosure-header><div class="host_row" data-disclosure-row role="button" tabindex="0" aria-expanded="false">
    <span aria-hidden="true">icon</span><span class="host_shimmer" data-shimmer>
      <span class="host_content"><span class="host_title host_text">思考</span><span ${legacy ? 'data-shimmer-decoration' : ''}> · </span><span class="preview">Private reasoning preview</span></span>
      <span class="host_decoration" aria-hidden="true"><span class="host_sweep"><span class="host_content host_highlight">
        <span class="host_title host_text" data-shimmer-text="思考"></span><span ${legacy ? 'data-shimmer-decoration' : ''}> · </span><span class="preview host_text" data-shimmer-text="Private reasoning preview"></span>
      </span></span></span>
    </span>
  </div></div><div class="body" hidden><div data-markdown-variant="compact">Full reasoning after expanding</div></div>
</section>`;

test('Thinking paints one stationary title throughout its sweep and keeps the native duplicate hidden', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 60000,
}, async () => {
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/features/tool-calls/tool-calls.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import {mountToolCallLabels} from './src/client/compat/tool-call-labels.ts';
    window.errors=[];window.release=mountToolCallLabels(document,e=>window.errors.push(String(e)));
  ` }, bundle: true, write: false, format: 'iife' });
  const profile = await mkdtemp(join(tmpdir(), 'ccd-thinking-label-'));
  try {
    await withPage({ url: 'about:blank', width: 800, height: 500, profile }, async page => {
      await page.evaluate(`document.documentElement.setAttribute('data-dsh-ccd-style','true');
        document.body.innerHTML=${JSON.stringify(thinking('current', false) + thinking('legacy', true))};
        const style=document.createElement('style');style.textContent=${JSON.stringify(hostCss + styles)};document.head.append(style);
        for(const row of document.querySelectorAll('[data-disclosure-row]'))row.addEventListener('click',()=>{
          const open=row.getAttribute('aria-expanded')!=='true';row.setAttribute('aria-expanded',String(open));
          row.closest('section').querySelector('.body').hidden=!open;
        });`);
      await page.evaluate(bundle.outputFiles[0].text);
      const positions = new Map();
      for (const dark of [false, true]) {
        await page.evaluate(`document.body.toggleAttribute('data-ds-dark-theme',${dark})`);
        for (const time of [0, 300, 960, 1700, 2150, 2399]) {
          const facts = await page.evaluate(`(()=>{
            for(const a of document.getAnimations()){a.pause();a.currentTime=${time};}
            return [...document.querySelectorAll('section')].map(section=>{
              const labels=[...section.querySelectorAll('[data-ccd-english-label]')];
              const base=labels[0].getBoundingClientRect();
              const content=section.querySelector('.host_content');
              return {id:section.id,labels:labels.map(e=>e.textContent),x:base.x,width:base.width,
                visibleTitles:labels.filter(e=>e.getClientRects().length>0).length,
                duplicate:getComputedStyle(section.querySelector('.host_decoration')).display,
                shine:getComputedStyle(content).animationName,fill:getComputedStyle(labels[0]).webkitTextFillColor,
                previews:[...section.querySelectorAll('.preview')].map(e=>getComputedStyle(e).display),
                rowWidth:section.querySelector('[data-disclosure-row]').getBoundingClientRect().width,
                body:getComputedStyle(section.querySelector('.body')).display};
            });})()`);
          for (const fact of facts) {
            assert.deepEqual(fact.labels, ['Thinking', 'Thinking']);
            assert.equal(fact.visibleTitles, 1, `only one title paints at ${time}ms`);
            assert.equal(fact.duplicate, 'none');
            assert.equal(fact.shine, 'ccd-tool-text-shine');
            assert.equal(fact.fill, 'rgba(0, 0, 0, 0)');
            const key = `${dark}:${fact.id}`;
            if (!positions.has(key)) positions.set(key, { x: fact.x, width: fact.width });
            assert.deepEqual({ x: fact.x, width: fact.width }, positions.get(key), 'the glyphs never move during the sweep');
            assert.deepEqual(fact.previews, ['none', 'none']);
            assert.ok(fact.rowWidth < 150, 'reasoning preview does not widen the collapsed title');
            assert.equal(fact.body, 'none');
          }
        }
      }
      await page.evaluate(`document.querySelector('#current [data-disclosure-row]').click()`);
      assert.notEqual(await page.evaluate(`getComputedStyle(document.querySelector('#current .body')).display`), 'none');
      await page.evaluate(`document.querySelector('#current').setAttribute('data-state','ok')`);
      assert.deepEqual(await page.evaluate(`new Promise(r=>queueMicrotask(()=>r([...document.querySelectorAll('#current [data-ccd-english-label]')].map(e=>e.textContent))))`), ['Thought', 'Thought']);
      await page.evaluate(`document.querySelector('#current .host_shimmer').removeAttribute('data-shimmer');document.querySelector('#current .host_decoration').remove()`);
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('#current .host_content')).animationName`), 'none');
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('#legacy .host_decoration')).display`), 'none');
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('#legacy .host_content')).animationName`), 'none');
      assert.notEqual(await page.evaluate(`getComputedStyle(document.querySelector('#legacy [data-ccd-english-label]')).webkitTextFillColor`), 'rgba(0, 0, 0, 0)');
      await page.evaluate('window.release()');
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-english-label]').length`), 0);
      assert.deepEqual(await page.evaluate('window.errors'), []);
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
