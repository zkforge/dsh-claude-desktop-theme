import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, PINNED_BUILD } from '../src/client/compat/host-builds.ts';

/*
 * The hero row's two chips, laid out by a real engine.
 *
 * The row is the workspace picker's chip beside the agent-preset ("mode") chip.
 * The picker's label is a directory name of any length, the mode's is host
 * preset copy of any length, and the reference draws the two as one family: the
 * same length, the mode's label whole, the picker's cut with an ellipsis. The
 * chip width is therefore measured off the preset seat itself
 * (`compat/hero-chips.ts`) and the stylesheet derives the row and the tool row's
 * reserve from it, so what this test reads is the two things a stylesheet alone
 * cannot state: that the picker's box ends where the mode's does, and that the
 * reserve follows the row rather than a band of the viewport.
 *
 * The fixture is the host's own tree for the region under the host's own
 * declarations — ConversationRoot's Composer stack and hero row, HeroShell's
 * picker chip, the preset seat's `Menu` anchor around its button, and InputBar's
 * card with its control row and permission seat — so the geometry read here is
 * this plugin's override winning over the real rules rather than over nothing.
 */

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Same optional browser coverage as the other sheets. */ }

/**
 * The host's own declarations for the modules this row is made of. Each line is
 * the shipped rule, minus the declarations this region does not exercise.
 */
const hostCss = `
:root{--dsw-alias-bg-base:#fcfcfb;--dsw-alias-label-primary:#1f1f1d;--dsw-alias-label-secondary:#6f6f6a;
  --dsw-alias-label-tertiary:#8f8f8a;--dsw-alias-label-caption:#9a9a95;--dsw-alias-label-quaternary:#b3b3ae;
  --dsw-alias-interactive-bg-hover:#eceff4;--dsw-alias-fill-tsp-secondary:#0000000a;--dsw-radius-sm:6px;
  --dsw-radius-xs:4px;--dsw-font-family:system-ui}
*{box-sizing:border-box}
body{margin:0;background:#fbfbfa;font:13px/1.4 system-ui}
/* ConversationRoot.module.css — the body carries the Composer's own width and
   side clearance (so the row's absolute anchor and the card are one line), the
   seat is the row's containing block, and the stack holds both. */
.ST7X_W_body{--dsh-chat-content-width:770px;--dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);
  --dsh-composer-side-clearance:16px;flex-direction:column;flex:1;min-height:0;display:flex;position:relative}
.ST7X_W_composerSeat{position:relative;flex-direction:column;flex:none;display:flex}
.ST7X_W_composerStack{gap:6px;flex-direction:column;display:flex}
.ST7X_W_heroWorkspaceRow{align-items:center;gap:2px;min-width:0;margin-top:4px;padding:0 16px 0 20px;display:flex}
/* HeroShell.module.css — the workspace chip. */
.bocITq_workspace{border-radius:var(--dsw-radius-sm);max-width:min(100%,360px);min-height:28px;color:var(--dsw-alias-label-primary);
  cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;padding:0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}
.bocITq_folder{color:var(--dsw-alias-label-primary);flex:none}
.bocITq_workspaceLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.bocITq_chevron{color:var(--dsw-alias-label-caption);flex:none}
/* ui-primitives Menu.module.css — the wrapper the preset seat is drawn in. */
.fixtureMenuRoot{position:relative;display:inline-flex}
/* AgentPresetSeat.module.css — the seat's own anchor box and the button in it. */
.fixtureSeatAnchor{min-width:54px;max-width:100%}
.fixtureSeat{border-radius:var(--dsw-radius-sm);min-width:0;max-width:min(100%,240px);min-height:28px;color:var(--dsw-alias-label-primary);
  white-space:nowrap;cursor:pointer;background:0 0;border:none;align-items:center;gap:4px;padding:0 8px;font-size:13px;font-weight:500;line-height:20px;display:inline-flex}
.fixtureSeatIcon{color:var(--dsw-alias-label-primary);flex:none}
.fixtureSeatLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.fixtureSeatChevron{color:var(--dsw-alias-label-caption);flex:none}
/* InputBar.module.css — the Composer card the row is laid over. */
.yhfFVG_root{padding:0 var(--dsh-composer-side-clearance) 4px;flex-direction:column;align-items:center;display:flex}
.yhfFVG_card{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width);flex-direction:column;gap:12px;padding-top:8px;display:flex;position:relative}
.yhfFVG_scroll{max-height:336px;margin-right:4px;overflow-y:auto}
.yhfFVG_input{box-sizing:border-box;min-height:36px;white-space:pre-wrap;padding:4px 8px 0 14px}
.yhfFVG_row{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;min-width:0;padding:2px 8px 6px;display:flex;container-type:inline-size}
.yhfFVG_tools,.yhfFVG_modes{align-items:center;min-width:0;display:flex;gap:12px}
/* PermissionSelect.module.css — the seat the reserve has to land clear of. */
.wXeviG_trigger{height:28px;align-items:center;gap:4px;padding:0 8px;font-size:13px;line-height:20px;display:flex}
.wXeviG_triggerIcon,.wXeviG_chevron{flex:none}
/* The renderer seats every slot entry in a display: contents outlet. */
[data-slot]{display:contents}
`;

/** The plugin's own sheets, mounted in the order `theme/mount.ts` mounts them. */
const styles = (await Promise.all([
  'src/client/theme/tokens.css',
  'src/client/theme/composer.css',
].map(path => readFile(join(root, path), 'utf8')))).join('\n');

/** The host's own chevron, whose artwork is what the sheet hides. */
const CHEVRON = '<svg class="FOLDERCHEVRON" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor">'
  + '<path d="M4 6L7.29289 2.70711L10.5858 6L7.29289 9.29289L4 6Z"/></svg>';

/** The host's own tree for the row and the control row it is laid over. */
function page({ workspace = 'dsh-claude-desktop-theme', preset = '标准模式' } = {}) {
  return `<div class="ST7X_W_body"><div class="ST7X_W_composerSeat" data-composer-seat><div class="ST7X_W_composerStack ST7X_W_composerHero">
<div class="ST7X_W_heroWorkspaceRow">
<button type="button" class="bocITq_workspace" aria-haspopup="menu" aria-expanded="false">
<svg class="bocITq_folder" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"><path d="M1.50439 3.11059H13.4958"/></svg>
<span class="bocITq_workspaceLabel">${workspace}</span>
${CHEVRON.replace('FOLDERCHEVRON', 'bocITq_chevron')}
</button>
<div data-slot="conversation.hero.workspace"></div>
<div data-slot="conversation.hero.agentPreset">
<span class="fixtureMenuRoot fixtureSeatAnchor">
<button type="button" class="fixtureSeat" aria-haspopup="menu" aria-expanded="false" title="切换模式">
<svg class="fixtureSeatIcon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"><path d="M2 8h12"/></svg>
<span class="fixtureSeatLabel">${preset}</span>
${CHEVRON.replace('FOLDERCHEVRON', 'fixtureSeatChevron')}
</button>
</span>
</div>
</div>
<div class="yhfFVG_root" data-composer-root>
<div class="yhfFVG_card" data-composer-card>
<div class="yhfFVG_scroll"><div class="yhfFVG_input">发消息或创建任务</div></div>
<div class="yhfFVG_row"><div class="yhfFVG_tools"><div class="yhfFVG_modes">
<div data-slot="conversation.input.permission">
<button class="wXeviG_trigger" aria-haspopup="menu" aria-expanded="false">
<svg class="wXeviG_triggerIcon" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor"><path d="M2 7h10"/></svg>
<span class="wXeviG_triggerLabel">完全权限</span>
${CHEVRON.replace('FOLDERCHEVRON', 'wXeviG_chevron')}
</button>
</div>
</div></div></div>
</div>
</div>
</div></div></div>`;
}

/** Everything the assertions read, in the page's own coordinates. */
const geometry = `(() => {
  const box = selector => {
    const node = document.querySelector(selector);
    if (node === null) return null;
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
  };
  const cut = selector => {
    const node = document.querySelector(selector);
    return node === null ? null : node.scrollWidth - node.clientWidth;
  };
  const row = box('.ST7X_W_heroWorkspaceRow');
  const stack = document.querySelector('.ST7X_W_composerStack');
  return {
    row, stack,
    rowGap: parseFloat(getComputedStyle(document.querySelector('.ST7X_W_heroWorkspaceRow')).columnGap),
    chip: getComputedStyle(stack).getPropertyValue('--ccd-workspace-seat').trim(),
    seat: getComputedStyle(stack).getPropertyValue('--ccd-workspace-seat').trim(),
    workspaceLabel: box('.bocITq_workspaceLabel'),
    presetIcon: box('.fixtureSeatIcon'),
    presetLabel: box('.fixtureSeatLabel'),
    permissionLabel: box('.wXeviG_triggerLabel'),
    picker: box('.bocITq_workspace'),
    preset: box('.fixtureSeat'),
    anchor: box('.fixtureSeatAnchor'),
    permission: box('.wXeviG_trigger'),
    reserve: parseFloat(getComputedStyle(document.querySelector('.yhfFVG_tools')).paddingLeft),
    pickerCut: cut('.bocITq_workspaceLabel'),
    presetCut: cut('.fixtureSeatLabel'),
    folderMark: getComputedStyle(document.querySelector('.bocITq_folder')).display,
    chevrons: ['.bocITq_chevron', '.fixtureSeatChevron'].map(selector => getComputedStyle(document.querySelector(selector)).display),
  };
})()`;

/** Lay one state out with the host's tree and the plugin's stylesheets. */
const lay = (devtools, state) => devtools.evaluate(`(() => {
  document.documentElement.lang = 'zh';
  document.documentElement.dataset.dshCcdStyle = 'true';
  document.body.innerHTML = '<div id="col" style="width:1000px;height:100vh"></div>';
  document.getElementById('col').innerHTML = ${JSON.stringify(aliasHostClasses(page(state), PINNED_BUILD))};
  const host = document.createElement('style');
  host.textContent = ${JSON.stringify(aliasHostClasses(hostCss, PINNED_BUILD))};
  const sheet = document.createElement('style');
  sheet.textContent = ${JSON.stringify(aliasHostClasses(styles, PINNED_BUILD))};
  document.head.append(host, sheet);
})()`);

test('hero controls keep natural widths and a distinct permission gap', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 20000,
}, async () => {
  const bundle = await build({
    stdin: {
      resolveDir: root, loader: 'ts', contents: `
        import {mountHeroChips} from './src/client/compat/hero-chips.ts';
        window.mountChips = () => window.release = mountHeroChips(document, error => { throw error; });
        window.remeasure = () => document.querySelector('.fixtureSeatLabel').replaceChildren('代码审查模式');
      `,
    }, bundle: true, write: false, format: 'iife',
  });
  const profile = await mkdtemp(join(tmpdir(), 'ccd-hero-chips-test-'));
  try {
    await withPage({ url: 'about:blank', width: 1400, height: 800, scale: 1, profile }, async devtools => {
      await lay(devtools, {});
      /* Before any reading lands the sheet's own fallback holds the row: the
         mode label is whole even then, which is the state a build this plugin
         cannot observe must not lose. */
      const authored = await devtools.evaluate(geometry);
      assert.equal(authored.seat, '280px', 'the fallback reserves the row before measurement');
      assert.ok(authored.presetCut <= 0, `the mode label is whole before the first reading (${authored.presetCut}px)`);
      await devtools.evaluate(bundle.outputFiles[0].text);
      await devtools.evaluate('window.mountChips()');
      const pause = () => devtools.evaluate('new Promise(resolve => setTimeout(resolve, 40))');
      await pause();
      const view = await devtools.evaluate(geometry);

      /* The picker's chip is the preset seat's length — the whole point of the
         measurement, and the one reading a stylesheet cannot state. */
      assert.ok(view.picker.width > view.anchor.width,
        `the long workspace can use more width than the mode (${view.picker.width} vs ${view.anchor.width})`);
      assert.equal(view.seat, `${Math.round(view.row.width)}px`, 'the full row width is published');
      /* The mode's label is the reading this row exists to show: whole. */
      assert.ok(view.presetCut <= 0, `the mode label is not cut (${view.presetCut}px of overflow)`);
      /* The picker's is the one that gives way, with the host's own ellipsis. */
      assert.equal(view.pickerCut, 0, 'the project name fits without premature truncation');
      /* Two chips and a gap, and the tool row's reserve is exactly that. */
      assert.equal(Math.round(view.row.width * 100) / 100, Math.round((view.picker.width + view.anchor.width + view.rowGap) * 100) / 100,
        `the row is the content widths plus a gap (${view.row.width})`);
      assert.equal(Math.round(view.reserve), Math.round(view.row.width + view.rowGap),
        `the reserve follows the row (${view.reserve} vs ${view.row.width + view.rowGap})`);
      /* One cluster gap between the mode chip and the permission chip beside it,
         which is the rhythm the rest of the status bar keeps. */
      assert.ok(Math.abs((view.permission.left - view.row.right) - view.rowGap - 6) < 1,
        `the permission chip starts one gap after the row (${view.permission.left - view.row.right} vs ${view.rowGap})`);
      const firstGap = view.presetIcon.left - view.workspaceLabel.right;
      const secondGap = view.permissionLabel.left - view.presetLabel.right;
      assert.ok(Math.abs(firstGap - 14) < 1, `workspace to mode content gap: ${firstGap}px`);
      assert.ok(Math.abs(secondGap - 20) < 1,
        `permission has a larger visible gap: ${firstGap}px / ${secondGap}px`);
      /* The row's marks are still the ones the reference draws: one folder, no
         chevron on either chip. */
      assert.equal(view.folderMark, 'none', 'the host folder svg is out of the line');
      assert.deepEqual(view.chevrons, ['none', 'none'], 'neither chip keeps its disclosure mark');

      /* A longer preset name takes both chips with it: the width is measured,
         not authored, and the mode's label is still whole. */
      await devtools.evaluate('window.remeasure()');
      await pause();
      const renamed = await devtools.evaluate(geometry);
      assert.ok(renamed.anchor.width > view.anchor.width,
        `a longer preset name widens the seat (${renamed.anchor.width} vs ${view.anchor.width})`);
      assert.equal(Math.round(renamed.picker.width), Math.round(view.picker.width),
        `the picker keeps its own content width (${renamed.picker.width} vs ${renamed.anchor.width})`);
      assert.ok(renamed.presetCut <= 0, `the renamed mode label is still whole (${renamed.presetCut}px)`);
      assert.equal(Math.round(renamed.reserve), Math.round(renamed.row.width + renamed.rowGap), 'the reserve follows it again');
      await devtools.evaluate("document.querySelector('.bocITq_workspaceLabel').textContent = 'a-very-long-workspace-name-that-needs-to-be-truncated-in-the-toolbar'");
      await pause();
      const longName = await devtools.evaluate(geometry);
      assert.ok(longName.pickerCut > 0, 'an oversized project name still truncates');
      assert.equal(Math.round(longName.reserve), Math.round(longName.row.width + longName.rowGap));

    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});

test('a short directory name uses only its own content width', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 20000,
}, async () => {
  const bundle = await build({
    stdin: {
      resolveDir: root, loader: 'ts', contents: `
        import {mountHeroChips} from './src/client/compat/hero-chips.ts';
        window.mountChips = () => window.release = mountHeroChips(document, error => { throw error; });
      `,
    }, bundle: true, write: false, format: 'iife',
  });
  const profile = await mkdtemp(join(tmpdir(), 'ccd-hero-chips-short-'));
  try {
    await withPage({ url: 'about:blank', width: 1400, height: 800, scale: 1, profile }, async devtools => {
      await lay(devtools, { workspace: 'app' });
      await devtools.evaluate(bundle.outputFiles[0].text);
      await devtools.evaluate('window.mountChips()');
      await devtools.evaluate('new Promise(resolve => setTimeout(resolve, 40))');
      const view = await devtools.evaluate(geometry);
      /* One length is the family's rule, not a cap: a short name does not make
         the picker's chip shorter than the mode chip beside it. */
      assert.ok(view.picker.width < view.anchor.width,
        `a short workspace uses only its content width (${view.picker.width} vs ${view.anchor.width})`);
      assert.equal(view.pickerCut, 0, 'a name that fits is not cut');
      assert.equal(Math.round(view.reserve), Math.round(view.row.width + view.rowGap), 'the reserve still follows the row');
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});
