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
try { chrome = findChrome(); } catch { /* Browser coverage requires a local Chrome. */ }

/*
 * The panel's two states, in a real renderer.
 *
 * Source assertions cannot establish that a top-layer popover paints over the
 * host's own `z-index: 1100` portal, that a flex-weighted bar leaves the
 * reference's 1px and 4px gaps, or that a category under 2px is dropped — so
 * this drives the actual component with the reference's own session (89k of
 * 1M, MCP 48k, system tools 32.5k, system prompt 4.6k, skills 3.6k, memory
 * 342, autocompact buffer 33k) and measures what comes out.
 */

/** The reference's own reading, as the card's arithmetic takes it. */
const SOURCE = `{
  window: 1000000, used: 89000, systemTokens: 4600, toolsTokens: 80480,
  tools: [['mcp__ccd__read', 48000], ['bash', 32480]],
  messageTokens: 3942, skillTokens: 3600, fileTokens: 342,
  /* 1,000,000 − 33,000, so the reserved row reads the reference's 3.3%. */
  compaction: 967000,
}`;

test('the context panel’s two states measure and dismiss like the reference', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage',
  timeout: 30000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {ContextPanel} from './src/client/features/context-panel/ContextPanel.tsx';
      import {contextBreakdown} from './src/shared/context.ts';
      let root, state;
      const listeners = new Set();
      const port = {
        getSnapshot: () => state,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        close: () => { state = {...state, open: false, expanded: false}; listeners.forEach(listener => listener()); },
        toggleExpanded: () => { state = {...state, expanded: !state.expanded}; listeners.forEach(listener => listener()); },
      };
      window.openPanel = (override) => {
        const anchor = document.getElementById('ring');
        state = {
          open: true, anchor, breakdown: contextBreakdown(override ?? ${SOURCE}),
          mcp: [['mcp__ccd__read', 48000]], tools: [['bash', 32480]],
          files: [['AGENTS.md', 342]], skills: [['grilling', 3600]], expanded: false,
        };
        if (root) listeners.forEach(listener => listener());
        else {
          root = createRoot(document.getElementById('overlay'));
          root.render(React.createElement(ContextPanel, {port}));
        }
      };
    ` },
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  /* The card carries `data-menu-material`, so the shared surface sheet is what
     fills it — the same one the model and view-options cards sit on. */
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/theme/menus.css',
    'src/client/features/context-panel/context-panel.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-context-panel-test-'));
  try {
    await withPage({ url: 'about:blank', width: 1000, height: 700, scale: 2, profile }, async page => {
      await page.evaluate(`document.documentElement.lang='en';document.documentElement.setAttribute('data-dsh-ccd-style','true');document.body.innerHTML='<button id="ring" aria-haspopup="dialog" aria-expanded="false" style="position:fixed;right:40px;bottom:40px;width:26px;height:20px">ring</button><div id="overlay"></div>';const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);`);
      await page.evaluate(bundle.outputFiles[0].text);
      const pause = () => page.evaluate('new Promise(resolve=>setTimeout(resolve,70))');
      const rect = selector => page.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}})()`);
      const open = async () => { await page.evaluate('window.openPanel()'); await pause(); };

      await open();
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-context-panel]')`), true);
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-context-panel]').matches(':popover-open')`), true,
        'the card is a top-layer popover, which is what paints over the host’s own portal');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-context-panel]').textContent`), 'Context window89k / 1M (9%)',
        'the header reads the ring’s own numbers');
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-context-row]')`), false, 'the reference opens collapsed');

      /* Geometry: the reference's card, at the reference's own measurements. */
      const panel = await rect('[data-ccd-context-panel]');
      const ring = await rect('#ring');
      const bar = await rect('[data-ccd-context-bar]');
      const head = await rect('[data-ccd-context-head]');
      const surface = await page.evaluate(`(()=>{const s=getComputedStyle(document.querySelector('[data-ccd-context-panel]'));return{radius:s.borderRadius,border:s.borderTopWidth}})()`);
      assert.equal(panel.width, 360);
      assert.equal(surface.radius, '12px');
      assert.equal(surface.border, '1px');
      assert.equal(bar.height, 4);
      assert.equal(Math.round(panel.right - ring.right), 0, 'the card’s right edge is the ring’s');
      assert.equal(Math.round(ring.top - panel.bottom), 8, 'the reference hangs it 8px above the ring');
      assert.equal(Math.round(head.top - panel.top), 9, '8px of padding plus the card’s own outline');
      assert.equal(Math.round(bar.left - panel.left), 13, '12px of padding plus the outline');
      assert.equal(Math.round(panel.right - bar.right), 13);

      /* The bar: weights rather than a percentage column, with the reference's
         own gaps — and the categories that round to nothing left out. */
      assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('[data-ccd-context-seg]'),n=>n.getAttribute('data-ccd-context-seg'))`),
        ['mcp', 'tools', 'autocompact'], 'the slivers under 2px are dropped, exactly as the reference drops them');
      const seg = await rect('[data-ccd-context-seg="mcp"]');
      const next = await rect('[data-ccd-context-seg="tools"]');
      const reserved = await rect('[data-ccd-context-seg="autocompact"]');
      assert.equal(Math.round(seg.left - bar.left), 0, 'the used group starts at the track’s own left edge');
      assert.equal(Math.round(next.left - seg.right), 1, 'used segments are 1px apart');
      assert.equal(Math.round(reserved.left - next.right), 4, 'the reserved grey steps 4px away');
      assert.equal(Math.round(seg.width), 16, '48k of 1M of a 334px bar');
      assert.equal(Math.round(reserved.width), 11, '33k of 1M');
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-ccd-context-seg="mcp"]')).backgroundColor`), 'rgb(42, 120, 216)');
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-ccd-context-bar]')).backgroundColor`), 'rgb(238, 238, 238)',
        'the track is the free-space colour');

      /* Expanding: the header line is the whole affordance. */
      await page.evaluate(`document.querySelector('[data-ccd-context-head]').click()`);
      await pause();
      assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('[data-ccd-context-row]'),n=>n.getAttribute('data-ccd-context-row'))`),
        ['mcp', 'tools', 'system', 'skills', 'memory', 'autocompact', 'free'],
        'the reference’s own order — its session had no conversation tokens yet, so that row is not drawn');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-context-row="free"]').textContent`), 'Free space878k87.8%');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-context-row="mcp"]').textContent`), 'MCP tools48k4.8%');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-context-head]').getAttribute('aria-expanded')`), 'true');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-context-head] .ccd-context-chevron').getAttribute('data-ccd-context-chevron')`), 'open');
      /* The mark turns rather than swapping glyphs, so the transition has to
         settle before the angle is readable. */
      await page.evaluate('new Promise(resolve=>setTimeout(resolve,220))');
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-ccd-context-head] .ccd-context-chevron')).transform`), 'matrix(0, 1, -1, 0, 0, 0)',
        'the disclosure mark turns to point down');
      const row = await rect('[data-ccd-context-row="mcp"]');
      const swatch = await rect('[data-ccd-context-row="mcp"] .ccd-context-swatch');
      assert.equal(row.height, 19);
      assert.equal(swatch.width, 10);
      assert.equal(swatch.height, 10);
      /* The percentage column ends at the content edge, which is what puts the
         token column 48px in from it. */
      const tokens = await page.evaluate(`(()=>{const r=document.querySelector('[data-ccd-context-row="mcp"] .ccd-context-tokens').getBoundingClientRect();const p=document.querySelector('[data-ccd-context-row="mcp"] .ccd-context-percent').getBoundingClientRect();return{tokens:r.right,percent:p.right}})()`);
      assert.equal(Math.round(panel.right - 13 - tokens.percent), 0, 'the percentage column is flush with the content edge');
      assert.equal(Math.round(panel.right - 13 - tokens.tokens), 48, 'the token column ends 48px in');

      /* The drill-down groups: only the categories that have rows. */
      assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('[data-ccd-context-group] .ccd-context-group-head'),n=>n.textContent)`),
        ['MCP tools48k1', 'System tools32.5k1', 'Skills3.6k1', 'Memory files3421']);
      assert.equal(await page.evaluate(`document.querySelectorAll('.ccd-context-detail-row').length`), 0,
        'every drill-down starts collapsed');
      assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('.ccd-context-group-head')).every(n=>n.getAttribute('aria-expanded')==='false')`), true);
      await page.evaluate(`document.querySelectorAll('.ccd-context-group-head').forEach(n=>n.click())`);
      await pause();
      assert.equal(await page.evaluate(`document.querySelector('.ccd-context-detail .ccd-context-label').textContent`), 'ccd · read',
        'an MCP tool is named by its server and its own name');
      assert.equal(await page.evaluate(`document.querySelectorAll('.ccd-context-detail-row').length`), 4);
      const detail = await rect('.ccd-context-detail-row');
      assert.equal(detail.height, 17, 'detail rows are one step tighter than the value rows');
      const head2 = await rect('.ccd-context-group-head');
      assert.equal(head2.height, 19);

      await page.evaluate(`document.querySelector('.ccd-context-group-head').click()`);
      await pause();
      assert.equal(await page.evaluate(`document.querySelectorAll('.ccd-context-detail-row').length`), 3,
        'a group head folds its own rows away');
      assert.equal(await page.evaluate(`document.querySelector('.ccd-context-group-head').getAttribute('aria-expanded')`), 'false');

      /* Dismissal: Escape puts the panel away and hands focus back to the ring. */
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape' });
      await pause();
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-context-panel]')`), false);
      assert.equal(await page.evaluate(`document.activeElement.id`), 'ring');

      await open();
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-context-head]').getAttribute('aria-expanded')`), 'false',
        'reopening the same mounted component resets the header');
      await page.evaluate(`document.querySelector('[data-ccd-context-head]').click()`);
      await pause();
      assert.equal(await page.evaluate(`document.querySelectorAll('.ccd-context-detail-row').length`), 0,
        'reopening the same mounted component resets every group');
      assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('.ccd-context-group-head')).every(n=>n.getAttribute('aria-expanded')==='false')`), true);
      const point = await page.evaluate(`(()=>{const r=document.getElementById('ring').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 });
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 });
      await pause();
      assert.equal(await page.evaluate(`!!document.querySelector('[data-ccd-context-panel]')`), false, 'a pointer outside puts it away');
      assert.ok(point.y > 0);

      /* A session that has been talking: the conversation row is drawn, priced
         and ordered between the memory files and the reserved buffer. */
      await page.evaluate(`window.openPanel({window:1000000, used:216700, systemTokens:1953, toolsTokens:7921,
        tools:[['bash',561]], messageTokens:130000, skillTokens:2204, fileTokens:1785, compaction:null})`);
      await pause();
      await page.evaluate(`document.querySelector('[data-ccd-context-head]').click()`);
      await pause();
      assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('[data-ccd-context-row]'),n=>n.getAttribute('data-ccd-context-row'))`),
        ['tools', 'system', 'skills', 'memory', 'messages', 'free'],
        'the conversation row sits under the memory files and no reserved row is drawn without a policy');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-context-row="residual"]') === null`), true,
        'the popup omits estimate drift even when the sampled and heuristic readings differ');
      assert.equal(await page.evaluate(`Array.from(document.querySelectorAll('[data-ccd-context-seg]'),n=>n.getAttribute('data-ccd-context-seg')).includes('messages')`), true,
        'the conversation is a real segment');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-context-row="messages"]').textContent`),
        'Messages126k12.6%', 'the conversation is the host’s own surface minus the two re-derived shares');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-context-figures]').textContent`), '216.7k / 1M (22%)',
        'the header stays the ring’s own reading however the rows divide it');

      /* Dark theme: the same seven categories, retinted for the card. */
      await page.evaluate(`window.openPanel()`);
      await pause();
      await page.evaluate(`document.body.setAttribute('data-ds-dark-theme','')`);
      await open();
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-ccd-context-panel]')).backgroundColor`), 'rgb(48, 48, 46)');
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-ccd-context-seg="mcp"]')).backgroundColor`), 'rgb(91, 154, 232)');
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-ccd-context-bar]')).backgroundColor`), 'rgb(63, 63, 59)');
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
