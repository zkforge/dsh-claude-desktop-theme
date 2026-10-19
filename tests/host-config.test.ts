import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Config } from '../src/host/index.ts';
import { APPEARANCE_FIELDS, DEFAULT_FEATURES, FEATURE_IDS, FONT_FIELDS } from '../src/shared/config.ts';

/*
 * The settings layer only projects volatile fields, and Cordis refuses a
 * volatile field nested inside another volatile field:
 *
 *   "$.appearance.canvas volatile fields require a fixed object path without an
 *    enclosing volatile field"
 *
 * That rejection happens at plugin activation, where it costs a whole entry, so
 * this test pins both halves of the contract: a volatile node covers its
 * subtree, and no volatile node sits inside another one.
 */

interface SchemaNode {
  readonly meta?: { readonly volatile?: boolean } | undefined;
  readonly dict?: Record<string, SchemaNode> | undefined;
  readonly inner?: SchemaNode | undefined;
  readonly list?: readonly SchemaNode[] | undefined;
}

function walk(node: SchemaNode, path: string, insideVolatile: boolean, visit: (path: string, volatile: boolean) => void): void {
  const volatile = node.meta?.volatile === true;
  if (volatile && insideVolatile) {
    assert.fail(`${path} declares volatile inside a volatile ancestor`);
  }
  visit(path, volatile);
  for (const [key, child] of Object.entries(node.dict ?? {})) {
    walk(child, `${path}.${key}`, insideVolatile || volatile, visit);
  }
  if (node.inner) walk(node.inner, `${path}[]`, insideVolatile || volatile, visit);
  for (const child of node.list ?? []) walk(child, `${path}[]`, insideVolatile || volatile, visit);
}

function editablePaths(node: SchemaNode): string[] {
  const paths: string[] = [];
  walk(node, '$', false, (path, volatile) => { if (volatile) paths.push(path); });
  return paths;
}

test('no volatile field is nested inside another volatile field', () => {
  const paths = editablePaths(Config as unknown as SchemaNode);
  assert.deepEqual(paths.filter(path => path.endsWith('[]')), []);
});

test('every editable section is reachable through exactly one volatile node', () => {
  const paths = editablePaths(Config as unknown as SchemaNode);
  for (const section of ['$.enabled', '$.debug', '$.features', '$.appearance', '$.fonts']) {
    assert.ok(paths.includes(section), `${section} must be editable`);
  }
  for (const section of ['$.features', '$.appearance', '$.fonts']) {
    const nested = paths.filter(path => path.startsWith(`${section}.`));
    assert.deepEqual(nested, [], `${section} covers its subtree; its children stay plain`);
  }
});

test('the schema declares every field the client reads and writes', () => {
  const dict = (Config as unknown as SchemaNode).dict ?? {};
  const features = dict.features?.dict ?? {};
  assert.deepEqual(Object.keys(features), [...FEATURE_IDS]);
  assert.deepEqual(Object.keys(dict.appearance?.dict ?? {}), [...APPEARANCE_FIELDS]);
  assert.deepEqual(Object.keys(dict.fonts?.dict ?? {}), [...FONT_FIELDS]);
  const defaults = (dict.features?.meta as { default?: Record<string, boolean> } | undefined)?.default;
  assert.deepEqual(defaults, { ...DEFAULT_FEATURES });
});

test('unusable values are refused at the settings boundary', () => {
  const schema = Config as unknown as (input: unknown) => unknown;
  assert.throws(() => schema({ appearance: { canvas: 'red' } }), /canvas/);
  assert.throws(() => schema({ fonts: { code: 'url(evil)' } }), /code/);
  assert.doesNotThrow(() => schema({ appearance: { canvas: '#AABBCC' }, fonts: { uiCjk: '思源黑体' } }));
  assert.doesNotThrow(() => schema({}));
  assert.doesNotThrow(() => schema({ features: { 'hero-ripples': false } }));
  assert.throws(() => schema({ features: { 'hero-ripples': 'false' } }), /hero-ripples/);
  for (const showModelIcons of [true, false]) {
    assert.doesNotThrow(() => schema({ view: { showModelIcons } }));
  }
  assert.throws(() => schema({ view: { showModelIcons: 'false' } }), /showModelIcons/);
  assert.doesNotThrow(() => schema({ view: { showSidebarBrand: true } }));
  assert.throws(() => schema({ view: { showSidebarBrand: 'true' } }), /showSidebarBrand/);
});
