import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserHeaderWord, mountBrowserHeader } from '../src/client/compat/browser-header.ts';

/*
 * The browsing region's title line.
 *
 * The reference names this region 最近会话 / Recents. DSH serves its own word —
 * `section.sessions` for a flat list, `section.workspaces` for a grouped tree —
 * and the plugin replaces only those two strings: a locale it has never seen
 * keeps the host's own heading, and a heading the host did not serve (another
 * skin's, or the plugin's own) is never rewritten a second time. The grouped
 * heading takes the reference's name only while the region is showing the
 * no-history prompt, which is the one state the reference draws without groups.
 */

test('the browsing region takes the reference word, and only over the host’s own', () => {
  assert.equal(browserHeaderWord('会话'), '最近会话');
  assert.equal(browserHeaderWord('Sessions'), 'Recents');
  assert.equal(browserHeaderWord('工作区'), '最近会话');
  assert.equal(browserHeaderWord('Workspaces'), 'Recents');
  assert.equal(browserHeaderWord('最近会话'), null, 'the plugin’s own word is not rewritten again');
  assert.equal(browserHeaderWord('Sitzungen'), null, 'a locale this module does not know is left alone');
  assert.equal(browserHeaderWord(''), null);
  assert.equal(browserHeaderWord('会话 '), null, 'only the host’s exact string is replaced');
});

test('sidebar label replacements release disconnected text records during the mount', () => {
  const oldMutation = globalThis.MutationObserver;
  const oldFilter = globalThis.NodeFilter;
  let mutate = () => {};
  globalThis.MutationObserver = class {
    constructor(callback: () => void) { mutate = callback; }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  globalThis.NodeFilter = { SHOW_TEXT: 4 } as typeof NodeFilter;
  let connected = true, reads = 0;
  const previous = { data: 'Sessions', get isConnected() { reads++; return connected; } };
  const current = { data: 'Sessions', isConnected: true };
  let text = previous;
  const doc = {
    documentElement: {},
    body: {},
    querySelector: (selector: string) => selector.includes('data-ccd-empty-state') || selector.includes('data-slot="root"') ? null : {},
    createTreeWalker: () => {
      let first = true;
      return { nextNode: () => { if (!first) return null; first = false; return text; } };
    },
  } as unknown as Document;
  const errors: unknown[] = [];
  try {
    const dispose = mountBrowserHeader(doc, error => errors.push(error));
    assert.equal(previous.data, 'Recents');
    connected = false; text = current; mutate();
    assert.equal(current.data, 'Recents');
    const afterPruning = reads;
    mutate(); mutate();
    assert.equal(reads, afterPruning, 'old text nodes are no longer retained or visited');
    dispose();
    assert.equal(current.data, 'Sessions');
    assert.deepEqual(errors, []);
  } finally {
    globalThis.MutationObserver = oldMutation;
    if (oldFilter === undefined) Reflect.deleteProperty(globalThis, 'NodeFilter');
    else globalThis.NodeFilter = oldFilter;
  }
});
