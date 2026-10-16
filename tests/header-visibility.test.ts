import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Config } from '../src/host/index.ts';
import { adoptConfig, resolveConfig } from '../src/shared/config.ts';
import { CleanupScope } from '../src/client/core/cleanup.ts';
import type { HostServices } from '../src/client/contracts/ports.ts';
import { mountHeaderVisibility } from '../src/client/features/conversation/header-actions/visibility.ts';
import { DSH_SLOTS, OVERRIDE_PRIORITY } from '../src/client/compat/slots.ts';

function registry() {
  const live: Array<{ name: string; id: string; priority: number; render: () => unknown }> = [];
  const native = new Map([['subagent-catalog', 'subagents'], ['agent-team', 'team'], ['custom', 'other']]);
  const slots = {
    inject(_name: string, register: () => () => void) { return register(); },
    register(entry: { name: string; id: string; priority: number }, render: () => unknown) {
      const value = { ...entry, render };
      live.push(value);
      return () => { live.splice(live.indexOf(value), 1); };
    },
  } as unknown as HostServices['slots'];
  return { slots, live, read(id: string) {
    const overrides = live.filter(entry => entry.id === id).sort((a, b) => a.priority - b.priority);
    return overrides[0]?.render() ?? (overrides.length ? null : native.get(id));
  } };
}

test('header entries are independently optional and release to their native renderers', () => {
  for (const showHeaderSubagents of [false, true]) for (const showHeaderTeam of [false, true]) {
    const host = registry();
    const cleanup = new CleanupScope();
    mountHeaderVisibility(host.slots, { showHeaderSubagents, showHeaderTeam }, cleanup);
    assert.equal(host.read('subagent-catalog'), showHeaderSubagents ? 'subagents' : null);
    assert.equal(host.read('agent-team'), showHeaderTeam ? 'team' : null);
    assert.equal(host.read('custom'), 'other');
    for (const entry of host.live) {
      assert.equal(entry.name, DSH_SLOTS.sessionHeaderActions);
      assert.equal(entry.priority, OVERRIDE_PRIORITY);
      assert.equal(entry.render(), null);
    }
    cleanup.dispose(); cleanup.dispose();
    assert.equal(host.live.length, 0);
    assert.equal(host.read('subagent-catalog'), 'subagents');
    assert.equal(host.read('agent-team'), 'team');
  }
});

test('Host defaults hide both entries; saved independent values survive the settings transport', () => {
  const schema = Config as unknown as (value: unknown) => Record<string, { get(): unknown }>;
  for (const view of [undefined, { showHeaderSubagents: true }, { showHeaderTeam: true },
    { showHeaderSubagents: true, showHeaderTeam: true }]) {
    const cells = schema(view ? { view } : {});
    const served = adoptConfig(Object.fromEntries(Object.entries(cells).map(([key, cell]) => [key, cell.get()])));
    assert.equal(served.view.showHeaderSubagents, view?.showHeaderSubagents ?? false);
    assert.equal(served.view.showHeaderTeam, view?.showHeaderTeam ?? false);
  }
  assert.equal(resolveConfig().view.showHeaderSubagents, false);
  assert.equal(resolveConfig().view.showHeaderTeam, false);
  assert.equal(adoptConfig({ view: { showHeaderSubagents: 'true', showHeaderTeam: null } }).view.showHeaderSubagents, false);
  assert.equal(adoptConfig({ view: { showHeaderSubagents: 'true', showHeaderTeam: null } }).view.showHeaderTeam, false);
  assert.throws(() => resolveConfig({ view: { showHeaderSubagents: 'true' } }), /view.showHeaderSubagents/);
});
