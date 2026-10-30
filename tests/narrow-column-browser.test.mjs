import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, PINNED_BUILD, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';

/*
 * The Conversation column when it is narrow.
 *
 * An expanded right panel leaves the transcript column a few hundred pixels
 * wide, and four things the reference draws must survive it: the Composer's
 * status bar stays one line (its model name clips rather than wrapping the
 * trailing cluster onto a second row), the header's cluster ends on the input
 * surface's own right border, the three right-panel views this plugin adds stay
 * on the header's line, and the Session title stays beside them. Native View
 * tabs sit just before the utilities in the same row.
 *
 * The fixture is the host's own tree for the region — the frame's center
 * column, ConversationRoot's header with its title row / team chip / utilities
 * seat / corner, the Composer seat inside the page's scroll viewport (whose
 * stable gutter and 2px end margin are what the header's trailing edge is
 * measured against), InputBar's control row and the model seat — under the
 * host's own declarations for those boxes, so what is read here is this
 * plugin's override winning over the real rules rather than over nothing.
 *
 * Every assertion is made at a column width a user can actually leave behind:
 * dragging the right panel to 380px of centre column is the state the plugin's
 * own screenshots are taken in.
 */

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Same optional browser coverage as the other sheets. */ }

/**
 * The host's own declarations for the modules this region is made of: the
 * frame's center column (AppFrame), ConversationRoot's header and its body with
 * the page's scroll viewport, InputBar's card / control row / trailing groups,
 * and the two seats the row carries (ModelSelect, PermissionSelect, and the
 * session menu's HeaderAction). Each line is the shipped rule, minus the
 * declarations this region does not exercise.
 */
const hostCss = `
:root{--dsw-alias-bg-base:#fcfcfb;--dsw-alias-border-l3:#e3e3e1;--dsw-alias-border-l4:#e6e6e4;--dsw-alias-label-primary:#1f1f1d;
  --dsw-alias-label-secondary:#6f6f6a;--dsw-alias-label-tertiary:#8f8f8a;--dsw-alias-interactive-bg-hover:#eceff4;
  --dsw-radius-sm:6px;--dsw-radius-md:8px;--dsw-radius-panel:12px;--dsw-font-family:system-ui;
  --dsh-scrollbar-width:5px;--dsh-scrollbar-thumb:transparent}
*{box-sizing:border-box}
body{margin:0;background:#fbfbfa;font:13px/1.4 system-ui;--dsh-scrollbar-width:5px}
::-webkit-scrollbar{width:var(--dsh-scrollbar-width);height:var(--dsh-scrollbar-width)}
::-webkit-scrollbar-thumb{background:transparent}
/* ConversationRoot.module.css */
.ST7X_W_root{background:var(--dsw-alias-bg-base);flex-direction:column;min-width:0;height:100%;display:flex;position:relative}
.ST7X_W_root[data-phase=active]{overflow:hidden}
.ST7X_W_header{box-sizing:border-box;border-bottom:.5px solid var(--dsw-alias-border-l3);flex:none;
  grid-template-columns:auto minmax(0,1fr);min-height:76px;padding:10px 28px 0 20px;display:grid}
.ST7X_W_tabs{width:100%;display:flex;gap:32px;margin-top:10px;padding-left:8px}
.ST7X_W_headerBlank{border-bottom:none;min-height:0;padding-bottom:0}
.ST7X_W_titleRow{min-height:30px;grid-column:2;align-items:center;gap:0;display:flex;container-type:inline-size}
.ST7X_W_titleCluster{flex:1;align-items:center;gap:10px;min-width:0;display:flex}
.ST7X_W_crumbs{white-space:nowrap;align-items:center;gap:4px;min-width:0;display:flex;overflow:hidden}
.ST7X_W_headerActions{flex:none;align-items:center;gap:8px;display:flex}
.ST7X_W_headerUtilities{flex:none;align-items:center;gap:8px;margin-left:20px;display:flex}
.ST7X_W_headerUtilities:empty{display:none}
.ST7X_W_headerCorner{flex:none;align-items:center;margin-left:8px;margin-right:-16px;display:flex}
.ST7X_W_headerCorner:empty{display:none}
.ST7X_W_body{--dsh-chat-content-width:770px;--dsh-composer-card-max-width:calc(var(--dsh-chat-content-width) + 32px);
  --dsh-composer-side-clearance:16px;flex-direction:column;flex:1;min-height:0;display:flex;position:relative}
.ST7X_W_scrollBody{scrollbar-gutter:stable;flex-direction:column;flex:1;min-height:0;margin-right:2px;display:flex;overflow-y:auto}
.ST7X_W_composerSeat{flex-direction:column;flex:none;display:flex}
.ST7X_W_composerStack{gap:6px;flex-direction:column;display:flex}
/* InputBar.module.css */
.yhfFVG_root{padding:0 var(--dsh-composer-side-clearance) 4px;flex-direction:column;align-items:center;display:flex}
.yhfFVG_card{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width);flex-direction:column;gap:12px;padding-top:8px;display:flex;position:relative}
.yhfFVG_scroll{max-height:336px;margin-right:4px;overflow-y:auto}
.yhfFVG_input{box-sizing:border-box;min-height:36px;white-space:pre-wrap;padding:4px 8px 0 14px}
.yhfFVG_row{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px;min-width:0;padding:2px 8px 6px;display:flex;container-type:inline-size}
.yhfFVG_tools,.yhfFVG_modes,.yhfFVG_trailing{align-items:center;min-width:0;display:flex}
.yhfFVG_tools,.yhfFVG_modes{gap:12px}
.yhfFVG_tools,.yhfFVG_modes,.yhfFVG_trailing{gap:8px}
.yhfFVG_trailing{flex:none;margin-left:auto}
.yhfFVG_add{width:28px;height:28px;border:none;border-radius:999px;flex:none;place-items:center;display:grid}
/* ModelSelect.module.css */
.cl2Rlq_trigger{min-width:0;max-width:min(360px,45cqw);height:28px;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;line-height:20px;display:flex}
.cl2Rlq_triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}
.cl2Rlq_triggerEffort{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex-shrink:1000;overflow:hidden}
/* PermissionSelect.module.css */
.wXeviG_trigger{height:28px;align-items:center;gap:4px;padding:0 8px;font-size:13px;line-height:20px;display:flex}
/* AgentPresetSeat.module.css — the team chip's own box. */
._2tNPVa_trigger{align-items:center;gap:4px;padding:0 8px;height:28px;font-size:13px;display:flex}
/* ui-primitives Menu and Button: the menu wrapper is the slot's flex item,
   and the compact host button inside it has an independent 28px height. */
.fixtureMenu{position:relative;display:inline-flex}
.fixtureButton{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;border:0;background:transparent}
.fixtureSm{height:28px;font-size:12px;line-height:18px;padding:0 10px}
/* session-query's HeaderAction.module.css — the Session menu's ⋮. */
.Da3aKq_moreButton{width:28px;color:var(--dsw-alias-label-secondary);flex:none;padding:0}
/* The renderer seats every slot entry in a display: contents outlet. */
[data-slot]{display:contents}
`;

/** The plugin's own sheets, mounted in the order `theme/mount.ts` mounts them. */
const styles = (await Promise.all([
  'src/client/theme/tokens.css',
  'src/client/theme/composer.css',
  'src/client/features/conversation/conversation.css',
  'src/client/features/conversation/header-actions/header-actions.css',
].map(path => readFile(join(root, path), 'utf8')))).join('\n');

const GLYPH = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"><path d="M3 8h10"/></svg>';

/** One Conversation page: the header over the page's scroller and Composer. */
function page() {
  const tabs = '<div class="ST7X_W_tabs"><div class="ST7X_W_viewTabs" role="tablist">'
    + '<button class="ST7X_W_tab" role="tab" aria-selected="true"><span class="ST7X_W_tabLabel">对话</span></button>'
    + '<button class="ST7X_W_tab" role="tab" aria-selected="false"><span class="ST7X_W_tabLabel">轨迹</span></button></div><span class="ST7X_W_viewsMoreAnchor"><button aria-haspopup="menu" class="ST7X_W_viewsMore" aria-label="更多会话视图"><svg width="13" height="13"></svg></button></span></div>';
  return `<div class="ST7X_W_root" data-phase="active">
<div class="ST7X_W_header">
<div data-slot="conversation.session.header">
<div class="ST7X_W_titleRow"><div class="ST7X_W_titleCluster">
<div class="ST7X_W_crumbs"><span class="ST7X_W_crumbCurrent">当前的添加工作区的按钮</span></div>
<div class="ST7X_W_headerActions"><button class="_2tNPVa_trigger">${GLYPH}<span class="_2tNPVa_triggerLabel">智能体团队</span></button></div>
</div>
<div class="ST7X_W_headerUtilities"><div data-slot="conversation.session.header.utilities">
<button class="ccd-header-action" data-ccd-header-view="terminal" aria-label="终端"></button>
<button class="ccd-header-action" data-ccd-header-view="browser" aria-label="浏览器"></button>
<button class="ccd-header-action" data-ccd-header-view="files" aria-label="文件"></button>
<span class="fixtureMenu"><button class="fixtureButton fixtureSm Da3aKq_moreButton" aria-label="更多操作">${GLYPH}</button></span>
</div></div>
</div>
<div class="ST7X_W_headerCorner" data-conversation-header-corner></div>
${tabs}
</div>
</div>
<div class="ST7X_W_body" data-conversation-body>
<div class="ST7X_W_scrollBody" data-conversation-scroll>
<div class="ST7X_W_composerSeat" data-composer-seat><div class="ST7X_W_composerStack">
<div class="yhfFVG_root" data-composer-root style="--ccd-model-max-width:320px">
<div class="yhfFVG_card" data-composer-card>
<div class="yhfFVG_scroll"><div class="yhfFVG_input">发消息或创建任务</div></div>
<div class="yhfFVG_row">
<div class="yhfFVG_tools"><button class="yhfFVG_add" aria-label="命令">${GLYPH}</button>
<div class="yhfFVG_modes"><div data-slot="conversation.input.permission"><button class="wXeviG_trigger"><span class="wXeviG_triggerLabel">完全权限</span></button></div>
</div></div>
<div class="yhfFVG_trailing"><div data-slot="conversation.input.model"><button class="cl2Rlq_trigger"><span class="cl2Rlq_triggerLabel">DeepSeek V4.1 Flash · OpenCode</span><span class="cl2Rlq_triggerEffort">Max</span></button></div><div class="yhfFVG_activity"><div data-slot="conversation.input.activity"><button aria-label="语音输入">${GLYPH}</button></div></div></div>
</div>
</div>
</div>
</div></div></div>
</div>
</div>`;
}

/** Everything the checks read, in the page's own coordinates. */
const geometry = `(() => {
  const box = selector => {
    const node = document.querySelector(selector);
    if (node === null) return null;
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
  };
  const column = box('.ST7X_W_root');
  const dots = box('.Da3aKq_moreButton');
  const dotsInk = dots === null ? null : dots.left + dots.width / 2;
  const input = box('.yhfFVG_scroll');
  const card = box('[data-composer-card]');
  const row = box('.yhfFVG_row');
  const tools = box('.yhfFVG_tools');
  const trailing = box('.yhfFVG_trailing');
  const actions = box('.ST7X_W_headerActions');
  const cluster = box('.ST7X_W_headerUtilities');
  /* A control a rule has hidden still answers querySelector, with a zero box:
     that is what "not drawn" reads as here. */
  const drawn = selector => {
    const rect = box(selector);
    return rect === null || rect.width === 0 ? null : rect;
  };
  const views = ['terminal', 'browser', 'files'].map(kind => drawn('.ccd-header-action[data-ccd-header-view="' + kind + '"]'));
  const title = drawn('.ST7X_W_crumbs');
  return { column, dots, dotsInk, input, card, row, tools, trailing, actions, cluster, views, title };
})()`;

/** Lay one state out with the host's geometry and the plugin's stylesheets. */
const lay = (devtools, { width }) => devtools.evaluate(`(() => {
  document.documentElement.lang = 'zh';
  document.documentElement.dataset.dshCcdStyle = 'true';
  document.documentElement.dataset.platform = 'darwin';
  document.body.innerHTML = '<div id="col" style="width:${width}px;height:100vh"></div>';
  document.getElementById('col').innerHTML = ${JSON.stringify(aliasHostClasses(page(), PINNED_BUILD))};
  const sheet = document.createElement('style');
  sheet.textContent = ${JSON.stringify(aliasHostClasses(`${hostCss}\n${styles}`, PINNED_BUILD))};
  document.head.append(sheet);
})()`);

test('the status bar stays one line at every column width', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 30000,
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ccd-narrow-column-'));
  try {
    await withPage({ url: 'about:blank', width: 1400, height: 800, scale: 1, profile }, async devtools => {
      for (const width of [380, 460, 560, 700, 900]) {
        await lay(devtools, { width });
        const view = await devtools.evaluate(geometry);
        assert.notEqual(view.tools, null, `${width}px: the leading pair is drawn`);
        assert.notEqual(view.trailing, null, `${width}px: the trailing cluster is drawn`);
        /* One 28px control row between the row's own 2px and 6px padding: the
           bar's height is what the Composer's bottom inset is measured for, so
           a wrapped row would show up here as a row twice as tall. The two
           groups' boxes differ (the status bar's controls are 20px chips, the
           model seat keeps the host's 28px), so what shares the line is their
           centres. */
        assert(
          view.row.height < 37,
          `${width}px: the row is one control row tall (${view.row.height})`,
        );
        const centre = group => group.top + group.height / 2;
        assert(
          Math.abs(centre(view.tools) - centre(view.trailing)) < 1,
          `${width}px: the trailing cluster shares the row's line (${centre(view.tools)} vs ${centre(view.trailing)})`,
        );
        /* The squeeze comes out of the model name, not out of the row's box:
           the cluster still ends inside the Composer's card. */
        assert(
          view.trailing.right <= view.card.right - 3.5,
          `${width}px: the cluster stays inside the card (${view.trailing.right} vs ${view.card.right})`,
        );
      }
      /* The squeeze the wrap used to take lands on the model name instead: at
         the width an expanded right panel leaves, the name is clipped inside
         its own chip, which is how the reference draws it. */
      await lay(devtools, { width: 380 });
      const clipped = await devtools.evaluate('(() => { const label = document.querySelector(".cl2Rlq_triggerLabel"); return label.scrollWidth > label.clientWidth; })()');
      assert.equal(clipped, true, 'the model name clips inside its chip');
      const effort = await devtools.evaluate('document.querySelector(".cl2Rlq_triggerEffort").getBoundingClientRect().width');
      assert(effort > 20, `the effort keeps its own reading (${effort})`);
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});

test('the header cluster ends on the Composer where the Composer fills the column', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 30000,
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ccd-narrow-column-'));
  try {
    await withPage({ url: 'about:blank', width: 1400, height: 800, scale: 1, profile }, async devtools => {
      for (const width of [380, 560, 800]) {
        await lay(devtools, { width });
        const view = await devtools.evaluate(geometry);
        const neighbour = view.views[2];
        assert.equal(view.dots.width, neighbour.width, `${width}px: the nested menu button shares the neighbouring control width`);
        assert.equal(view.dots.height, neighbour.height, `${width}px: the nested menu button shares the neighbouring control height`);
        assert(Math.abs(view.dots.top + view.dots.height / 2 - neighbour.top - neighbour.height / 2) < 0.5,
          `${width}px: the menu and browser glyphs share the same vertical centre`);
        assert(
          Math.abs(view.dotsInk - view.input.right) < 1.5,
          `${width}px: the Session menu's centre is on the input surface's right border (${view.dotsInk} vs ${view.input.right})`,
        );
      }
      /* A column wide enough for the Composer's own 770px cap is the case the
         design's trailing inset was measured in: the cluster keeps it and the
         Composer is centred far inside it. */
      await lay(devtools, { width: 1180 });
      const wide = await devtools.evaluate(geometry);
      assert(
        Math.abs(wide.column.right - wide.cluster.right - 12) < 1.5,
        `the cluster keeps the design's 12px trailing inset (${wide.column.right - wide.cluster.right})`,
      );
      assert(
        wide.column.right - wide.input.right > 100,
        'the Composer is narrower than the column, so nothing lines the two rows up there',
      );
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});

test('native View tabs align before utilities on a single header row', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 30000,
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ccd-native-tabs-narrow-'));
  try {
    await withPage({ url: 'about:blank', width: 1400, height: 800, scale: 1, profile }, async devtools => {
      for (const width of [380, 400, 460, 560]) {
        await lay(devtools, { width });
        const view = await devtools.evaluate(geometry);
        assert.notEqual(view.title, null, `${width}px: the title stays drawn`);
        for (const [index, name] of ['terminal', 'browser', 'files'].entries()) {
          assert.notEqual(view.views[index], null, `${width}px: ${name} stays drawn`);
        }
        assert(view.actions.right <= view.cluster.left + .5, `${width}px: the team chip clears the utilities`);
        assert(view.cluster.right <= view.column.right + .5, `${width}px: the controls stay inside the column`);
        const tabs = await devtools.evaluate(`(() => {
          const tabs = document.querySelector('.ST7X_W_viewTabs').getBoundingClientRect();
          const budget = document.querySelector('.ST7X_W_tabs').clientWidth;
          const title = document.querySelector('.ST7X_W_crumbs').getBoundingClientRect();
          const utilities = document.querySelector('.ST7X_W_headerUtilities').getBoundingClientRect();
          const team = document.querySelector('.ST7X_W_headerActions').getBoundingClientRect();
          const more = document.querySelector('button[aria-haspopup=menu]');
          return { top: tabs.top, bottom: tabs.bottom, left: tabs.left, right: tabs.right,
            titleTop: title.top, titleBottom: title.bottom, teamRight: team.right, utilitiesLeft: utilities.left,
            budget, moreDisplay: getComputedStyle(more).display,
            titleHit: document.elementFromPoint(title.left + title.width / 2, title.top + title.height / 2)?.closest('.ST7X_W_crumbs') !== null,
            tabHit: document.elementFromPoint(tabs.right - 13, tabs.top + 14)?.closest('[role=tab]') !== null,
            activeColor: getComputedStyle(document.querySelector('[role=tab][aria-selected=true]')).color,
            inactiveColor: getComputedStyle(document.querySelector('[role=tab][aria-selected=false]')).color,
            underline: getComputedStyle(document.querySelector('[role=tab][aria-selected=true]'), '::after').backgroundColor };
        })()`);
        assert(tabs.top < tabs.titleBottom && tabs.bottom > tabs.titleTop, `${width}px: native tabs share the title row`);
        assert(tabs.left >= tabs.teamRight - .5, `${width}px: tabs follow the team entry`);
        assert(tabs.right <= tabs.utilitiesLeft + .5, `${width}px: tabs clear the utilities`);
        assert.equal(tabs.moreDisplay, 'none');
        assert.equal(tabs.budget, 288, 'the host retains room for both native tabs');
        assert(tabs.titleHit, 'the transparent budget does not intercept title clicks');
        assert(tabs.tabHit, 'the visible native tabs remain clickable');
        assert.notEqual(tabs.activeColor, tabs.inactiveColor, 'the selected View remains distinct');
        assert.equal(tabs.underline, tabs.activeColor, 'the underline follows the native selected state');
      }
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});

test('the browsing column speaks both shipped builds', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 20000,
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ccd-narrow-column-win-'));
  try {
    await withPage({ url: 'about:blank', width: 1400, height: 800, scale: 1, profile }, async devtools => {
      for (const hostBuild of [PINNED_BUILD, WINDOWS_BUILD]) {
        await devtools.evaluate(`(() => {
          document.documentElement.lang = 'zh';
          document.documentElement.dataset.dshCcdStyle = 'true';
          document.documentElement.dataset.platform = 'darwin';
          document.body.innerHTML = '<div id="col" style="width:420px;height:100vh"></div>';
          document.getElementById('col').innerHTML = ${JSON.stringify(aliasHostClasses(page(), hostBuild))};
          const sheet = document.createElement('style');
          sheet.textContent = ${JSON.stringify(aliasHostClasses(`${hostCss}\n${styles}`, hostBuild))};
          document.head.append(sheet);
        })()`);
        const view = await devtools.evaluate(aliasHostClasses(geometry, hostBuild));
        assert.equal(view.views[0] === null, false, `${hostBuild.id}: the folder view is drawn`);
        assert(
          Math.abs(view.dotsInk - view.input.right) < 1.5,
          `${hostBuild.id}: the cluster ends on the input surface (${view.dotsInk} vs ${view.input.right})`,
        );
      }
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});
