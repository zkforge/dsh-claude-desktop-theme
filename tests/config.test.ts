import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adoptConfig, DEFAULT_APPEARANCE, DEFAULT_FONTS, normalizeColour, normalizeFontName, resolveConfig,
} from '../src/shared/config.ts';

test('colours normalize to one spelling and reject everything else', () => {
  assert.equal(normalizeColour('#ABC'), '#aabbcc');
  assert.equal(normalizeColour('  #AABBCC  '), '#aabbcc');
  assert.equal(normalizeColour('#abcdef'), '#abcdef');
  assert.equal(normalizeColour('red'), '');
  assert.equal(normalizeColour('#12345'), '');
  assert.equal(normalizeColour(''), '');
  assert.equal(normalizeColour(12), '');
});

test('font names keep one family and drop anything that could be a stack or a request', () => {
  assert.equal(normalizeFontName('  PingFang   SC '), 'PingFang SC');
  assert.equal(normalizeFontName('"JetBrains Mono"'), 'JetBrains Mono');
  assert.equal(normalizeFontName('思源黑体'), '思源黑体');
  assert.equal(normalizeFontName('Inter, sans-serif'), '');
  assert.equal(normalizeFontName('url(https://example.com/a.woff2)'), '');
  assert.equal(normalizeFontName('Bad;Name'), '');
  assert.equal(normalizeFontName('name}html{'), '');
  assert.equal(normalizeFontName('x'.repeat(65)), '');
  assert.equal(normalizeFontName('x'.repeat(64)), 'x'.repeat(64));
});

test('adopted configuration falls back to the defaults instead of failing activation', () => {
  const config = adoptConfig({
    enabled: 'yes',
    appearance: { canvas: '#ABC', sidebar: 'red' },
    fonts: { uiLatin: 'Newsreader', uiCjk: 'Bad;Name', code: 7 },
    unknown: true,
  });
  assert.equal(config.enabled, false);
  assert.deepEqual(config.appearance, { canvas: '#aabbcc', sidebar: '' });
  assert.deepEqual(config.fonts, { uiLatin: 'Newsreader', uiCjk: '', code: '' });
});

test('adoption survives a missing, null or misshapen section', () => {
  for (const value of [undefined, null, 'text', 3, { appearance: null, fonts: [] }]) {
    const config = adoptConfig(value);
    assert.deepEqual(config.appearance, DEFAULT_APPEARANCE);
    assert.deepEqual(config.fonts, DEFAULT_FONTS);
    assert.equal(config.enabled, false);
  }
});

test('the strict resolver reports unusable values with their path', () => {
  assert.throws(() => resolveConfig({ appearance: { canvas: 'red' } }), /appearance\.canvas/);
  assert.throws(() => resolveConfig({ fonts: { code: 'a;b' } }), /fonts\.code/);
  assert.throws(() => resolveConfig({ appearance: { canvas: 1 } }), /appearance\.canvas must be a string/);
  assert.throws(() => resolveConfig({ fonts: { uiCjk: null } }), /fonts\.uiCjk must be a string/);
});

test('a default configuration keeps every built-in', () => {
  const config = resolveConfig();
  assert.deepEqual(config.appearance, DEFAULT_APPEARANCE);
  assert.deepEqual(config.fonts, DEFAULT_FONTS);
  assert.equal(config.features.sidebar, true);
  assert.equal(config.features.statistics, false);
  assert.equal(config.features['composer-stats'], false);
  /* The context breakdown panel is on out of the box: it is the ring's own
     reading, and the ring is DSH's control rather than one this plugin adds. */
  assert.equal(config.features['context-panel'], true);
  assert.equal(adoptConfig({ features: { 'context-panel': 'yes' } }).features['context-panel'], true,
    'a hand-edited value falls back to the default rather than failing activation');
  assert.equal(adoptConfig({ features: { 'context-panel': false } }).features['context-panel'], false);
});

test('sidebar branding defaults off, persists explicit choices and rejects invalid writes', () => {
  assert.equal(resolveConfig().view.showSidebarBrand, false);
  assert.equal(adoptConfig({}).view.showSidebarBrand, false);
  for (const showSidebarBrand of [true, false]) {
    const options = { view: { showSidebarBrand } };
    assert.equal(resolveConfig(options).view.showSidebarBrand, showSidebarBrand);
    assert.equal(adoptConfig(options).view.showSidebarBrand, showSidebarBrand);
  }
  assert.equal(adoptConfig({ view: { showSidebarBrand: 'true' } }).view.showSidebarBrand, false);
  assert.throws(() => resolveConfig({ view: { showSidebarBrand: 'true' } }), /view.showSidebarBrand/);
});

test('hero ripples default on and can be disabled independently of the new-session layout', () => {
  assert.equal(resolveConfig().features['hero-ripples'], true);
  assert.equal(adoptConfig({}).features['hero-ripples'], true);
  for (const enabled of [true, false]) {
    const options = { features: { 'hero-ripples': enabled } };
    for (const config of [resolveConfig(options), adoptConfig(options)]) {
      assert.equal(config.features['hero-ripples'], enabled);
      assert.equal(config.features['new-session'], true);
    }
  }
  assert.equal(adoptConfig({ features: { 'hero-ripples': 'false' } }).features['hero-ripples'], true);
  assert.throws(() => resolveConfig({ features: { 'hero-ripples': 'false' } } as never), /features\.hero-ripples/);
});


test('model icons default on, preserve explicit choices and reject invalid writes', () => {
  assert.equal(resolveConfig().view.showModelIcons, true);
  assert.equal(adoptConfig({}).view.showModelIcons, true);
  for (const showModelIcons of [true, false]) {
    const options = { view: { showModelIcons } };
    assert.equal(resolveConfig(options).view.showModelIcons, showModelIcons);
    assert.equal(adoptConfig(options).view.showModelIcons, showModelIcons);
  }
  assert.equal(adoptConfig({ view: { showModelIcons: 'false' } }).view.showModelIcons, true);
  assert.throws(() => resolveConfig({ view: { showModelIcons: 'false' } }), /view.showModelIcons/);
});
