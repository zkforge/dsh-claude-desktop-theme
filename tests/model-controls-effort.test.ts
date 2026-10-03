import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelCatalogModel, ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types';
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import { effortChoices, effortSelection, effortView, modelSelection } from '../src/client/features/model-controls/selection.ts';

const copy = { defaultName: 'Default' };
const tiers = [{ id: 'off', name: 'Off' }, { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }];
const route: ModelSelection = { provider: 'provider', model: 'reasoner' };
const model: ModelCatalogModel = { id: 'reasoner', name: 'Reasoner', reasoning: { defaultEffort: 'high', efforts: tiers } };
const bare: ModelCatalogModel = { id: 'bare', name: 'Bare', reasoning: { efforts: tiers } };
const odd: ModelCatalogModel = { id: 'odd', name: 'Odd', reasoning: { defaultEffort: 'ultra', efforts: tiers } };
const single: ModelCatalogModel = { id: 'single', name: 'Single', reasoning: { efforts: [{ id: 'off', name: 'Off' }] } };
const state: ModelDirectoryState = {
  current: route, groups: [{ id: 'provider', name: 'Provider', models: [model, bare, odd] }],
  failures: [], status: 'ready', routable: true, pending: null, error: null,
};

test('the slider stops are the advertised tiers alone, in provider order', () => {
  for (const catalogue of [model, bare, odd]) {
    const view = effortView(catalogue, { provider: 'provider', model: catalogue.id }, copy);
    assert.deepEqual(view.choices, tiers);
    assert.ok(!view.choices.some(choice => choice.id === undefined), 'the provider default must never occupy a stop');
  }
  /* The view carries no recommended position and no default alias any more. */
  assert.deepEqual(Object.keys(effortView(model, route, copy)).sort(), ['caption', 'choices', 'effort', 'preview']);
});

test('the thumb rests on the saved tier, else the provider default, else the first stop', () => {
  assert.equal(effortView(model, route, copy).preview, 2);
  assert.equal(effortView(model, { ...route, reasoningEffort: 'low' }, copy).preview, 1);
  assert.equal(effortView(model, { ...route, reasoningEffort: 'high' }, copy).preview, 2);
  assert.equal(effortView(bare, route, copy).preview, 0);
  assert.equal(effortView(bare, { ...route, reasoningEffort: 'max' }, copy).preview, 3);
  assert.equal(effortView(odd, route, copy).preview, 0, 'an unplaceable default leaves the first stop');
  assert.equal(effortView(odd, { ...route, reasoningEffort: 'max' }, copy).preview, 3);
  /* A saved tier the catalog dropped rests where the provider default sits. */
  assert.equal(effortView(model, { ...route, reasoningEffort: 'ultra' }, copy).preview, 2);
  assert.equal(effortView(bare, { ...route, reasoningEffort: 'ultra' }, copy).preview, 0);
});

test('the caption names the stop the thumb rests on until a tier is saved explicitly', () => {
  assert.equal(effortView(model, route, copy).caption, 'High');
  assert.equal(effortView(bare, route, copy).caption, 'Off');
  assert.equal(effortView(odd, route, copy).caption, 'Off', 'an unplaceable default captions the stop it leaves the thumb on');
  assert.equal(effortView(model, { ...route, reasoningEffort: 'low' }, copy).caption, 'Low');
  /* Saving the tier the provider default names is still an explicit choice. */
  const explicit = effortView(model, { ...route, reasoningEffort: 'high' }, copy);
  assert.equal(explicit.caption, 'High');
  assert.equal(explicit.effort, 'high');
});

test('a catalog with stops never captions the trigger with the removed Default stop', () => {
  /* Switching model drops the saved tier for the new route's own default: a
     route that advertises stops but names no default — or names one its own
     stops do not carry — arrives with no explicit pick at all. The caption
     used to read as the host's "Default" wording there while the panel drew no
     such stop, so the trigger and the thumb contradicted each other. */
  const switched = modelSelection('provider', bare, { provider: 'provider', model: 'reasoner', reasoningEffort: 'high' });
  assert.equal(switched.reasoningEffort, undefined);
  assert.equal(effortView(bare, switched, copy).preview, 0);
  assert.equal(effortView(bare, switched, copy).caption, 'Off');

  for (const catalogue of [model, bare, odd, single]) {
    const stops = catalogue.reasoning?.efforts ?? [];
    for (const saved of [undefined, ...stops.map(stop => stop.id)]) {
      const current: ModelSelection = { provider: 'provider', model: catalogue.id, ...(saved === undefined ? {} : { reasoningEffort: saved }) };
      const view = effortView(catalogue, current, copy);
      assert.ok(view.choices.length > 0, 'these catalogs advertise at least one stop');
      assert.equal(view.caption, view.choices[view.preview]?.name,
        `${catalogue.id} with ${saved ?? 'no saved tier'} must caption the stop the thumb rests on`);
      assert.notEqual(view.caption, copy.defaultName, 'the panel offers no Default stop to caption');
    }
  }
});

test('a tier the catalog no longer advertises keeps the retained caption', () => {
  const dropped = { ...route, reasoningEffort: 'ultra' };
  assert.equal(effortView(model, dropped, copy).caption, 'ultra');
  assert.equal(effortView(model, dropped, { ...copy, retainedEffort: 'Ultra (saved)' }).caption, 'Ultra (saved)');
  assert.equal(effortView(bare, dropped, { ...copy, retainedEffort: 'Ultra (saved)' }).caption, 'Ultra (saved)');
});

test('a model without reasoning offers no stops and no default caption', () => {
  const empty: ModelCatalogModel = { id: 'empty', name: 'Empty', reasoning: { efforts: [] } };
  /* A reasoning catalog with an empty track is the one degradation the host's
     own wording survives in: there is no stop to name and no panel to draw, so
     the disabled trigger keeps its caption rather than going blank. */
  assert.deepEqual(effortView(empty, { provider: 'provider', model: 'empty' }, copy),
    { choices: [], preview: 0, effort: undefined, caption: 'Default' });
  assert.deepEqual(effortView({ id: 'plain', name: 'Plain' }, { provider: 'provider', model: 'plain' }, copy),
    { choices: [], preview: 0, effort: undefined, caption: undefined });
  assert.deepEqual(effortView(undefined, null, copy),
    { choices: [], preview: 0, effort: undefined, caption: undefined });
  assert.equal(effortView({ id: 'plain', name: 'Plain' }, { provider: 'provider', model: 'plain', reasoningEffort: 'low' }, copy).caption, 'low');
});

test('every stop the panel offers survives the commit-time validation', () => {
  for (const choice of effortView(model, route, copy).choices) {
    assert.deepEqual(effortSelection(state, route, choice.id),
      { provider: 'provider', model: 'reasoner', reasoningEffort: choice.id });
  }
  assert.deepEqual(effortSelection(state, route, 'high'), { provider: 'provider', model: 'reasoner', reasoningEffort: 'high' });
  assert.equal(effortSelection(state, route, 'ultra'), null);
});

test('the validation domain stays the historical one', () => {
  assert.deepEqual(effortChoices(model, 'Default'), tiers);
  assert.deepEqual(effortChoices(bare, 'Default'), [{ id: undefined, name: 'Default' }, ...tiers]);
  assert.deepEqual(effortChoices(undefined, 'Default'), []);
  /* The domain still admits "follow the provider default" where the catalog
     names none, even though the panel never offers it as a stop. */
  const bareRoute: ModelSelection = { provider: 'provider', model: 'bare' };
  assert.deepEqual(effortSelection({ ...state, current: bareRoute }, bareRoute, undefined), { provider: 'provider', model: 'bare' });
  assert.equal(effortSelection(state, route, undefined), null);
});
