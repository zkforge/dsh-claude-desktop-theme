import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mapPrefixes, parseClassMaps, renderWindowsBuild, rewritePrefixes,
} from '../scripts/lib/host-prefixes.mjs';
import { WINDOWS_BUILD } from '../src/client/compat/host-builds.ts';

/*
 * `scripts/host-prefixes.mjs` re-reads the pinned host prefixes from a shipped
 * DSH build. Its input is a build's CSS-module maps, so the transforms are
 * tested here on maps rather than on a 120 MB `app.asar`; the reader itself was
 * checked against a real one when it was written.
 */

/** A module map as `asarModules` produces it: hash -> locals. */
function modules(entries: Record<string, readonly string[]>) {
  return new Map(Object.entries(entries).map(([hash, locals]) => [
    hash, { file: `${hash}.js`, locals: new Set(locals) },
  ]));
}

test('a bundle text is split into one entry per CSS module, by its hash', () => {
  const maps = parseClassMaps(
    '{"frame":"_6Qf49G_frame","sidebarCol":"_6Qf49G_sidebarCol"}'
    + '{"root":"_3WPZCG_root","brand":"_3WPZCG_brand"}'
    + 'var x = 1;',
  );
  assert.equal(maps.size, 2);
  assert.deepEqual([...maps.get('_6Qf49G') ?? []].sort(), ['frame', 'sidebarCol']);
  assert.deepEqual([...maps.get('_3WPZCG') ?? []].sort(), ['brand', 'root']);
});

test('pairing is the identity when the target is the reference build', () => {
  const reference = modules({ AAA111: ['root', 'brand', 'logoRow'], BBB222: ['frame', 'centerCol'] });
  const { mapping, problems } = mapPrefixes(['AAA111_', 'BBB222_'], reference, reference);
  assert.equal(problems.size, 0);
  assert.deepEqual([...mapping], [['AAA111_', 'AAA111_'], ['BBB222_', 'BBB222_']]);
});

test('pairing follows the module, not the names the plugin happens to use', () => {
  /* Two target modules both define `body`; only the one carrying the reference
     module's whole set may be chosen. */
  const reference = modules({ OLDAAA: ['root', 'body', 'footer', 'note'] });
  const target = modules({
    NEWAAA: ['root', 'body', 'footer', 'note'],
    NEWBBB: ['root', 'body'],
  });
  const { mapping, problems } = mapPrefixes(['OLDAAA_'], reference, target);
  assert.equal(problems.size, 0);
  assert.equal(mapping.get('OLDAAA_'), 'NEWAAA_');
});

test('an unpaired or ambiguous prefix is reported instead of guessed', () => {
  const reference = modules({ OLDAAA: ['root', 'body'], OLDBBB: ['panel', 'title'] });
  const target = modules({
    NEWAAA: ['root', 'body'],
    NEWBBB: ['panel', 'title'],
    NEWCCC: ['panel', 'title'],
  });
  const missing = mapPrefixes(['OLDAAA_', 'OLDMISSING_'], reference, target);
  assert.equal(missing.problems.get('OLDMISSING_'), 'the reference build has no module with this prefix');
  const ambiguous = mapPrefixes(['OLDBBB_'], reference, target);
  assert.match(ambiguous.problems.get('OLDBBB_') ?? '', /^ambiguous: NEWBBB_, NEWCCC_/u);
});

test('rewriting prefixes is one pass, so a mapping cannot chain', () => {
  const text = 'html .AAA_x .BBB_y { }';
  assert.equal(rewritePrefixes(text, new Map([['AAA_', 'BBB_'], ['BBB_', 'CCC_']])), 'html .BBB_x .CCC_y { }');
  assert.equal(rewritePrefixes(text, new Map()), text);
});

test('the rendered Windows block is sorted, quoted and complete', () => {
  const rendered = renderWindowsBuild({
    id: 'dsh-0.2.0-rc.2-04f392c9',
    frameClass: 'BynINW_frame',
    prefixes: new Map([['_6Qf49G_', 'BynINW_'], ['_3WPZCG_', '_2H3hWW_']]),
  });
  assert.match(rendered, /id: 'dsh-0\.2\.0-rc\.2-04f392c9',/u);
  assert.match(rendered, /frameClass: 'BynINW_frame',/u);
  assert.ok(rendered.indexOf("'_3WPZCG_': '_2H3hWW_'") < rendered.indexOf("'_6Qf49G_': 'BynINW_'"));
  assert.match(rendered, /^\}\);\n?$/mu);
});

test('the shipped Windows table is exactly what a re-read of its build would produce', () => {
  /* The keys are the authored prefixes and the values are that build's; a
     table missing one entry would leave that host surface unstyled. */
  const entries = Object.entries(WINDOWS_BUILD.prefixes);
  assert.equal(entries.length, 24);
  for (const [authored, actual] of entries) {
    assert.match(authored, /^[A-Za-z0-9_-]+_$/u);
    assert.match(actual, /^[A-Za-z0-9_-]+_$/u);
  }
  const rendered = renderWindowsBuild({ id: WINDOWS_BUILD.id, frameClass: WINDOWS_BUILD.frameClass, prefixes: new Map(entries) });
  assert.equal((rendered.match(/': '/gu) ?? []).length, entries.length);
});

test('a verified unchanged module hash and owner tolerate added or removed locals', () => {
  const reference = new Map([['actual', {file:'ui-layout/client.js',locals:new Set(['root','old'])}]]);
  const target = new Map([['actual', {file:'ui-layout/client.js',locals:new Set(['root','new'])}]]);
  assert.equal(mapPrefixes(['actual_'],reference,target).mapping.get('actual_'),'actual_');
  target.set('actual',{file:'unrelated/client.js',locals:new Set(['root','new'])});
  assert.equal(mapPrefixes(['actual_'],reference,target).problems.size,1);
});
