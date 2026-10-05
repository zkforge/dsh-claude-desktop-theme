import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';
import { Config } from '../src/host/index.ts';
import { adoptConfig, DEFAULT_FEATURES } from '../src/shared/config.ts';
import { ENTRY_ID, PLUGIN_ID } from '../src/shared/identity.ts';

const patch = parse(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'));
const entries = patch.flatMap((operation: { insert?: unknown[] }) => operation.insert ?? []);
const entry = entries.find((row: { id: string }) => row.id === ENTRY_ID);
const schema = Config as unknown as (input: unknown) => Record<string, { get(): unknown }>;

/** The SDK returns reactive cells; the settings transport serves their values. */
function servedConfig(input: unknown) {
  return adoptConfig(Object.fromEntries(
    Object.entries(schema(input)).map(([field, cell]) => [field, cell.get()]),
  ));
}

test('the install bundle enables the interface through the Host-served configuration', () => {
  assert.ok(entry, 'the bundle must create the plugin entry');
  assert.equal(entry.name, PLUGIN_ID);
  const config = servedConfig(entry.config);
  assert.equal(config.enabled, true);
  assert.deepEqual(config.features, DEFAULT_FEATURES);
  assert.equal(config.features.statistics, false);
  assert.equal(config.features['tool-calls'], false);
  assert.equal(config.features['composer-stats'], false, 'the status-bar readouts are opted into');
});

test('an explicit saved off switch remains off, and a missing form never activates', () => {
  const saved = servedConfig({ enabled: false, features: { sidebar: false } });
  assert.equal(saved.enabled, false);
  assert.equal(saved.features.sidebar, false);
  assert.equal(adoptConfig(undefined).enabled, false);
});
