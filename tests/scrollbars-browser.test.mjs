import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, PINNED_BUILD, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Local Chrome enables browser coverage. */ }

/*
 * The window's scrollbars, in a real renderer: the host's own track, this
 * interface's ink, and the one kind of declaration that would take both away.
 *
 * The fixture is the host's scrollbar system as it ships — the five tokens on
 * `body` and the un-scoped `::-webkit-scrollbar` family that paints them
 * (`ui-theme/src/styles/scrollbar.css`), the settings column's wider track with
 * its inset thumb, and the `scrollbar-width: none` the host puts on its
 * horizontal rails. Beside it stands a document-wide `scrollbar-width: thin;
 * scrollbar-color: …`, the declaration a page-global skin makes and the one
 * that suppresses the host's painting for every element it reaches.
 *
 * What the assertions read is the cascade and the paint, not the layout: the
 * run happens under `--hide-scrollbars`, where no track keeps a width, so the
 * painted geometry is read back off the host's own rules that still produce it
 * (`getComputedStyle(el, '::-webkit-scrollbar').width`) and the ink off the
 * thumb's computed background.
 */

/** The host's own tokens and pseudo-element family, verbatim in shape. */
const hostStyles = `
:root{--dsw-static-neutral-200:#dcdcdd;--dsw-static-neutral-400:#c3c3c4}
body{--dsh-scrollbar-thumb:var(--dsw-static-neutral-200);--dsh-scrollbar-thumb-hover:var(--dsw-static-neutral-400);--dsh-scrollbar-thumb-border:0px;--dsh-scrollbar-track-margin:0px;--dsh-scrollbar-width:5px}
::-webkit-scrollbar{width:var(--dsh-scrollbar-width);height:var(--dsh-scrollbar-width)}
::-webkit-scrollbar-track{margin-block:var(--dsh-scrollbar-track-margin);background:transparent}
::-webkit-scrollbar-thumb{border:var(--dsh-scrollbar-thumb-border) solid transparent;background:var(--dsh-scrollbar-thumb);background-clip:content-box;border-radius:999px}
::-webkit-scrollbar-thumb:hover{background-color:var(--dsh-scrollbar-thumb-hover)}
/* The settings dialog widens its column's track and insets the thumb in it. */
.Dws9Sa_options{--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}
/* A host rail: the scrollbar is hidden on purpose, not by omission. */
.hKoVwa_rail{scrollbar-width:none;overflow-x:auto;overflow-y:hidden}
`;

/** A page-global skin's blanket declaration: thin, and not ours. */
const skinStyles = `
body{background:#fcfcfb;margin:0}
body[_fixture-skin] *{scrollbar-width:thin;scrollbar-color:#d0cdc1 transparent}
`;

const scroll = content => `<div style="height:600px">${content}</div>`;

/* Every surface the sheet lists, each with something long enough to overflow
   it, plus the boxes that must come out untouched. Two of those sit where the
   host really puts them: the Composer's seat inside the page's scrolling body,
   and the turn navigator beside the transcript column — both inside the page
   scroller, both with a scrollbar the host hides. The transcript column keeps a
   fenced code block of its own, and the menu card its viewport. The host
   classes are the pinned build's, which the run rewrites for the Windows build
   like every other fixture here. */
const fixture = `
<div id="page" class="ST7X_W_scrollBody" data-conversation-scroll style="height:200px;overflow:auto">
  ${scroll('page')}
  <div id="column" class="icaHSq_scroll" style="height:200px;overflow:auto">
    ${scroll('column')}
    <pre id="code" style="height:200px;overflow:auto">${scroll('code')}</pre>
  </div>
  <div id="turnNav" class="JXrxFq_scroller" style="height:120px;overflow-y:auto;scrollbar-width:none">${scroll('turn nav')}</div>
  <div id="attachmentRail" class="hKoVwa_rail" style="height:60px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none"><div style="width:2000px">rail</div></div>
</div>
<div id="tree" class="_7514NG_list" style="height:200px;overflow:auto">${scroll('tree')}</div>
<div id="files" data-files-body style="height:200px;overflow:auto">${scroll('files')}</div>
<div id="team" class="_2tNPVa_body" style="height:200px;overflow:auto">${scroll('team')}</div>
<div id="composer" class="yhfFVG_scroll" style="height:200px;overflow:auto">${scroll('composer')}</div>
<div id="settings" class="Dws9Sa_options" style="height:200px;overflow:auto">${scroll('settings')}</div>
<div id="menu" data-menu-material style="height:200px;overflow:hidden">
  <div id="menuViewport" style="height:200px;overflow:auto">${scroll('menu rows')}</div>
</div>
<div id="model" class="ccd-model-panel" style="height:200px;overflow:auto">${scroll('model')}</div>
<div id="detail" class="ccd-context-detail" style="height:200px;overflow:auto">${scroll('detail')}</div>
<div id="fontMenu" class="ccd-settings-menu-list" style="height:200px;overflow:auto">${scroll('fonts')}</div>
<div id="plain" style="height:200px;overflow:auto">${scroll('plain')}</div>
`;

/** Surfaces the two untouched groups read the same before and after. */
const UNTOUCHED = ['#turnNav', '#attachmentRail', '#plain'];

const IN_SCOPE = [
  '#page', '#code', '#tree', '#files', '#team', '#composer',
  '#settings', '#menuViewport', '#model', '#detail', '#fontMenu',
];

const LIGHT_THUMB = 'rgb(51, 51, 49)';
const LIGHT_HOVER = '#171716';
const DARK_THUMB = 'rgb(92, 91, 87)';
const DARK_HOVER = '#75746f';
const HOST_THUMB = 'rgb(220, 220, 221)';
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** Computed scrollbar facts for one element. */
const read = (page, selector) => page.evaluate(`(()=>{
  const element=document.querySelector(${JSON.stringify(selector)});
  if(element===null)return null;
  const s=getComputedStyle(element);
  const thumb=getComputedStyle(element,'::-webkit-scrollbar-thumb');
  const track=getComputedStyle(element,'::-webkit-scrollbar-track');
  const bar=getComputedStyle(element,'::-webkit-scrollbar');
  return {
    scrollbarWidth:s.scrollbarWidth,
    scrollbarColor:s.scrollbarColor,
    thumbToken:s.getPropertyValue('--dsh-scrollbar-thumb').trim(),
    hoverToken:s.getPropertyValue('--dsh-scrollbar-thumb-hover').trim(),
    trackWidth:s.getPropertyValue('--dsh-scrollbar-width').trim(),
    thumbBorder:s.getPropertyValue('--dsh-scrollbar-thumb-border').trim(),
    paintedWidth:bar.width,
    paintedThumb:thumb.backgroundColor,
    paintedRadius:thumb.borderTopLeftRadius,
    paintedTrack:track.backgroundColor,
  };
})()`);

test('the window’s scrollbars take the interface’s ink and the host’s own track', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 60000,
}, async () => {
  const styles = (await Promise.all([
    'src/client/theme/tokens.css',
    'src/client/theme/scrollbars.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');

  for (const build of [PINNED_BUILD, WINDOWS_BUILD]) {
    const windows = build === WINDOWS_BUILD;
    const profile = await mkdtemp(join(tmpdir(), 'ccd-scrollbars-test-'));
    try {
      await withPage({ url: 'about:blank', width: 960, height: 1000, scale: 1, profile }, async page => {
        await page.evaluate(`
          document.documentElement.dataset.dshCcdStyle='true';
          /* The document-wide skin declaration a sibling plugin in the same
             window makes; the fixture reads it through its own body marker. */
          document.body.setAttribute('_fixture-skin','true');
          document.body.insertAdjacentHTML('afterbegin', ${JSON.stringify(aliasHostClasses(fixture, build))});
          const native=document.createElement('style');
          native.textContent=${JSON.stringify(aliasHostClasses(hostStyles, build))};
          document.head.append(native);
          const skin=document.createElement('style');
          skin.textContent=${JSON.stringify(skinStyles)};
          document.head.append(skin);
        `);

        const where = windows ? ' (Windows build)' : ' (pinned build)';

        /* Before the interface's sheet: the host's own painting is suppressed
           for the whole document by the skin's declaration, and the boxes this
           sheet must not reach are recorded as they stand. */
        for (const selector of IN_SCOPE) {
          assert.equal((await read(page, selector)).scrollbarWidth, 'thin',
            `${selector}${where} starts out suppressed by the document-wide declaration`);
        }
        const untouched = Object.fromEntries(
          await Promise.all(UNTOUCHED.map(async selector => [selector, await read(page, selector)])),
        );

        await page.evaluate(`
          const style=document.createElement('style');
          style.textContent=${JSON.stringify(aliasHostClasses(styles, build))};
          document.head.append(style);
        `);

        for (const selector of IN_SCOPE) {
          const facts = await read(page, selector);
          assert.ok(facts, `${selector} is in the fixture`);
          /* The reset: the host's own painting is back, against the
             document-wide `thin` that had suppressed it. */
          assert.equal(facts.scrollbarWidth, 'auto', `${selector}${where} hands the standard property back`);
          assert.equal(facts.scrollbarColor, 'auto', `${selector}${where} hands the colour back`);
          /* The ink's own token, and the paint at rest: the track is the host's
             and carries nothing until the surface moves. */
          assert.equal(facts.thumbToken, '#333331', `${selector}${where} reads the interface's thumb`);
          assert.equal(facts.hoverToken, LIGHT_HOVER, `${selector}${where} reads the interface's hover thumb`);
          assert.equal(facts.paintedThumb, TRANSPARENT, `${selector}${where} carries no ink at rest`);
          assert.equal(facts.paintedRadius, '999px', `${selector}${where} keeps the host's pill`);
          assert.equal(facts.paintedTrack, TRANSPARENT, `${selector}${where} keeps the host's transparent track`);
        }

        /* One surface in motion — the module's own mark — is the whole of the
           state that brings the ink back. */
        await page.evaluate(`document.querySelector('#page').setAttribute('data-ccd-scrolling','')`);
        assert.equal((await read(page, '#page')).paintedThumb, LIGHT_THUMB,
          `a moving surface paints the interface's thumb${where}`);
        await page.evaluate(`document.querySelector('#page').removeAttribute('data-ccd-scrolling')`);
        assert.equal((await read(page, '#page')).paintedThumb, TRANSPARENT,
          `and drops it again when the mark goes${where}`);

        /* A surface the module tracks with a pill carries no ink even while it
           moves: the floating capsule is its bar. */
        await page.evaluate(`
          for (const selector of ['#page', '#files', '#settings']) {
            document.querySelector(selector).setAttribute('data-ccd-scroll-pill','');
          }
          document.querySelector('#page').setAttribute('data-ccd-scrolling','');
        `);
        assert.equal((await read(page, '#page')).paintedThumb, TRANSPARENT,
          `a pill surface keeps its track empty while it moves${where}`);
        assert.equal((await read(page, '#files')).paintedThumb, TRANSPARENT,
          `and so does every other pill surface${where}`);
        assert.equal((await read(page, '#settings')).paintedThumb, TRANSPARENT,
          `whether or not the host widened its track${where}`);
        await page.evaluate(`
          for (const selector of ['#page', '#files', '#settings']) {
            document.querySelector(selector).removeAttribute('data-ccd-scroll-pill');
          }
          document.querySelector('#page').removeAttribute('data-ccd-scrolling');
        `);

        /* The track is the host's own on both of its widths, so nothing
           measured against it — the transcript's stable gutter, the sidebar
           list's row padding, the settings column's 9px — moves. */
        const settings = await read(page, '#settings');
        assert.equal(settings.trackWidth, '9px', `the settings column keeps the host's wide track${where}`);
        assert.equal(settings.thumbBorder, '2px', `and its inset thumb${where}`);
        assert.equal(settings.paintedWidth, '9px', `which is what is painted there${where}`);
        const page5 = await read(page, '#page');
        assert.equal(page5.trackWidth, '5px', `the transcript page keeps the host's 5px track${where}`);
        assert.equal(page5.paintedWidth, '5px', `which is what is painted there${where}`);

        /* A menu card rebinds the thumb token for its own viewport; the mark on
           its scroller still brings the interface's ink back. */
        const menu = await read(page, '#menuViewport');
        assert.equal(menu.thumbToken, '#333331', `a card that rebinds the token still reads the interface's thumb${where}`);
        await page.evaluate(`document.querySelector('#menuViewport').setAttribute('data-ccd-scrolling','')`);
        assert.equal((await read(page, '#menuViewport')).paintedThumb, LIGHT_THUMB,
          `and paints it while its rows move${where}`);
        await page.evaluate(`document.querySelector('#menuViewport').removeAttribute('data-ccd-scrolling')`);

        /* Out of scope: nothing is painted that was not painted before. The two
           host rails — one beside the transcript column, one in the Composer
           seat, both inside the page scroller — keep their hidden scrollbar and
           the host's track geometry, and a box outside the page scroller keeps
           the host's own thumb down to the token. (The rails do inherit the ink
           token, as anything inside a scoped scroller does — a custom property
           inherits and cannot be scoped away — but a rail paints no scrollbar to
           read it, and `scrollbar-width` is not an inherited property.) */
        for (const selector of ['#turnNav', '#attachmentRail']) {
          const before = untouched[selector];
          const after = await read(page, selector);
          for (const field of ['scrollbarWidth', 'scrollbarColor', 'trackWidth', 'thumbBorder', 'paintedWidth', 'paintedRadius', 'paintedTrack']) {
            assert.equal(after[field], before[field], `${selector}${where} keeps its ${field}`);
          }
          assert.equal(after.scrollbarWidth, 'none', `${selector}${where} keeps its hidden scrollbar`);
        }
        assert.deepEqual(await read(page, '#plain'), untouched['#plain'], `a box outside the list is untouched${where}`);
        assert.equal(untouched['#plain'].scrollbarWidth, 'thin', `the interface declares nothing for a stranger${where}`);
        assert.equal(untouched['#plain'].thumbToken, '#dcdcdd', `so it keeps the host's own thumb token${where}`);
        /* The host's own rule still resolves its own token there — the sheet
           repaints nothing it does not list. */
        assert.equal(untouched['#plain'].paintedThumb, HOST_THUMB, `and paints the host's own thumb${where}`);

        /* Dark side: the same rules, the other pair of values. */
        await page.evaluate(`
          document.body.dataset.dsDarkTheme='';
          document.querySelector('#page').setAttribute('data-ccd-scrolling','');
        `);
        const dark = await read(page, '#page');
        assert.equal(dark.thumbToken, '#5c5b57', `the dark scheme has its own thumb${where}`);
        assert.equal(dark.hoverToken, DARK_HOVER, `and its own hover step${where}`);
        assert.equal(dark.paintedThumb, DARK_THUMB, `which is what a moving surface paints${where}`);
        await page.evaluate(`
          delete document.body.dataset.dsDarkTheme;
          document.querySelector('#page').removeAttribute('data-ccd-scrolling');
        `);
      });
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  }
});
