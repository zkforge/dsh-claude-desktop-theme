import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { agentPresetCopy } from '../src/client/compat/permission-menu.ts';

const menus = readFileSync(new URL('../src/client/theme/menus.css', import.meta.url), 'utf8');

test('Agent preset rows share the permission menu geometry and single-line summaries', () => {
  for (const suffix of ['', ' > ._itemLabel_4ub78_190', ' > ._check_4ub78_179']) {
    assert.ok(menus.includes(`[data-ccd-agent-menu] [role="menuitem"][data-ccd-agent-mode]${suffix},`));
  }
  for (const part of ['desc', 'heading', 'shortcut']) {
    assert.ok(menus.includes(`[data-ccd-agent-${part}],`));
  }
  assert.match(menus, /\[data-ccd-agent-mode\] > \._itemLabel_4ub78_190 > span > :not\(:first-child\)\s*\{\s*display: none;/u);
});

test('Agent preset copy follows the built-in order and keeps summaries short', () => {
  const copy = agentPresetCopy({ documentElement: { lang: 'zh-CN' } } as Document);
  assert.equal(copy.heading, 'Agent 预设');
  assert.deepEqual(copy.presets.map(row => row.name), ['标准模式', 'PTC 模式', '极简模式', '创造模式']);
  assert.deepEqual(copy.presets.map(row => row.value), ['standard', 'ptc', 'minimal', 'cordis']);
  for (const row of copy.presets) assert.ok(row.description.length > 0 && row.description.length <= 18);
});
