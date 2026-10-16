import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, PINNED_BUILD } from '../src/client/compat/host-builds.ts';

/*
 * A Session row's trailing side, laid out in a real renderer.
 *
 * The fixture is `ui-workspace`'s own row as it ships: `SessionNodeItem` renders
 * a 16px status slot, the title, the relative time, the pin marker, and one
 * `rowActions` box holding the `Menu` trigger plus the host's
 * `sidebar.workspaces.session.row.action` list — the output of `renderSlot`,
 * which is a `div[data-slot]` with an inline `display: contents`, carrying the
 * package's own archive and pin hover buttons. The host's stylesheet brings the
 * rules that reveal that box under the pointer and hide the time beside it.
 *
 * What the assertions read is the result: with the plugin's sheet the box ends
 * at one 28px ⋮, the seat takes no box and no focus, the trigger is the
 * trailing control at the row's own padding edge, and its hover fill is the step
 * the token names. The first case runs the same page without the sheet, so the
 * three marks the reference replaced are shown to be the host's and the rule's
 * to remove.
 */

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Local Chrome enables the browser coverage. */ }

/** The host's own declarations for the row this test measures. */
const hostCss = `
  :root{--dsw-radius-xs:4px;--dsw-radius-md:8px;--dsw-alias-interactive-bg-hover:#f0f0ee;
    --dsw-alias-label-primary:#1f1f1d;--dsw-alias-label-tertiary:#8f8f8a;--dsh-workspace-indent:0px}
  body{margin:0;background:#fbfbf9}
  .jJkEga_projectRow,.jJkEga_sessionRow{border-radius:var(--dsw-radius-md);padding:0 8px;cursor:pointer;
    user-select:none;color:var(--dsw-alias-label-primary);align-items:center;gap:6px;
    padding-inline-start:calc(8px + var(--dsh-workspace-indent,0px));display:flex}
  .jJkEga_projectRow:hover,.jJkEga_sessionRow:hover,.jJkEga_sessionRow.jJkEga_selected{background:var(--dsw-alias-interactive-bg-hover)}
  .jJkEga_sessionRow{gap:0;height:32px}
  .jJkEga_sessionRow .jJkEga_title{margin:0 6px 0 4px}
  .jJkEga_slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;
    justify-content:center;align-items:center;display:inline-flex}
  .jJkEga_title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;line-height:20px;overflow:hidden}
  .jJkEga_sessionRow .jJkEga_title{flex:1}
  .jJkEga_time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:10px;line-height:16px}
  .jJkEga_rowActions{flex:none;align-items:center;gap:10px;display:none}
  .jJkEga_sessionRow:hover .jJkEga_rowActions,.jJkEga_sessionRow.jJkEga_menuOpen .jJkEga_rowActions{display:inline-flex}
  .jJkEga_sessionRow.jJkEga_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}
  .jJkEga_sessionRow:hover .jJkEga_time,.jJkEga_sessionRow.jJkEga_menuOpen .jJkEga_time{display:none}
  .jJkEga_iconButton{border-radius:var(--dsw-radius-xs);cursor:pointer;width:16px;height:16px;
    color:var(--dsw-alias-label-tertiary);background:0 0;border:none;flex:none;justify-content:center;
    align-items:center;padding:0;display:inline-flex}
  .jJkEga_iconButton:hover{color:var(--dsw-alias-label-primary)}
`;

/* The host's artwork, stood in for by stroked paths of the same weight. */
const stroke = 'fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"';
const ellipsisSvg = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="3" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="13" cy="8" r="1" fill="currentColor"/></svg>`;
const archiveSvg = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 4h12M3 4v9h10V4" ${stroke}/></svg>`;
const pinSvg = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 2h4l-.5 3 2 2v1H4.5V7l2-2zM8 8v6" ${stroke}/></svg>`;

/**
 * One Session row: the status slot, the title, the time, the pin marker and the
 * host's own actions box — the ⋯ trigger, then the seat `renderSlot` renders for
 * the archive and pin buttons, with the anchor's inline `display: contents`.
 */
const sessionRow = `<div class="_3WPZCG_root" style="width:264px;padding:0 10px;box-sizing:border-box">
  <div class="jJkEga_sessionRow jJkEga_selected" data-row-key="session:a" role="treeitem" aria-selected="true">
    <span class="jJkEga_slot"></span>
    <span id="title-a" class="jJkEga_title">UI/UX的含义</span>
    <span class="jJkEga_time">刚刚</span>
    <span class="jJkEga_rowActions">
      <span><button id="more-a" type="button" class="jJkEga_iconButton" aria-label="会话操作">${ellipsisSvg}</button></span>
      <div data-slot="sidebar.workspaces.session.row.action" style="display: contents">
        <span><button id="archive-a" type="button" class="jJkEga_iconButton" aria-label="归档">${archiveSvg}</button></span>
        <span><button id="pin-a" type="button" class="jJkEga_iconButton" aria-label="置顶">${pinSvg}</button></span>
      </div>
    </span>
  </div>
</div>`;

/** Boxes, computed ink and the seat's own display, read back from the page. */
const readout = `(() => {
  const box = selector => {
    const element = document.querySelector(selector);
    if (element === null) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const mark = getComputedStyle(element, '::before');
    return {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      right: rect.right, bottom: rect.bottom, radius: style.borderRadius,
      fill: style.backgroundColor, ink: style.color,
      mark: mark.maskImage, markWidth: mark.width, markDisplay: mark.display,
    };
  };
  const svg = document.querySelector('#more-a svg');
  return {
    row: box('[data-row-key="session:a"]'), title: box('#title-a'), time: box('.jJkEga_time'),
    actions: box('.jJkEga_rowActions'), more: box('#more-a'),
    archive: box('#archive-a'), pin: box('#pin-a'),
    svg: svg === null ? null : getComputedStyle(svg).display,
    seat: getComputedStyle(document.querySelector('[data-slot="sidebar.workspaces.session.row.action"]')).display,
    strong: getComputedStyle(document.documentElement).getPropertyValue('--ccd-hover-strong').trim(),
  };
})()`;

const styles = (await Promise.all([
  'src/client/theme/tokens.css',
  'src/client/features/sidebar/sidebar.css',
].map(path => readFile(join(root, path), 'utf8')))).join('\n');

test('a Session row ends at one ⋮, and the seat it replaces takes no box', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 30000,
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ccd-session-row-test-'));
  try {
    await withPage({ url: 'about:blank', width: 264, height: 200, scale: 2, profile }, async devtools => {
      /* One page, rendered twice: the host's own row, then the same row with the
         plugin's sheet. Every write is the fixture's, so the second pass cannot
         inherit anything from the first. */
      const render = plugin => devtools.evaluate(`(() => {
        document.documentElement.dataset.dshCcdStyle='true';
        document.body.innerHTML=${JSON.stringify(aliasHostClasses(sessionRow, PINNED_BUILD))};
        document.head.querySelector('style[data-fixture]')?.remove();
        const sheet=document.createElement('style');
        sheet.dataset.fixture='';
        sheet.textContent=${JSON.stringify(aliasHostClasses(hostCss, PINNED_BUILD))}
          + ${plugin ? JSON.stringify(aliasHostClasses(styles, PINNED_BUILD)) : "''"};
        document.head.append(sheet);
      })()`);
      /* Pointer moves are the only way `:hover` arrives in a headless page, and
         a move that repeats the last position is not dispatched again, so the
         pointer is parked away from the row first. A control inside the row's
         actions box has no box at all until the row itself is hovered — that
         box is host-revealed — so the row is hovered before its own controls
         are measured. */
      const point = selector => devtools.evaluate(`(() => {
        const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
      })()`);
      const settle = () => devtools.evaluate('document.getAnimations().forEach(animation => animation.finish())');
      const hoverRow = async () => {
        await devtools.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
        await devtools.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...(await point('#title-a')) });
        await settle();
      };
      const hoverControl = async selector => {
        await hoverRow();
        await devtools.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...(await point(selector)) });
        await settle();
      };

      /* Both passes are also captured, so the row can be looked at beside the
         reference the way the design document's own checks do. */
      const capture = async name => {
        const shot = await devtools.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 264, height: 60, scale: 2 } });
        await mkdir(join(root, 'artifacts'), { recursive: true });
        await writeFile(join(root, 'artifacts', name), Buffer.from(shot.data, 'base64'));
      };

      /* The host's own row: three marks on hover, all inside the actions box. */
      await render(false);
      await hoverRow();
      let view = await devtools.evaluate(readout);
      assert.equal(view.seat, 'contents', 'the seat is a layout anchor, not a box');
      for (const [name, control] of [['menu', view.more], ['archive', view.archive], ['pin', view.pin]]) {
        assert.ok(control.width > 0 && control.height > 0, `the host draws its ${name} control`);
      }
      assert.ok(view.actions.width > view.more.width, `the host stacks the three (${view.actions.width})`);
      await capture('session-row-host-actions.png');

      /* The same row with the plugin's sheet: one ⋮, and the seat out of the line.
         `display: contents` arrives as an inline style, so this is the one
         assertion in the file that reads the cascade rather than a box. */
      await render(true);
      await hoverRow();
      view = await devtools.evaluate(readout);
      await capture('session-row-menu.png');
      assert.equal(view.seat, 'none', 'the seat is hidden, inline anchor style and all');
      assert.equal(view.archive.width, 0, 'the archive button takes no box');
      assert.equal(view.pin.width, 0, 'the pin button takes no box');
      assert.equal(view.archive.height, 0, 'and no height either');
      assert.equal(view.actions.width, view.more.width, `the cluster is the ⋮ alone (${view.actions.width})`);
      assert.equal(view.time.width, 0, 'the host still clears the time under the pointer');

      /* Nothing hidden is reachable: no box, no focus, and the row's own click
         target is what a pointer there lands on. */
      assert.equal(await devtools.evaluate(`(() => {
        const button = document.querySelector('#archive-a');
        button.focus();
        return document.activeElement === button;
      })()`), false, 'a hidden control cannot take focus');
      assert.equal(await devtools.evaluate(`(() => {
        const row = document.querySelector('[data-row-key="session:a"]').getBoundingClientRect();
        const found = document.elementFromPoint(Math.round(row.right - 20), Math.round(row.y + row.height / 2));
        return found?.closest('[data-row-key]') !== null;
      })()`), true, 'the trailing of the row belongs to the row again');

      /* The control itself: a 22px box with a 6px corner, flush with the row's
         own 3px inset and centred on its line. */
      const more = view.more;
      assert.equal(more.width, 22);
      assert.equal(more.height, 22);
      assert.equal(more.radius, '6px');
      assert.ok(Math.abs(more.right - (view.row.right - 3)) < 0.5,
        `the ⋮ ends on the row's padding edge (${more.right} vs ${view.row.right})`);
      assert.ok(Math.abs((more.y + more.height / 2) - (view.row.y + view.row.height / 2)) < 0.5,
        'the ⋮ is centred on the row');

      assert.ok(more.y >= view.row.y + 3 && more.bottom <= view.row.bottom - 3,
        'the button stays inside the row with 3px above and below');

      /* Its mark: the host's horizontal ellipsis steps aside for the stacked ⋮,
         painted at the compact 14px size from the one artwork token. */
      assert.equal(view.svg, 'none', 'the host svg is not drawn');
      assert.equal(view.more.markDisplay, 'block', 'the replacement mark is painted');
      assert.equal(view.more.markWidth, '14px', 'at the compact project-icon size');
      assert.ok(view.more.mark.includes('svg'), 'from the artwork token, not an empty box');

      /* Fill: nothing while the pointer is only on the row, and the token's step
         — one below the row's own `--ccd-selected` — while it is on the ⋮. */
      assert.equal(view.more.fill, 'rgba(0, 0, 0, 0)', 'the ⋮ rests unfilled');
      assert.equal(view.strong, '#e1e0dd', 'the light palette declares the measured step');
      await hoverControl('#more-a');
      view = await devtools.evaluate(readout);
      assert.equal(view.more.fill, 'rgb(225, 224, 221)', `the ⋮ takes ${view.strong} on hover`);
      assert.equal(view.more.ink, 'rgb(31, 31, 29)', 'and the row\'s own ink with it');
      assert.ok(view.archive.width === 0 && view.pin.width === 0, 'the seat stays out while the menu\'s trigger is pointed at');
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
  }
});
