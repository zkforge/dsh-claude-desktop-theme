import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import { readFavorites, splitModels } from '../src/client/features/model-controls/favorites.ts';

const model = (id: string) => ({ id, name: id });
const groups: ModelDirectoryState['groups'] = [
  { id: 'a', name: 'A', models: ['1', '2', '3'].map(model) },
  { id: 'b', name: 'B', models: ['4', '5', '6'].map(model) },
];
const ids = (entries: ReturnType<typeof splitModels>['primary']) => entries.map(entry => `${entry.group.id}/${entry.model.id}`);

test('with nothing saved the card opens on the first four models', () => {
  const { primary, rest } = splitModels(groups, null);
  assert.deepEqual(ids(primary), ['a/1', 'a/2', 'a/3', 'b/4']);
  assert.deepEqual(ids(rest), ['b/5', 'b/6']);
});

test('saved models keep their order and everything else moves to More models', () => {
  const { primary, rest } = splitModels(groups, ['b/6', 'a/1']);
  assert.deepEqual(ids(primary), ['b/6', 'a/1']);
  assert.deepEqual(ids(rest), ['a/2', 'a/3', 'b/4', 'b/5']);
});

test('a route that left the catalog is dropped, and an empty result falls back', () => {
  assert.deepEqual(ids(splitModels(groups, ['gone/1', 'a/2']).primary), ['a/2']);
  assert.equal(splitModels(groups, ['gone/1']).primary.length, 4);
  assert.equal(splitModels(groups, []).primary.length, 4);
});

test('stored lists are validated and capped at the card’s four rows', () => {
  assert.equal(readFavorites(null), null);
  assert.equal(readFavorites('{broken'), null);
  assert.equal(readFavorites('[1]'), null);
  assert.deepEqual(readFavorites('["a","b","c","d","e"]'), ['a', 'b', 'c', 'd']);
});
