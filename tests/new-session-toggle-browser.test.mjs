import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, PINNED_BUILD } from '../src/client/compat/host-builds.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Optional locally, installed in CI. */ }
const sheets = await Promise.all([
  'src/client/theme/tokens.css', 'src/client/theme/composer.css',
  'src/client/features/statistics/statistics.css', 'src/client/features/new-session/new-session.css',
].map(path => readFile(join(root, path), 'utf8')));

// Relevant native layout: the composer seat is static inside a centred,
// scrollable body. The theme must anchor its workspace row in both modes.
const host = `
body{margin:0} .ST7X_W_root{height:800px;display:flex;flex-direction:column}
.ST7X_W_body{position:relative;display:flex;flex-direction:column;flex:1;min-height:0;
  --dsh-composer-card-max-width:770px;--dsh-composer-side-clearance:16px}
.ST7X_W_scrollBody{display:flex;flex-direction:column;flex:1;min-height:0;justify-content:center;overflow-y:auto}
.ST7X_W_composerSeat{display:flex;flex-direction:column;flex:none}
.ST7X_W_composerStack{display:flex;flex-direction:column}
.ST7X_W_composerHero{width:min(802px,100%);align-self:center;gap:8px;padding-bottom:32px}
.bocITq_root{padding:24px 16px;text-align:center}
.yhfFVG_card{height:70px}
`;
const html = `<div class="ST7X_W_root" data-phase="hero"><div class="ST7X_W_body">
<div class="ST7X_W_scrollBody"><div class="ST7X_W_composerSeat"><div class="ST7X_W_composerStack ST7X_W_composerHero">
<div class="bocITq_root"><div class="bocITq_headline">Native greeting</div></div>
<div class="ST7X_W_heroWorkspaceRow">workspace</div>
<div class="yhfFVG_root yhfFVG_hero"><div class="yhfFVG_card">Input</div><div class="yhfFVG_row">Controls</div></div>
</div></div></div></div></div>`;

test('new-session toggles retain one statistics card and keep native controls beside the input', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 20000,
}, async () => {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'ts', contents: `
      import { mountStatisticsCard } from './src/client/features/statistics/mount.ts';
      import { CleanupScope } from './src/client/core/cleanup.ts';
      const totals = {sessions:1,messages:1,tokens:10,activeDays:1,topModel:null,models:[]};
      const source = {current:{version:2,ranges:{all:totals,'30d':totals,'7d':totals},
        busyHour:null,days:[],modelDays:[],modelIO:[],pending:0,missed:0,computedAt:1},
        subscribe:()=>()=>{},dispose:()=>{}};
      let scope;
      window.remount = () => {
        scope?.dispose();
        scope = new CleanupScope();
        mountStatisticsCard(document, scope, {error: error => {throw error}}, source);
      };
    ` }, bundle: true, write: false, format: 'iife',
  });
  const profile = await mkdtemp(join(tmpdir(), 'ccd-new-session-toggle-'));
  try {
    await withPage({ url: 'about:blank', width: 1400, height: 800, profile }, async devtools => {
      await devtools.evaluate(`(() => {
        document.documentElement.setAttribute('data-dsh-ccd-style','true');
        document.body.innerHTML = ${JSON.stringify(html)};
        const base = document.createElement('style');
        base.textContent = ${JSON.stringify(aliasHostClasses(host + sheets.slice(0, 3).join('\n'), PINNED_BUILD))};
        const layout = document.createElement('style'); layout.id = 'new-session-layout';
        layout.textContent = ${JSON.stringify(aliasHostClasses(sheets[3], PINNED_BUILD))};
        document.head.append(base, layout);
      })()`);
      await devtools.evaluate(bundle.outputFiles[0].text);
      for (const enabled of [true, false, true, false]) {
        await devtools.evaluate(`document.querySelector('#new-session-layout').sheet.disabled = ${!enabled}; window.remount()`);
        const result = await devtools.evaluate(`(() => {
          const card = document.querySelector('[data-ccd-stats-card]');
          const box = selector => {const r = document.querySelector(selector).getBoundingClientRect();
            return {top:r.top,bottom:r.bottom,left:r.left};};
          return {count:document.querySelectorAll('[data-ccd-stats-card]').length,
            position:getComputedStyle(card).position, greeting:box('.bocITq_root'),
            stats:box('[data-ccd-stats-card]'), input:box('.yhfFVG_card'), row:box('.ST7X_W_heroWorkspaceRow')};
        })()`);
        assert.equal(result.count, 1);
        assert.equal(result.position, enabled ? 'absolute' : 'static');
        assert.ok(result.stats.top >= result.greeting.bottom, 'statistics follow greeting');
        assert.ok(result.input.top >= result.stats.bottom, 'statistics do not cover input');
        assert.ok(result.row.top >= result.input.bottom, 'workspace stays below input');
        assert.ok(result.row.top - result.input.bottom < 50, 'workspace stays with composer');
      }
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
