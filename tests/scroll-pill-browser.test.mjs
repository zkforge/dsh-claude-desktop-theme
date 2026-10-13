import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
import { aliasHostClasses, PINNED_BUILD, WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Local Chrome enables browser coverage. */ }

/*
 * The window's scrollbars, in a real renderer: what the module marks, where the
 * floating pill lands, and what is left behind when it goes.
 *
 * The fixture is the host's scrollbar plumbing (`ui-theme`'s five tokens and the
 * `::-webkit-scrollbar` family that paints them) plus the interface's own sheet,
 * over the five surfaces the pill replaces the ink on and two scrollers it must
 * leave alone: one pill surface with nothing to scroll, and an anonymous box
 * outside the sheet's scope.
 *
 * The pill is addressed by where it should be rather than by which element it
 * belongs to: the module keeps no link between the two, and the placement is
 * what the surface's own thumb would have been — so every geometry assertion
 * below is "a pill sits exactly on the thumb this surface would have painted".
 */

const HOST_CSS = `
:root{--dsw-static-neutral-200:#dcdcdd}
body{--dsh-scrollbar-thumb:var(--dsw-static-neutral-200);--dsh-scrollbar-thumb-hover:#c3c3c4;--dsh-scrollbar-thumb-border:0px;--dsh-scrollbar-track-margin:0px;--dsh-scrollbar-width:5px}
::-webkit-scrollbar{width:var(--dsh-scrollbar-width);height:var(--dsh-scrollbar-width)}
::-webkit-scrollbar-track{margin-block:var(--dsh-scrollbar-track-margin);background:transparent}
::-webkit-scrollbar-thumb{border:var(--dsh-scrollbar-thumb-border) solid transparent;background:var(--dsh-scrollbar-thumb);background-clip:content-box;border-radius:999px}
body{background:#fcfcfb}
/* Desktop drag rules from the shipped web frontend. The body-child rule also
   matches transparent decoration: pointer-events does not reset app-region. */
html[data-platform=darwin] [data-window-drag]{-webkit-app-region:drag}
html[data-platform=darwin] body>:not(#root){-webkit-app-region:no-drag}
html[data-platform=darwin] button{-webkit-app-region:no-drag}
`;

/** One scroller: `height` of viewport, `lines` of content. */
const scroller = (id, attributes, height, lines) => `
<div ${attributes} id="${id}" style="height:${height}px;overflow-y:auto">
  <div>${Array.from({ length: lines }, (_, line) => `<p style="margin:0 0 10px">line ${line}</p>`).join('')}</div>
</div>`;

/*
 * The three lengths a painted thumb can take, and what the pill does with each:
 * a surface that only just overflows paints a thumb taller than the cap (the
 * reference's own case — a short conversation, a panel with one page of
 * content) and the pill stays a capsule; a surface with a few screens of
 * content paints a thumb inside the range and the pill takes it as it is; a
 * long transcript paints a thumb below the floor and the pill stops at that.
 */
const fixture = [
  scroller('page', 'class="ST7X_W_scrollBody" data-conversation-scroll', 240, 11),
  scroller('column', 'class="icaHSq_scroll"', 240, 24),
  scroller('tree', 'class="_7514NG_list"', 240, 24),
  scroller('files', 'data-files-body', 240, 60),
  scroller('team', 'class="_2tNPVa_body"', 240, 60),
  scroller('short', 'class="_2tNPVa_body"', 240, 3),
  scroller('plain', '', 240, 40),
].join('\n');

const PILL = '[data-ccd-scroll-thumb]';
const LAYER = '[data-ccd-scroll-layer]';
const SURFACE = 'data-ccd-scroll-pill';
const SCROLLING = 'data-ccd-scrolling';

/** What the module should have drawn for one surface, read off the page. */
const expected = selector => `(() => {
  const surface = document.querySelector(${JSON.stringify(selector)});
  const box = surface.getBoundingClientRect();
  const track = surface.clientHeight;
  const content = surface.scrollHeight;
  const range = content - track;
  const thumb = (track / content) * track;
  const length = Math.min(96, Math.max(36, thumb));
  const centre = (surface.scrollTop / range) * (track - thumb) + thumb / 2;
  return {
    left: box.right - 1 - 4,
    top: box.top + Math.min(Math.max(centre - length / 2, 0), track - length),
    length,
    track, content, range, thumb,
  };
})()`;

/** Every pill the layer holds, as boxes read back off the page. */
const pills = `[...document.querySelectorAll(${JSON.stringify(PILL)})].map(element => {
  const box = element.getBoundingClientRect();
  return { left: box.left, top: box.top, width: box.width, height: box.height,
    display: element.style.display, scrolling: element.hasAttribute(${JSON.stringify(SCROLLING)}),
    opacity: Number(getComputedStyle(element).opacity) };
})`;

/** The one pill that should be sitting on one surface's thumb, or undefined. */
const pillOn = selector => `
  (() => {
    const want = ${expected(selector)};
    return [...document.querySelectorAll(${JSON.stringify(PILL)})]
      .filter(element => element.style.display !== 'none')
      .map(element => { const box = element.getBoundingClientRect();
        return { left: box.left, top: box.top, width: box.width, height: box.height,
          scrolling: element.hasAttribute(${JSON.stringify(SCROLLING)}),
          opacity: Number(getComputedStyle(element).opacity) }; })
      .filter(box => Math.abs(box.left - want.left) < 0.5 && Math.abs(box.top - want.top) < 0.5);
  })()`;

const wait = (page, ms) => page.evaluate(`new Promise(resolve => setTimeout(resolve, ${ms}))`);

test('the tracked surfaces carry a floating pill instead of the painted thumb', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 60000,
}, async () => {
  const styles = (await Promise.all([
    'src/client/theme/tokens.css',
    'src/client/theme/scrollbars.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');

  const bundle = await build({
    stdin: {
      resolveDir: root,
      contents: `
        import { mountScrollPills } from './src/client/compat/scroll-pill.ts';
        window.errors = [];
        window.mount = () => { window.release = mountScrollPills(document, error => window.errors.push(String(error))); };
      `,
    },
    bundle: true, write: false, format: 'iife',
  });

  for (const buildInfo of [PINNED_BUILD, WINDOWS_BUILD]) {
    const windows = buildInfo === WINDOWS_BUILD;
    const where = windows ? ' (Windows build)' : ' (pinned build)';
    const profile = await mkdtemp(join(tmpdir(), 'ccd-scroll-pill-test-'));
    try {
      await withPage({ url: 'about:blank', width: 900, height: 1600, scale: 1, profile }, async page => {
        const alias = text => JSON.stringify(aliasHostClasses(text, buildInfo));
        await page.evaluate(bundle.outputFiles[0].text);
        const mount = async () => {
          await page.evaluate(`(() => {
            document.documentElement.dataset.dshCcdStyle = 'true';
            document.documentElement.dataset.platform = ${JSON.stringify(windows ? 'win32' : 'darwin')};
            document.body.innerHTML = ${await alias(`<div id="root">
              <header data-window-drag style="position:fixed;top:0;left:0;right:0;height:40px">Window header <button>Header action</button></header>
              ${fixture}
              </div><aside id="portal" style="position:fixed;right:0;bottom:0;width:100px;height:40px">Host portal</aside>`)};
            const style = document.createElement('style');
            style.textContent = ${await alias(`${HOST_CSS}\n${styles}`)};
            document.head.append(style);
            window.mount();
          })()`);
          /* The pills are placed once at mount; the layout needs one settle. */
          await wait(page, 40);
        };
        await mount();

        /* One pill per tracked surface, and one layer for all of them. */
        assert.equal(await page.evaluate(`document.querySelectorAll(${JSON.stringify(LAYER)}).length`), 1,
          `the pills live in one fixed layer${where}`);
        assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(LAYER)})).pointerEvents`), 'none',
          `the layer takes no pointer events${where}`);
        assert.equal(await page.evaluate(`document.body.lastElementChild.hasAttribute('data-ccd-scroll-layer')`), true,
          `the layer is the last child of the body${where}`);
        assert.equal(await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(LAYER)})).webkitAppRegion`), 'none',
          `the full-window decoration neither adds nor subtracts native drag regions${where}`);
        assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-window-drag]')).webkitAppRegion`), windows ? 'none' : 'drag',
          `the host header keeps its native drag region${where}`);
        assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('[data-window-drag] button')).webkitAppRegion`), windows ? 'none' : 'no-drag',
          `the header action remains interactive${where}`);
        assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('#portal')).webkitAppRegion`), windows ? 'none' : 'no-drag',
          `unrelated body portals keep the host exclusion${where}`);
        for (const selector of ['#page', '#column', '#tree', '#files', '#team', '#short']) {
          assert.equal(await page.evaluate(`document.querySelector('${selector}').hasAttribute(${JSON.stringify(SURFACE)})`), true,
            `${selector}${where} is a pill surface`);
        }
        assert.equal(await page.evaluate(`document.querySelector('#plain').hasAttribute(${JSON.stringify(SURFACE)})`), false,
          `a box outside the sheet's scope is not a pill surface${where}`);
        assert.equal(await page.evaluate(`document.querySelectorAll(${JSON.stringify(PILL)}).length`), 6,
          `one pill per tracked surface, overflowing or not${where}`);

        /* Geometry: each overflowing surface has a pill on its own thumb — the
           capped length, centred on where the painted thumb would have been. */
        for (const selector of ['#page', '#column', '#tree', '#files', '#team']) {
          const want = await page.evaluate(expected(selector));
          assert.ok(want.range > 1, `${selector}${where} overflows`);
          const found = await page.evaluate(`(${pillOn(selector)})`);
          assert.equal(found.length, 1, `exactly one pill sits on ${selector}${where}`);
          const pill = found[0];
          assert.equal(pill.width, 4, `the pill is 4px wide${where}`);
          /* Capped, floored, or taken from the thumb as it is — the module's
             own rule, read off the surface it is drawing for. */
          assert(Math.abs(pill.height - want.length) < 0.5,
            `the pill is ${want.length}px long on ${selector}${where} (${pill.height})`);
          assert(pill.height <= 96, `and never longer than the cap on ${selector}${where}`);
          assert(pill.height >= 36, `nor shorter than the floor on ${selector}${where}`);
        }

        /* A surface that only just overflows is where the pill earns its keep:
           the thumb it stands in for is taller than the pill is allowed to be. */
        const pageWant = await page.evaluate(expected('#page'));
        assert(pageWant.thumb > 96, `the page's own thumb would be long (${pageWant.thumb})`);
        assert.equal((await page.evaluate(`(${pillOn('#page')})`))[0].height, 96,
          `and the pill that replaces it is the capsule${where}`);
        /* A transcript with many screens behind it paints a short thumb, and the
           pill stops at the floor rather than shrinking to a dot. */
        for (const selector of ['#files', '#team']) {
          const want = await page.evaluate(expected(selector));
          assert(want.thumb < 36, `${selector}'s own thumb would be short (${want.thumb})`);
          assert.equal((await page.evaluate(`(${pillOn(selector)})`))[0].height, 36,
            `and the pill stops at the floor${where}`);
        }

        /* A surface with nothing to scroll carries none, and keeps the mark. */
        assert.equal(await page.evaluate(`document.querySelector('#short').hasAttribute(${JSON.stringify(SURFACE)})`), true,
          `a short surface is still tracked${where}`);
        assert.equal(await page.evaluate(`${pills}.filter(pill => pill.display !== 'none').length`), 5,
          `only the overflowing surfaces show a pill${where}`);

        /* At rest nothing is painted. */
        assert.equal(await page.evaluate(`${pills}.filter(pill => pill.opacity > 0).length`), 0,
          `no pill is painted at rest${where}`);

        /* Moving one surface brings its pill in, and leaves the others out. */
        await page.evaluate(`document.querySelector('#page').scrollTop = 400`);
        await wait(page, 60);
        const moving = await page.evaluate(pillOn('#page'));
        assert.equal(moving.length, 1, `the moved surface keeps its pill${where}`);
        await wait(page, 300);
        assert.equal((await page.evaluate(pillOn('#page')))[0].opacity, 1,
          `the pill of a moving surface is painted${where}`);
        assert.equal(await page.evaluate(`${pills}.filter(pill => pill.opacity > 0).length`), 1,
          `and no other pill is${where}`);
        /* The mark is on the pill, not on the surface: the surface's own track
           stays empty, which is what the sheet reads. */
        assert.equal(await page.evaluate(`document.querySelector('#page').hasAttribute(${JSON.stringify(SCROLLING)})`), false,
          `a pill surface carries no ink mark of its own${where}`);

        /* The idle fade takes it away again. */
        await wait(page, 1200);
        assert.equal(await page.evaluate(`${pills}.filter(pill => pill.opacity > 0).length`), 0,
          `the pill fades once the surface is still${where}`);

        /* A scroller outside the tracked five is marked instead, so the sheet's
           own ink is what appears there. */
        await page.evaluate(`document.querySelector('#plain').scrollTop = 400`);
        await wait(page, 60);
        assert.equal(await page.evaluate(`document.querySelector('#plain').hasAttribute(${JSON.stringify(SCROLLING)})`), true,
          `an untracked scroller is marked while it moves${where}`);
        assert.equal(await page.evaluate(`${pills}.filter(pill => pill.opacity > 0).length`), 0,
          `and no pill appears for it${where}`);
        assert.equal(await page.evaluate(`${pills}.length`), 6, `the layer holds no pill for it${where}`);

        /* Content growth re-places the pill without a scroll event. */
        await page.evaluate(`
          const surface = document.querySelector('#files');
          surface.firstElementChild.insertAdjacentHTML('beforeend', '<p style="margin:0 0 10px">grown</p>'.repeat(20));
        `);
        await wait(page, 60);
        const grown = await page.evaluate(pillOn('#files', where));
        assert.equal(grown.length, 1, `the pill follows content growth${where}`);

        /* Disposal leaves the document as it found it. */
        await page.evaluate(`
          document.querySelector('#plain').removeAttribute(${JSON.stringify(SCROLLING)});
          window.release();
        `);
        assert.equal(await page.evaluate(`document.querySelectorAll(${JSON.stringify(PILL)}).length`), 0,
          `disposing removes every pill${where}`);
        assert.equal(await page.evaluate(`document.querySelectorAll(${JSON.stringify(LAYER)}).length`), 0,
          `and the layer${where}`);
        assert.equal(await page.evaluate(`
          [...document.querySelectorAll('[${SURFACE}]')].length + [...document.querySelectorAll('[${SCROLLING}]')].length
        `), 0, `and every mark it wrote${where}`);
        assert.deepEqual(await page.evaluate('window.errors'), [], `the module reported no observer failure${where}`);
      });
    } finally {
      await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 });
    }
  }
});
