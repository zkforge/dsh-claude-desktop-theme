import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Browser coverage is optional without Chrome. */ }

const css = (await Promise.all(['src/client/theme/tokens.css', 'src/client/theme/menus.css']
  .map(path => readFile(join(root, path), 'utf8')))).join('\n');

/* The picker card as `ui-primitives`' Menu renders it: a fixed portal surface
   with its material layer, the workspace rows in `.viewport` (the selected one
   carrying the check) and the add row pinned in `.footer`. */
const row = (label, checked = false) => `<div class="_itemWrap_4ub78_90"><button type="button" role="menuitem"
  class="_item_4ub78_90${checked ? ' _selected_4ub78_216' : ''}" onclick="calls.push('${label}')"><span class="_itemLabel_4ub78_190">${label}</span>${
  checked ? '<svg class="_check_4ub78_179" width="14" height="14"></svg>' : ''}</button></div>`;
const card = `<div role="menu" data-menu-material="translucent" class="_surface_ri079_1 _list_4ub78_7 _portal_4ub78_41"
  style="position:fixed;left:40px;top:40px;width:240px;padding:4px">
  <div aria-hidden="true" class="_material_ri079_21"></div>
  <div class="_viewport_4ub78_19" role="presentation">${row('dsh-claude-desktop-theme', true)}${row('zhoukai.space')}${row('resume')}</div>
  <div class="_footer_4ub78_62" role="presentation">${row('添加工作区…')}</div></div>`;
const hostCss = `html,body{margin:0;font:13px/20px sans-serif}
._item_4ub78_90{display:flex;align-items:center;gap:6px;width:100%;border:0;background:none;padding:2px 8px;text-align:left}
._footer_4ub78_62{border-top:.5px solid #ddd;margin-top:4px;padding-top:4px}`;

test('Claude worktree chip beside the folder gates base selection; chip pointerdown then click closes the menu', { skip: !chrome, timeout: 60000 }, async () => {
  const bundle = await build({
    stdin: { contents: `import { mountWorkspaceMenu } from './src/client/compat/workspace-menu.ts';
      import { mountWorktreeChip, WorktreeChoices } from './src/client/compat/workspace-worktree.ts';
      window.mount = mountWorkspaceMenu; window.mountChip = mountWorktreeChip; window.Choices = WorktreeChoices;`, resolveDir: root },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
  });
  const profile = await mkdtemp(join(tmpdir(), 'ccd-worktree-menu-'));
  try {
    await withPage({ url: 'about:blank', width: 720, height: 520, scale: 1, profile }, async page => {
      await page.evaluate(`document.documentElement.setAttribute('data-dsh-ccd-style', 'true'); document.documentElement.lang = 'zh-CN';
        const style = document.createElement('style'); style.textContent = ${JSON.stringify(hostCss + css)}; document.head.append(style);
        document.body.innerHTML = '<div class="ST7X_W_heroWorkspaceRow"><button class="bocITq_workspace" aria-expanded="false">project</button></div>';
        window.calls = []; window.errors = []; window.posts = []; window.missing = false; window.notRepo = false; window.worktreeState = 'ready';
        window.fetch = async (url, init) => {
          if (init?.method === 'POST') { posts.push(String(url)); throw new Error('base selection must not check out the source'); }
          return String(url).includes('ccd-worktree')
            ? new Response(JSON.stringify({ state: worktreeState }), { status: missing ? 404 : 200 })
            : Response.json({ state: notRepo ? 'not-repo' : 'ready', current: 'main', detached: false, branches: ['main','feature/base'], truncated: false });
        };`);
      await page.evaluate(bundle.outputFiles[0].text);
      await page.evaluate(`window.choices = new Choices(() => 's1');
        window.release = mount(document, { workspaceIds: () => ['w1','w2','w3'], worktrees: choices }, error => errors.push(String(error)));
        window.releaseChip = mountChip(document, choices, () => 'w1', error => errors.push(String(error)));
        const chip = document.querySelector('.bocITq_workspace');
        chip.onclick = () => { const open = chip.getAttribute('aria-expanded') !== 'true'; chip.setAttribute('aria-expanded', String(open));
          if (open) document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(card)}); else document.querySelector('[role=menu]')?.remove(); };
        document.addEventListener('pointerdown', event => {
          const menu = document.querySelector('[role=menu]');
          if (menu && !menu.contains(event.target)) { chip.setAttribute('aria-expanded','false'); menu.remove(); }
        });
        chip.click();`);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 30))');
      assert.equal(await page.evaluate(`document.querySelector('.bocITq_workspace').nextElementSibling.hasAttribute('data-ccd-worktree-chip')`), true);
      assert.equal(await page.evaluate(`document.querySelector('[role=menu] [data-ccd-worktree-chip]') === null`), true, 'the toggle lives outside the card');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').getAttribute('aria-disabled')`), 'false');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').textContent`), '工作树');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-branch-row]').getAttribute('aria-disabled')`), 'true');
      await page.evaluate(`document.querySelector('[data-ccd-branch-row]').click()`);
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-branch-menu]') === null`), true);
      await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').click(); document.querySelector('[data-ccd-branch-row]').click()`);
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').getAttribute('aria-pressed')`), 'true');
      assert.equal(await page.evaluate(`document.querySelector('.bocITq_workspace').getAttribute('aria-expanded')`), 'true');
      await page.evaluate(`document.querySelector('[data-ccd-branch-name="feature/base"]').click()`);
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-branch-value]').textContent`), 'feature/base');
      assert.equal(await page.evaluate(`choices.base('s1')`), 'feature/base');
      assert.deepEqual(await page.evaluate('posts'), []);
      await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').click()`);
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-branch-row]').getAttribute('aria-disabled')`), 'true');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-branch-menu]') === null`), true);
      // Same pointerdown -> click order as a real chip press, including the host's outside handler.
      await page.evaluate(`{ const chip = document.querySelector('.bocITq_workspace');
        chip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); chip.click(); }`);
      assert.equal(await page.evaluate(`document.querySelector('.bocITq_workspace').getAttribute('aria-expanded')`), 'false');
      assert.equal(await page.evaluate(`document.querySelector('[role=menu]') === null`), true);
      // A non-repository hides the entire Git group, including the separator and keyboard stops.
      await page.evaluate(`notRepo = true; document.querySelector('.bocITq_workspace').click()`);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 30))');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-workspace-extra="branch"]').getBoundingClientRect().height`), 0);
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-branch-row]').offsetParent`), null);
      await page.evaluate(`document.querySelector('[data-ccd-menu-search]').focus();
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));`);
      assert.equal(await page.evaluate(`document.activeElement.textContent`), '打开文件夹 . . .');
      await page.evaluate(`document.querySelector('.bocITq_workspace').click(); window.fetchBefore = fetch;
        window.fetch = () => new Promise(() => {}); document.querySelector('.bocITq_workspace').click()`);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 30))');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-workspace-extra="branch"]').hidden`), true, 'cached non-repositories stay hidden while refreshing');
      await page.evaluate(`document.querySelector('.bocITq_workspace').click(); fetch = fetchBefore; notRepo = false;`);
      await page.evaluate(`missing = true; document.querySelector('.bocITq_workspace').click()`);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 30))');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-workspace-extra="branch"]').hidden`), false, 'a refreshed Git repository restores the controls');
      // A Host without the route dims the chip and says why; a non-repository hides it.
      await page.evaluate(`releaseChip(); releaseChip = mountChip(document, choices, () => 'w1', error => errors.push(String(error)))`);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 30))');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').getAttribute('aria-disabled')`), 'true');
      assert.match(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').title`), /需重启 DSH/);
      await page.evaluate(`missing = false; worktreeState = 'not-repo'; releaseChip(); releaseChip = mountChip(document, choices, () => 'w1', error => errors.push(String(error)))`);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 30))');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').offsetParent`), null);
      // Plugin availability changes without remounting the theme or composer.
      await page.evaluate(`worktreeState = 'disabled'; window.dispatchEvent(new Event('focus'))`);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 30))');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').hidden`), true);
      await page.evaluate(`worktreeState = 'ready'; window.dispatchEvent(new Event('focus'))`);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 30))');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').hidden`), false);
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').getAttribute('aria-disabled')`), 'false');
      await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').click(); worktreeState = 'disabled'; window.dispatchEvent(new Event('focus'))`);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 30))');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').hidden`), true);
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').getAttribute('aria-disabled')`), 'true');
      // Before the first availability answer there is no misleading visible chip.
      await page.evaluate(`releaseChip(); window.fetch = () => new Promise(() => {});
        releaseChip = mountChip(document, choices, () => 'w1', error => errors.push(String(error)))`);
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]').hidden`), true);
      await page.evaluate('releaseChip(); release()');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-worktree-chip]')`), null);
      assert.deepEqual(await page.evaluate('errors'), []);
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 }); }
});

test('workspace picker: search, labels, branch card, base selection, keyboard and cleanup', { skip: !chrome, timeout: 60000 }, async () => {
  const bundle = await build({
    stdin: { contents: `import { mountWorkspaceMenu } from './src/client/compat/workspace-menu.ts'; import { WorktreeChoices } from './src/client/compat/workspace-worktree.ts'; window.mount = mountWorkspaceMenu; window.Choices = WorktreeChoices;`, resolveDir: root },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022',
  });
  const profile = await mkdtemp(join(tmpdir(), 'ccd-workspace-menu-'));
  try {
    await withPage({ url: 'about:blank', width: 720, height: 420, scale: 2, profile }, async page => {
      await page.evaluate(`document.documentElement.setAttribute('data-dsh-ccd-style', 'true');
        document.documentElement.lang = 'zh-CN';
        const style = document.createElement('style'); style.textContent = ${JSON.stringify(hostCss + css)}; document.head.append(style);
        document.body.innerHTML = '<button class="bocITq_workspace" aria-haspopup="menu" aria-expanded="false">chip</button>';
        window.calls = []; window.errors = []; window.requests = []; window.posts = [];
        window.current = 'main';
        const names = ['main', 'feat/tool-call-cards', 'wip/pre-split-snapshot'];
        window.fetch = async (url, init) => {
          if (init?.method === 'POST') { posts.push(String(url)); throw new Error('listing must be read-only'); }
          if (String(url).includes('ccd-worktree')) return Response.json({ state: 'ready' });
          requests.push(String(url));
          return new Response(JSON.stringify({ state: 'ready', current, detached: false,
            branches: [current, ...names.filter(name => name !== current)], truncated: false })); };`);
      await page.evaluate(bundle.outputFiles[0].text);
      await page.evaluate(`window.choices = new Choices(() => 's1'); choices.select('s1', 'w1', true); window.release = window.mount(document, { workspaceIds: () => ['w1', 'w2', 'w3'], worktrees: choices }, error => errors.push(String(error)))`);
      await page.evaluate(`document.body.insertAdjacentHTML('beforeend', ${JSON.stringify(card)});
        document.querySelector('.bocITq_workspace').setAttribute('aria-expanded', 'true')`);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 50))');

      const text = selector => page.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
      assert.equal(await page.evaluate(`document.querySelector('[role=menu]').children[1].querySelector('[data-ccd-menu-search]')?.placeholder`), '搜索文件夹…');
      assert.equal(await page.evaluate(`document.activeElement?.hasAttribute('data-ccd-menu-search')`), true, 'the card opens with the caret in search');
      assert.equal(await text('._viewport_4ub78_19 > [role=presentation]'), '最近');
      assert.equal(await text('._footer_4ub78_62 ._itemLabel_4ub78_190'), '打开文件夹 . . .');
      assert.deepEqual(await page.evaluate('requests'), ['/api/ccd-git-branches?workspace=w1']);
      assert.equal(await text('[data-ccd-branch-value]'), 'main');
      assert.equal(await page.evaluate(`document.querySelector('[role=menu]').lastElementChild.getAttribute('data-ccd-workspace-extra')`), 'branch');

      // Filtering hides non-matching rows; Enter picks the first visible one.
      await page.evaluate(`{ const input = document.querySelector('[data-ccd-menu-search]'); input.value = 'ZHOU'; input.dispatchEvent(new Event('input')) }`);
      assert.equal(await page.evaluate(`[...document.querySelectorAll('._viewport_4ub78_19 [role=menuitem]')].filter(row => row.offsetParent !== null).map(row => row.textContent).join()`), 'zhoukai.space');
      await page.evaluate(`document.querySelector('[data-ccd-menu-search]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
      assert.deepEqual(await page.evaluate('calls'), ['zhoukai.space']);
      await page.evaluate(`{ const input = document.querySelector('[data-ccd-menu-search]'); input.value = 'nothing'; input.dispatchEvent(new Event('input')) }`);
      assert.equal(await page.evaluate(`document.querySelector('._viewport_4ub78_19 [data-ccd-menu-note]').hidden`), false);
      await page.evaluate(`{ const input = document.querySelector('[data-ccd-menu-search]'); input.value = ''; input.dispatchEvent(new Event('input')) }`);

      // Arrow keys walk visible rows from the search line, and stop at the card.
      const key = name => page.evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: '${name}', bubbles: true, cancelable: true }))`);
      await page.evaluate(`document.addEventListener('keydown', event => { if (event.key.startsWith('Arrow')) calls.push('leak') })`);
      await page.evaluate(`document.querySelector('[data-ccd-menu-search]').focus()`);
      await key('ArrowDown');
      assert.equal(await page.evaluate('document.activeElement.textContent'), 'dsh-claude-desktop-theme');
      await key('ArrowUp'); await key('ArrowUp');
      assert.equal(await page.evaluate(`document.activeElement.hasAttribute('data-ccd-branch-row')`), true);

      // ArrowRight opens the side card beside the card, inside it for the primitive's pointer guard.
      await key('ArrowRight');
      const side = await page.evaluate(`(() => { const side = document.querySelector('[data-ccd-branch-menu]');
        const outer = document.querySelector('[role=menu]').getBoundingClientRect(); const rect = side.getBoundingClientRect();
        return { inside: document.querySelector('[role=menu]').contains(side), open: side.matches(':popover-open'),
          gap: Math.round(rect.left - outer.right), names: [...side.querySelectorAll('[data-ccd-branch-name]')].map(item => item.textContent),
          checked: side.querySelector('[aria-current=true]')?.textContent, disabled: side.querySelectorAll('[aria-disabled=true]').length,
          focus: document.activeElement.placeholder }; })()`);
      assert.deepEqual(side, { inside: true, open: true, gap: 4, names: ['main', 'feat/tool-call-cards', 'wip/pre-split-snapshot'],
        checked: 'main', disabled: 0, focus: '搜索分支…' });
      await page.evaluate(`{ const input = document.querySelector('[data-ccd-branch-menu] [data-ccd-menu-search]'); input.value = 'wip'; input.dispatchEvent(new Event('input')) }`);
      assert.equal(await page.evaluate(`[...document.querySelectorAll('[data-ccd-branch-name]')].filter(item => item.offsetParent !== null).length`), 1);
      await key('ArrowDown');
      assert.equal(await page.evaluate('document.activeElement.textContent'), 'wip/pre-split-snapshot');
      await key('ArrowLeft');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-branch-menu]')`), null);
      assert.equal(await page.evaluate(`document.activeElement.getAttribute('aria-expanded')`), 'false');
      assert.equal(await page.evaluate(`calls.includes('leak')`), false, 'arrow keys never reach the primitive');

      // Pointing at a host row withdraws the side card.
      await page.evaluate(`document.querySelector('[data-ccd-branch-row]').dispatchEvent(new PointerEvent('pointerenter'))`);
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-branch-menu]').length`), 1);
      const pick = name => page.evaluate(`document.querySelector('[data-ccd-branch-name="${name}"]').click()`);
      const settle = () => page.evaluate('new Promise(resolve => setTimeout(resolve, 30))');
      await page.evaluate(`window.rowsBefore = [...document.querySelectorAll('[data-ccd-branch-name]')];
        window.topBefore = document.querySelector('[data-ccd-branch-menu]').style.top`);
      await pick('feat/tool-call-cards'); await settle();
      assert.equal(await page.evaluate(`choices.base('s1')`), 'feat/tool-call-cards');
      assert.equal(await text('[data-ccd-branch-menu] [aria-current=true]'), 'feat/tool-call-cards');
      assert.equal(await text('[data-ccd-branch-value]'), 'feat/tool-call-cards');
      assert.equal(await page.evaluate(`[...document.querySelectorAll('[data-ccd-branch-name]')].every((item, index) => item === rowsBefore[index])`), true, 'base selection updates rows in place');
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-branch-check]').length`), 1);
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-branch-menu]').style.top`), await page.evaluate('topBefore'));
      await pick('main'); await pick('feat/tool-call-cards');
      assert.deepEqual(await page.evaluate('posts'), [], 'base selection never requests a source checkout');
      if (process.env.CCD_WORKSPACE_MENU_PREVIEW) {
        const shot = await page.send('Page.captureScreenshot', { format: 'png' });
        await writeFile(process.env.CCD_WORKSPACE_MENU_PREVIEW, Buffer.from(shot.data, 'base64'));
      }
      await page.evaluate(`document.querySelector('._viewport_4ub78_19 [role=menuitem]').dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))`);
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-branch-menu]').length`), 0);

      // Reopening reuses the cached listing before the new read lands; release restores the host.
      await page.evaluate(`document.querySelector('.bocITq_workspace').setAttribute('aria-expanded', 'false')`);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 20))');
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-workspace-extra], [data-ccd-menu-note], [data-ccd-filtered]').length`), 0);
      assert.equal(await text('._footer_4ub78_62 ._itemLabel_4ub78_190'), '添加工作区…');
      await page.evaluate(`window.fetch = () => new Promise(() => {}); document.querySelector('.bocITq_workspace').setAttribute('aria-expanded', 'true')`);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 20))');
      assert.equal(await text('[data-ccd-branch-value]'), 'feat/tool-call-cards', 'the staged base survives reopening while the cached listing refreshes');
      await page.evaluate('release()');
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-workspace-extra], [data-ccd-branch-menu]').length`), 0);
      assert.equal(await text('._footer_4ub78_62 ._itemLabel_4ub78_190'), '添加工作区…');
      assert.deepEqual(await page.evaluate('errors'), []);
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 }); }
});
