import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { agentPresetCopy } from '../src/client/compat/permission-menu.ts';

const menus = readFileSync(new URL('../src/client/theme/menus.css', import.meta.url), 'utf8');

test('Agent preset rows share the menu geometry and keep the native descriptions visible', () => {
  for (const suffix of ['', ' > ._itemLabel_4ub78_190', ' > ._check_4ub78_179']) {
    assert.ok(menus.includes(`[data-ccd-agent-menu] [role="menuitem"][data-ccd-agent-mode]${suffix},`));
  }
  for (const part of ['heading', 'shortcut']) {
    assert.ok(menus.includes(`[data-ccd-agent-${part}],`));
  }
  assert.match(menus, /\[data-ccd-agent-mode\] > \._itemLabel_4ub78_190 > span > :not\(:first-child\)\s*\{\s*white-space: normal;/u);
});

test('Agent preset matching follows native names and never supplies replacement descriptions', () => {
  const copy = agentPresetCopy({ documentElement: { lang: 'zh-CN' } } as Document);
  assert.equal(copy.heading, 'Agent 预设');
  assert.deepEqual(copy.presets.map(row => row.name), ['标准模式', 'PTC 模式', '极简模式', '创造模式']);
  assert.deepEqual(copy.presets.map(row => row.value), ['standard', 'ptc', 'minimal', 'cordis']);
  for (const row of copy.presets) assert.equal(row.description, undefined);
  const english = agentPresetCopy({ documentElement: { lang: 'en' } } as Document);
  assert.deepEqual(english.presets.map(row => row.name), ['Standard mode', 'PTC mode', 'Minimal mode', 'Creator mode']);
  for (const row of english.presets) assert.equal(row.description, undefined);
});
