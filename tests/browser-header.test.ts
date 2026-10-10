import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserHeaderWord } from '../src/client/compat/browser-header.ts';

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
  assert.equal(browserHeaderWord('会话', false), '最近会话');
  assert.equal(browserHeaderWord('Sessions', false), 'Recents');
  assert.equal(browserHeaderWord('工作区', true), '最近会话', 'an empty grouped tree is the reference’s empty region');
  assert.equal(browserHeaderWord('Workspaces', true), 'Recents');
  assert.equal(browserHeaderWord('工作区', false), null, 'a grouped tree with something to show keeps the host’s heading');
  assert.equal(browserHeaderWord('Workspaces', false), null);
  assert.equal(browserHeaderWord('Sessions', true), 'Recents', 'the flat word is taken in every state');
  assert.equal(browserHeaderWord('最近会话', true), null, 'the plugin’s own word is not rewritten again');
  assert.equal(browserHeaderWord('Sitzungen', true), null, 'a locale this module does not know is left alone');
  assert.equal(browserHeaderWord('', true), null);
  assert.equal(browserHeaderWord('会话 ', true), null, 'only the host’s exact string is replaced');
});
