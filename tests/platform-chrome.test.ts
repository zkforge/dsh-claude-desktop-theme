import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/*
 * Platform chrome contract.
 *
 * The DSH preload marks `<html>` with `data-platform` (`darwin` on macOS,
 * `win32` on Windows) and adds `data-windows-titlebar` on Windows, where the
 * host reserves a 40px caption strip above the frame for the sidebar toggle,
 * its native 「应用」/「编辑」 menus and the window controls — read from the
 * pinned `0.2.0-rc.2` `ui-layout` and `ui-sidebar` stylesheets. These tests pin
 * what this plugin owns on each platform, so a later edit cannot drop a
 * macOS-only scope or leave Windows without the rule it needs.
 */

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

interface Rule {
  readonly selector: string;
  readonly body: string;
}

/** Flat `selector { body }` pairs; nested at-rule wrappers are skipped. */
function rules(sheet: string): Rule[] {
  const source = sheet.replace(/\/\*[\s\S]*?\*\//gu, '');
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map(([, selector, body]) => ({
    selector: (selector ?? '').trim().replace(/\s+/gu, ' '),
    body: body ?? '',
  }));
}

const shell = rules(read('../src/client/theme/base.css'));
const sidebar = rules(read('../src/client/features/sidebar/sidebar.css'));

test('the Windows caption strip keeps the configured sidebar colour', () => {
  const strip = shell.filter(rule => rule.selector.includes('[data-windows-titlebar]')
    && rule.selector.includes('._6Qf49G_frame:before'));
  assert.equal(strip.length, 1);
  const [rule] = strip;
  /* The strip belongs to the host; only the plugin's own marker may repaint it. */
  assert.ok(rule?.selector.includes('[data-dsh-ccd-style="true"]'));
  assert.match(rule?.body ?? '', /background:\s*var\(--ccd-sidebar\)/u);
});

test('fixed window-control geometry stays inside its desktop platform scope', () => {
  const fixedToggle = sidebar.filter(rule => rule.selector.includes('._3WPZCG_toggle')
    && /position:\s*fixed/u.test(rule.body));
  assert.ok(fixedToggle.length > 0);
  for (const rule of fixedToggle) {
    assert.ok(rule.selector.includes('[data-platform="darwin"]') || rule.selector.includes('[data-windows-titlebar]'), rule.selector);
  }
  const offsets = sidebar.filter(rule => rule.body.includes('--ccd-sidebar-toggle-left'));
  assert.ok(offsets.length > 0);
  for (const rule of offsets) {
    assert.ok(rule.selector.includes('[data-platform="darwin"]'), rule.selector);
  }
});

test('the Windows brand row keeps the CCD navigation inset', () => {
  const brand = sidebar.filter(rule => rule.selector.includes('[data-windows-titlebar]')
    && rule.selector.includes('._3WPZCG_brand'));
  assert.equal(brand.length, 1);
  assert.match(brand[0]?.body ?? '', /padding:\s*0 8px/u);
});

test('the install guide carries a Windows path next to the macOS one', () => {
  const guide = read('../install.md');
  assert.match(guide, /Windows 10/u);
  assert.match(guide, /```powershell/u);
  assert.match(guide, /Contents\/Resources\/runtime\/cli\/bin\/dsh/u);
  assert.ok(guide.includes('resources\\runtime\\cli\\bin\\dsh.cmd'));
  assert.match(guide, /mktemp/u);
});

test('the README states both supported desktop platforms', () => {
  const readme = read('../README.md');
  assert.match(readme, /macOS（Apple 芯片）/u);
  assert.match(readme, /Windows 10/u);
});


test('the conversation header is a window drag surface only on macOS', () => {
  const conversation = rules(read('../src/client/features/conversation/conversation.css'));
  const headers = conversation.filter(rule => rule.selector.endsWith('.ST7X_W_header')
    && /-webkit-app-region:\s*drag\s*;/u.test(rule.body));
  assert.equal(headers.length, 1);
  assert.ok(headers[0]?.selector.includes('[data-platform="darwin"]'));
});
