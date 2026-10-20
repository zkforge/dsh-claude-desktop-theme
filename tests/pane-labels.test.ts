import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { paneLabels, paneLanguage } from '../src/client/compat/pane-labels.ts';

/*
 * The right panel's own words (DESIGN.md §6.9).
 *
 * The Files card, its filter field, its tree control, its landing state, a
 * pane's ⋮ menu, the browser's toolbar and the capture menu all draw copy DSH
 * has no string for. `compat/pane-labels.ts` holds those words; this file pins
 * the rule that picks a table, the shape of the tables and the fact that both
 * of them are complete — a missing key would print `undefined` on a real
 * control rather than fail to compile.
 *
 * Two facts are asserted beyond the copy itself:
 * - the rule is the one `compat/header-labels.ts` and the permission card
 *   follow: a Chinese document takes Chinese, everything else takes English;
 * - the English table keeps the reference's wording verbatim, because
 *   DESIGN.md quotes those strings as the reference's own.
 */

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const languageDouble = (lang: string) =>
  ({ documentElement: { lang } }) as unknown as Document;

const FILES_KEYS = [
  'title', 'filter', 'filterLabel', 'clear', 'hide', 'show', 'noMatch', 'emptyTitle', 'emptyBody',
] as const;
const CHROME_KEYS = [
  'more', 'expand', 'restore', 'search', 'reload', 'back', 'forward', 'pick', 'pickNotice', 'address',
  'terminal', 'terminals', 'newTerminal', 'closeTab', 'refresh', 'openFolder', 'hideSidebar', 'close',
] as const;
const BROWSER_KEYS = ['newTab', 'tabs', 'saveScreenshot', 'awaitingServer', 'enterAddress'] as const;

test('a Chinese document takes the Chinese table, the same rule as the header’s labels', () => {
  for (const lang of ['zh', 'zh-CN', 'zh-Hans-CN', 'ZH-cn']) {
    assert.equal(paneLanguage(languageDouble(lang)), 'zh', lang);
    assert.equal(paneLabels(paneLanguage(languageDouble(lang))).files.title, '文件', lang);
  }
  /* Without a language of its own the document falls through to the ambient
     one, which in a renderer is always there and under Node is whatever the
     runner's `LANG` says — so the fallback is taken out of the way for that one
     case rather than letting the assertion describe the machine. */
  const ambient = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: undefined, configurable: true });
  try {
    assert.equal(paneLanguage(languageDouble('')), 'en');
  } finally {
    if (ambient === undefined) delete (globalThis as { navigator?: unknown }).navigator;
    else Object.defineProperty(globalThis, 'navigator', ambient);
  }
  for (const lang of ['en', 'en-US', 'de', 'ja']) {
    assert.equal(paneLanguage(languageDouble(lang)), 'en', lang);
  }
});

test('both tables are complete, and no entry is empty or a leftover', () => {
  for (const language of ['zh', 'en'] as const) {
    const labels = paneLabels(language);
    assert.deepEqual(Object.keys(labels.files).sort(), [...FILES_KEYS].sort(), language);
    assert.deepEqual(Object.keys(labels.chrome).sort(), [...CHROME_KEYS].sort(), language);
    assert.deepEqual(Object.keys(labels.browser).sort(), [...BROWSER_KEYS].sort(), language);
    for (const table of [labels.files, labels.chrome, labels.browser]) {
      for (const [key, value] of Object.entries(table)) {
        assert.equal(typeof value, 'string', `${language}.${key}`);
        assert.notEqual(value.trim(), '', `${language}.${key} is written`);
      }
    }
  }
});

test('the English table restates the reference’s words, so nothing drifts silently', () => {
  const labels = paneLabels('en');
  assert.equal(labels.files.title, 'Files');
  assert.equal(labels.files.filter, 'Filter, or ? to search in files');
  assert.equal(labels.files.emptyTitle, 'Open files appear here');
  assert.equal(labels.files.emptyBody, 'Pick a file in the tree, or click a file path in the conversation.');
  assert.equal(labels.browser.saveScreenshot, 'Save screenshot');
  assert.equal(labels.browser.awaitingServer, 'Awaiting server…');
  assert.equal(labels.browser.enterAddress, 'Enter URL');
});

test('the Chinese table translates every English word, not just the visible ones', () => {
  /* Every control a Chinese document draws is Chinese: the two tables share a
     key set, and no Chinese value may be its English twin. The terminal's own
     prefix is the one word that may repeat inside the table (the card title and
     the multi-tab group are the same word in Chinese). */
  const zh = paneLabels('zh');
  const en = paneLabels('en');
  for (const table of ['files', 'chrome', 'browser'] as const) {
    const englishTable = en[table] as unknown as Record<string, string>;
    for (const [key, value] of Object.entries(zh[table])) {
      const english = englishTable[key] ?? '';
      assert.notEqual(value, english, `${table}.${key} is translated`);
      assert.doesNotMatch(value, /^[A-Za-z][A-Za-z ]*$/u, `${table}.${key} is not English`);
    }
  }
  assert.equal(zh.chrome.terminal, '终端');
  assert.equal(zh.chrome.terminals, '终端');
  /* The placeholders use no ASCII word, so no stray `Filter` can survive. */
  assert.equal(zh.files.filter, '过滤文件，或按 ? 在文件内容中搜索');
});

test('the whole right panel reads its words from this table', () => {
  for (const file of ['files-pane.ts', 'pane-chrome.ts', 'browser-menu.ts', 'right-panes.ts']) {
    const source = read(`../src/client/compat/${file}`);
    assert.match(source, /from '\.\/pane-labels\.ts'/u, `${file} takes its copy from the table`);
  }
});
