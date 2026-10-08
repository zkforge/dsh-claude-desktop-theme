import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Same optional browser coverage as the other compat modules. */ }

/*
 * The transcript's markdown overrides, measured against the reference crop.
 *
 * The unit tests next door can read a stylesheet but not lay one out, and this
 * sheet is all about layout: a heading's leading decides the gap under it, the
 * code card is a flex row whose floor is a width, and a quote's ink and rule are
 * two different properties. So the fixture below is the host's own DOM and the
 * host's own rules — copied from `MarkdownText.module.css`, `CodeBlock.module.css`
 * and `CodeCard.module.css` of DSH `0.2.0-rc.2`, hashed class names included, so
 * the plugin's rules compete at the specificity they really face — and the
 * assertions are the reference's own measurements, converted at its @2x
 * capture (a device pixel is 1.5 CSS px here).
 *
 * The reference values each assertion comes from are in the comment beside it;
 * they are the same numbers `DESIGN.md` §6.6 records.
 */
const PLUGIN_SHEETS = [
  'src/client/theme/tokens.css',
  'src/client/features/conversation/conversation.css',
];
const pluginCss = PLUGIN_SHEETS
  .map(path => readFileSync(join(root, path), 'utf8'))
  .join('\n');

/** The host's own values for everything the copied rules reference. */
const HOST_TOKENS = `
  :root {
    --dsw-font-family: system-ui, sans-serif;
    --ds-font-family-code: ui-monospace, monospace;
    --dsw-radius-sm: 8px;
    --dsw-radius-lg: 16px;
    --dsw-alias-bg-base: #fcfcfb;
    --dsw-alias-label-primary: #0f1115;
    --dsw-alias-label-secondary: #61666b;
    --dsw-alias-label-tertiary: #81858c;
    --dsw-alias-label-caption: #adb2b8;
    --dsw-alias-link: #4176e6;
    --dsw-alias-border-l1: #0000000a;
    --dsw-alias-border-l2: #0000001a;
    --dsw-alias-border-l3: #0000001f;
    --dsw-alias-markdown-inline-code: #fafafa;
    --dsw-alias-markdown-code-block: #f9fafb;
    --dsw-alias-markdown-code-block-banner: #f9fafb;
    --dsw-font-markdown-base: 14px/24px var(--dsw-font-family);
    --dsw-font-markdown-h1: 700 21px/30px var(--dsw-font-family);
    --dsw-font-markdown-h2: 700 19px/28px var(--dsw-font-family);
    --dsw-font-markdown-h3: 700 18px/26px var(--dsw-font-family);
    --dsw-font-markdown-code-block: 11px/19px var(--ds-font-family-code);
    --dsl-code-block-background: var(--dsw-alias-markdown-code-block);
    --dsl-code-block-banner-background-color: var(--dsw-alias-markdown-code-block-banner);
    --dsl-code-block-banner-font: 11px/18px var(--dsw-font-family);
    --dsl-code-block-content-font: var(--dsw-font-markdown-code-block);
    --dsl-code-block-border-radius: var(--dsw-radius-lg);
  }
`;

/** The host's markdown, code-block and code-card rules, verbatim. */
const HOST_CSS = `
  .gKv1-q_root { font-size: 14px; line-height: 24px; color: var(--dsw-alias-label-primary); }
  ._markdown_1ypvv_5 { min-width: 0; overflow-wrap: anywhere; font: var(--dsw-font-markdown-base); color: var(--dsw-alias-label-primary); }
  ._markdown_1ypvv_5 h1 { font: var(--dsw-font-markdown-h1); margin: 32px 0 16px; }
  ._markdown_1ypvv_5 h2 { font: var(--dsw-font-markdown-h2); margin: 32px 0 16px; }
  ._markdown_1ypvv_5 h3 { font: var(--dsw-font-markdown-h3); margin: 32px 0 16px; }
  ._markdown_1ypvv_5 p { margin: 16px 0; }
  ._markdown_1ypvv_5 a, ._markdown_1ypvv_5 ._fileLink_1ypvv_59 {
    color: var(--dsw-alias-link); font-weight: 500; text-decoration: none;
    border-left: 3px solid rgb(255 255 255 / 0); border-right: 3px solid rgb(255 255 255 / 0);
    border-top: 2px solid rgb(255 255 255 / 0); border-bottom: 2px solid rgb(255 255 255 / 0);
    margin-left: -3px; margin-right: -3px;
  }
  ._linkIcon_1ypvv_94 { flex: none; width: 1.1em; height: 1.1em; vertical-align: -0.25em; margin-right: 5px; }
  ._markdown_1ypvv_5 :where(ul, ol) { margin: 16px 0; padding-left: 18px; }
  ._markdown_1ypvv_5 li:not(:first-child) { margin-top: 6px; }
  ._markdown_1ypvv_5 li::marker { line-height: 24px; color: var(--dsw-alias-label-secondary); }
  ._markdown_1ypvv_5 li > *:first-child { margin-top: 0; }
  ._markdown_1ypvv_5 li > *:last-child:not(.md-code-block) { margin-bottom: 0; }
  ._markdown_1ypvv_5 li > p { margin: 8px 0; }
  ._markdown_1ypvv_5 blockquote { border-left: 2px solid var(--dsw-alias-label-caption); margin: 16px 0 0; padding-left: 14px; }
  ._markdown_1ypvv_5 hr { display: block; border: none; height: 0.5px; margin: 32px 0; background: var(--dsw-alias-border-l2); }
  ._markdown_1ypvv_5 input[type=checkbox] { margin: 0 8px 0 0; accent-color: var(--dsw-alias-label-secondary); }
  ._markdown_1ypvv_5 > *:first-child, ._markdown_1ypvv_5 p:first-child { margin-top: 0 !important; }
  ._markdown_1ypvv_5 > *:last-child, ._markdown_1ypvv_5 p:last-child { margin-bottom: 0 !important; }
  ._markdown_1ypvv_5 :not(pre) > code {
    display: inline-flex; align-items: center; box-sizing: border-box;
    font-size: 0.875em !important; background-color: var(--dsw-alias-markdown-inline-code);
    border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm); padding: 0 5px;
  }
  ._markdown_1ypvv_5 table { border-collapse: collapse; width: 100%; }
  ._markdown_1ypvv_5 th { text-align: start; padding: 10px 16px; border-bottom: 0.5px solid var(--dsw-alias-border-l3); border-top: none; }
  ._markdown_1ypvv_5 td { padding: 10px 16px; border-bottom: 0.5px solid var(--dsw-alias-border-l2); }
  ._markdown_1ypvv_5 th:first-child, ._markdown_1ypvv_5 td:first-child { padding-left: 0; }
  ._markdown_1ypvv_5 td:last-child { padding-right: 0; }
  ._block_7gxqk_4 {
    position: relative; margin: 16px 0; color: var(--dsw-alias-label-primary);
    background: var(--dsl-code-block-background); border-radius: var(--dsl-code-block-border-radius);
  }
  ._block_7gxqk_4:not(:last-child) { margin-bottom: 11px; }
  ._bannerWrap_7gxqk_24 {
    position: sticky; top: 0; z-index: 6; background-color: var(--dsw-alias-bg-base);
    border-top-left-radius: var(--dsl-code-block-border-radius); border-top-right-radius: var(--dsl-code-block-border-radius);
  }
  ._banner_7gxqk_24 {
    background: var(--dsl-code-block-banner-background-color); padding: 9px 14px; display: flex;
    justify-content: space-between; align-items: center; gap: 12px; font: var(--dsl-code-block-banner-font);
    border-top-left-radius: var(--dsl-code-block-border-radius); border-top-right-radius: var(--dsl-code-block-border-radius);
  }
  ._content_7gxqk_74 { display: contents; }
  ._block_7gxqk_4 :where(pre) {
    font: var(--dsl-code-block-content-font); padding: 16px; margin: 0 !important;
    overflow-x: auto; white-space: pre-wrap; word-break: break-all; background: var(--dsl-code-block-background);
    border-bottom-left-radius: var(--dsl-code-block-border-radius); border-bottom-right-radius: var(--dsl-code-block-border-radius);
  }
  ._block_7gxqk_4 :where(pre) code { font: inherit; background: none; padding: 0; }
  ._card_7gxqk_107 :where(pre) { padding: 6px 22px 20px; word-break: normal; overflow-wrap: anywhere; }
  ._card_1pq26_1 {
    position: relative; margin: 16px 0; color: var(--dsw-alias-label-primary);
    background: var(--dsw-alias-markdown-code-block); border-radius: var(--dsw-radius-lg);
    font: var(--dsw-font-markdown-code-block);
  }
  ._header_1pq26_10 {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 18px 8px 22px;
    background: var(--dsl-code-block-background); border-top-left-radius: inherit; border-top-right-radius: inherit;
    color: var(--dsw-alias-label-secondary); font: 11px/18px var(--dsw-font-family);
  }
  ._heading_1pq26_23 { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
  ._language_1pq26_30 { color: var(--dsw-alias-label-tertiary); flex: none; font-family: var(--ds-font-family-code); }
  ._actions_1pq26_43 { display: flex; align-items: center; gap: 4px; flex: none; }
  ._action_1pq26_43 {
    display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
    padding: 0; border: 0; border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-secondary); background: transparent;
  }
  ._body_1pq26_79 { padding: 6px 22px 20px; font: var(--dsw-font-markdown-code-block); overflow-x: auto; }
`;

/*
 * The host's DOM, in the shape its own components render: a heading pair, a
 * paragraph whose link carries the category glyph, a quote, a tight list, a
 * GFM task list (the checkbox is the item's first child, as the renderer emits
 * it), a table, and one code card in the toolbar shape the transcript uses
 * (`CodeToolbar` puts the language in a leading group and the controls in a
 * trailing one, and stamps `data-code-block-banner` on their row).
 */
const HOST_DOM = `
<div class="gKv1-q_root" style="width:770px">
  <div class="_markdown_1ypvv_5" style="padding:0">
    <h1 id="h1">标题一级</h1>
    <h2 id="h2">二级标题</h2>
    <h3 id="h3">三级标题</h3>
    <p id="para">普通段落文字，带<a id="link" href="https://example.com"><svg class="_linkIcon_1ypvv_94" viewBox="0 0 16 16"></svg>外链</a>。</p>
    <p id="para2">第二段用来量段落间距的文字。这一段要长到能在栏宽里折行，所以它多写了一些话，好让同一段里两行之间的距离可以被量出来——折行之后每一行仍然走同一条行距，段落之间则多出两侧边距合并之后的那一段。</p>
    <blockquote id="quote"><p id="quoteText">引用块：一句被引用的说明。</p></blockquote>
    <ul id="list"><li id="listItem1">无序列表</li><li id="listItem2">另一项</li></ul>
    <ul id="tasks">
      <li id="task1"><input type="checkbox" checked disabled>已完成</li>
      <li id="task2"><input type="checkbox" disabled>待办</li>
    </ul>
    <table id="table"><thead><tr><th id="th1">列 A</th><th>列 B</th></tr></thead><tbody><tr><td>值 1</td><td>值 2</td></tr></tbody></table>
    <div class="_block_7gxqk_4 md-code-block _card_7gxqk_107" id="code" data-code-wrap="true">
      <div class="_bannerWrap_7gxqk_24">
        <div class="_header_1pq26_10" id="codeBanner" data-code-block-banner>
          <div class="_heading_1pq26_23"><span class="_language_1pq26_30">ts</span></div>
          <div class="_actions_1pq26_43"><button class="_action_1pq26_43" id="codeCopy" aria-label="复制"></button></div>
        </div>
      </div>
      <div class="_content_7gxqk_74" data-code-block-content>
        <pre id="codePre"><code>const demo = "代码块";</code></pre>
      </div>
    </div>
  </div>
</div>`;

/** Every number below is a `getBoundingClientRect`/computed value in CSS px. */
const MEASURE = `(() => {
  const rect = id => document.getElementById(id).getBoundingClientRect();
  const style = (id, property) => getComputedStyle(document.getElementById(id)).getPropertyValue(property);
  const card = rect('code');
  const pre = rect('codePre');
  const copy = rect('codeCopy');
  return {
    h1Size: style('h1', 'font-size'), h2Size: style('h2', 'font-size'), h3Size: style('h3', 'font-size'),
    headingGap: Math.round(rect('h2').top - rect('h1').bottom),
    bodyLine: style('para', 'line-height'),
    paraGap: Math.round(rect('para2').top - rect('para').bottom),
    para2Height: Math.round(rect('para2').height),
    tableRow: Math.round(rect('th1').height),
    quoteRule: style('quote', 'border-left-width'),
    quoteRuleColour: style('quote', 'border-left-color'),
    quotePadding: style('quote', 'padding-left'),
    quoteInk: style('quoteText', 'color'),
    taskStyle: style('task1', 'list-style-type'),
    taskPitch: Math.round(rect('task2').top - rect('task1').top),
    listPitch: Math.round(rect('listItem2').top - rect('listItem1').top),
    linkIcon: getComputedStyle(document.querySelector('._linkIcon_1ypvv_94')).display,
    cardHeight: Math.round(card.height),
    cardWidth: Math.round(card.width),
    cardFill: style('code', 'background-color'),
    labelDisplay: getComputedStyle(document.querySelector('#codeBanner > :first-child')).display,
    preSize: style('codePre', 'font-size'),
    preLine: style('codePre', 'line-height'),
    codeInset: Math.round(document.querySelector('#codePre code').getBoundingClientRect().left - card.left),
    controlInset: Math.round(card.right - copy.right),
    controlTop: Math.round(copy.top - card.top),
    tableHeadFill: getComputedStyle(document.querySelector('#table th')).backgroundColor,
  };
})()`;

test('the transcript markdown overrides lay out the way the reference crop measures', {
  skip: chrome ? false : 'Chrome unavailable; set CHROME to run browser coverage', timeout: 30000,
}, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'ccd-markdown-test-'));
  try {
    await withPage({ url: 'about:blank', width: 1374, height: 871, scale: 1, profile }, async page => {
      await page.evaluate(`(() => {
        document.documentElement.setAttribute('data-dsh-ccd-style', 'true');
        document.body.style.margin = '0';
        document.body.innerHTML = ${JSON.stringify(HOST_DOM)};
        const sheet = document.createElement('style');
        sheet.textContent = ${JSON.stringify(`${HOST_TOKENS}${HOST_CSS}${pluginCss}`)};
        document.head.append(sheet);
      })()`);
      const on = await page.evaluate(MEASURE);

      /* Headings: the reference draws h1/h2/h3 at 19/16/15px over a 14px body
         (its crop's CJK ink is 27/23 device px against the body's 21) and puts
         20 device px of ink between two stacked headings — 8px of collapsed
         margin once both headings' half-leading is off. */
      assert.equal(on.h1Size, '19px', 'h1 takes the reference size, not the host 21px');
      assert.equal(on.h2Size, '16px');
      assert.equal(on.h3Size, '15px');
      assert.equal(on.headingGap, 8, 'stacked headings keep the reference gap, not the host 32px');

      /* Quote: a 4px rule in the card-outline grey (the reference measures
         #e3e3e3 and 6 device px at @2x) with its text one step down in ink. */
      assert.equal(on.quoteRule, '4px');
      assert.equal(on.quoteRuleColour, 'rgb(227, 227, 225)', 'the rule is the CCD outline, not the host mid grey');
      assert.equal(on.quotePadding, '15px');
      assert.equal(on.quoteInk, 'rgb(111, 111, 106)', 'quote text is the secondary ink, not body ink');

      /* Body leading. The reference runs its 14px body on a 20px line where the
         host draws 24px — two lines of one paragraph sit 30.7 device px apart in
         its window against this plugin's 36.6 — and its 46-device-px paragraph
         gap is that 20px line plus the 10px margin both sides already share.
         The host's own 16px paragraph margin is the off state below. */
      assert.equal(on.bodyLine, '20px', 'the transcript takes the reference leading, not the host 24px');
      assert.equal(on.paraGap, 10, 'a paragraph break keeps the reference 10px margin');
      assert.equal(on.para2Height % 20, 0, 'a wrapped paragraph runs on that same leading');
      assert.ok(on.para2Height >= 40, `the fixture paragraph wraps, got ${on.para2Height}px`);

      /* Task list: the reference draws the checkbox alone where the host leaves
         the marker and its 6px item margin. */
      assert.equal(on.taskStyle, 'none', 'a task row draws no list marker');
      assert.equal(on.taskPitch, 20, 'a task row is one line of the transcript');
      assert.equal(on.listPitch, 26, 'an ordinary list item keeps the host 6px margin on that line');

      /* Link: the reference draws link text alone, with no category glyph. */
      assert.equal(on.linkIcon, 'none');

      /* Code card: the reference's one-line fence is a single 33px row (50
         device px at @2x) floored at 320px wide, with the code 17px in (26
         device px) and the controls 12px off the trailing edge (18 device px). */
      assert.ok(Math.abs(on.cardHeight - 33) <= 1, `a one-line card is one row, got ${on.cardHeight}px`);
      assert.equal(on.cardWidth, 320, 'a short fence is floored at the reference width, not filled to the column');
      assert.equal(on.labelDisplay, 'none', 'the language label is not painted');
      assert.equal(on.preSize, '13px', 'code takes the reference size, not the host 11px');
      assert.equal(on.preLine, '19px', 'the host line survives the size override');
      assert.equal(on.codeInset, 17);
      assert.equal(on.controlInset, 12);
      assert.ok(on.controlTop < 6, `the controls ride the first code line, got ${on.controlTop}px down`);

      /* Table: untouched, and still the CCD card (the row keeps the host's
         padding through the plugin's own cell rule). The reference's own head
         fill measures #efefef at @2x, which is this raised step. The row is the
         51 device px both shots measure, paid as the transcript's 20px line
         plus 6px of cell padding a side. */
      assert.equal(on.tableHeadFill, 'rgb(240, 240, 239)', 'the head keeps the CCD raised fill');
      assert.equal(on.tableRow, 33, 'the row keeps the reference height under the tighter leading');

      /* With the gate off the sheet must not reach the host at all. */
      await page.evaluate(`document.documentElement.removeAttribute('data-dsh-ccd-style')`);
      const off = await page.evaluate(MEASURE);
      assert.equal(off.h1Size, '21px', 'the host ladder returns untouched');
      assert.equal(off.headingGap, 32);
      assert.equal(off.bodyLine, '24px', 'the host leading returns');
      assert.equal(off.paraGap, 16);
      assert.equal(off.para2Height % 24, 0);
      assert.ok(off.tableRow > 40, `the host cell padding returns, got ${off.tableRow}px`);
      assert.equal(off.quoteRule, '2px');
      assert.equal(off.taskStyle, 'disc');
      assert.equal(off.labelDisplay, 'flex', 'the language label comes back');
      assert.equal(off.cardWidth, 770, 'the card fills the column again');
      assert.notEqual(off.linkIcon, 'none');
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
