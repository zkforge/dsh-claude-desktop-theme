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

test('workspace picker: search, labels, branch card, switching, keyboard and cleanup', { skip: !chrome, timeout: 60000 }, async () => {
  const bundle = await build({
    stdin: { contents: `import { mountWorkspaceMenu } from './src/client/compat/workspace-menu.ts'; window.mount = mountWorkspaceMenu;`, resolveDir: root },
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
        window.current = 'main'; window.busy = false; window.checkout = null;
        const names = ['main', 'feat/tool-call-cards', 'wip/pre-split-snapshot'];
        window.fetch = async (url, init) => {
          if (init?.method === 'POST') {
            posts.push([String(url), JSON.parse(init.body)]);
            if (window.hold) await window.hold;
            if (checkout.state === 'switched') current = JSON.parse(init.body).branch;
            return new Response(JSON.stringify(checkout));
          }
          requests.push(String(url));
          return new Response(JSON.stringify({ state: 'ready', current, detached: false,
            branches: [current, ...names.filter(name => name !== current)], truncated: false })); };`);
      await page.evaluate(bundle.outputFiles[0].text);
      await page.evaluate(`window.release = window.mount(document, { workspaceIds: () => ['w1', 'w2', 'w3'], busy: id => { calls.push(['busy', id]); return busy; } }, error => errors.push(String(error)))`);
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
      const notice = () => page.evaluate(`(() => { const note = document.querySelector('[data-ccd-branch-notice]');
        return note.hidden ? null : [note.textContent, note.dataset.tone]; })()`);
      await page.evaluate('calls.length = 0');

      // A running session of the Workspace refuses the switch before the Host is asked.
      await page.evaluate('busy = true');
      await pick('feat/tool-call-cards'); await settle();
      assert.deepEqual(await page.evaluate('posts'), []);
      assert.deepEqual(await notice(), ['该工作区有会话正在运行，结束后再切换', 'error']);

      // A refused checkout keeps the check where it was and says why.
      await page.evaluate(`busy = false; checkout = { state: 'conflict', carried: 0, message: '' }`);
      await pick('feat/tool-call-cards'); await settle();
      assert.deepEqual(await page.evaluate('posts'), [['/api/ccd-git-checkout', { workspace: 'w1', branch: 'feat/tool-call-cards' }]]);
      assert.deepEqual(await notice(), ['本地改动会被覆盖，请先提交或暂存', 'error']);
      assert.equal(await text('[data-ccd-branch-menu] [aria-current=true]'), 'main');

      // A fast switch moves only the check: same nodes, same order, no progress flash.
      await page.evaluate(`checkout = { state: 'switched', carried: 2, message: '' };
        window.rowsBefore = [...document.querySelectorAll('[data-ccd-branch-name]')];
        window.topBefore = document.querySelector('[data-ccd-branch-menu]').style.top;
        window.seen = [];
        window.watch = new MutationObserver(() => { const note = document.querySelector('[data-ccd-branch-notice]');
          seen.push(note.hidden ? '' : note.textContent);
          if (document.querySelector('[data-ccd-branch-name][aria-busy]')) seen.push('busy'); });
        watch.observe(document.querySelector('[data-ccd-branch-menu]'), { subtree: true, childList: true, attributes: true, characterData: true });`);
      await pick('feat/tool-call-cards'); await settle();
      assert.deepEqual(await notice(), ['已切换，带上 2 个未提交改动', 'info']);
      assert.equal(await text('[data-ccd-branch-menu] [aria-current=true]'), 'feat/tool-call-cards');
      assert.equal(await text('[data-ccd-branch-value]'), 'feat/tool-call-cards');
      assert.equal(await page.evaluate(`[...document.querySelectorAll('[data-ccd-branch-name]')].every((item, index) => item === rowsBefore[index])`), true, 'rows are updated in place, never rebuilt or reordered');
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-branch-check]').length`), 1);
      assert.equal(await page.evaluate(`seen.some(entry => entry === 'busy' || entry.startsWith('正在切换'))`), false, 'no progress state for a fast switch');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-branch-menu]').style.top`), await page.evaluate('topBefore'), 'the card keeps its top');

      // A slow switch says so only after the delay, and rows stop taking clicks at once.
      await page.evaluate(`watch.disconnect(); window.hold = new Promise(resolve => { window.finish = resolve; });
        checkout = { state: 'switched', carried: 0, message: '' }`);
      await pick('main');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-branch-name="main"]').getAttribute('aria-disabled')`), 'true');
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-branch-name="main"]').hasAttribute('aria-busy')`), false);
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 300))');
      assert.deepEqual(await notice(), ['正在切换到 main…', 'info']);
      assert.equal(await page.evaluate(`document.querySelector('[data-ccd-branch-name="main"]').getAttribute('aria-busy')`), 'true');
      await page.evaluate('window.hold = null; finish()'); await settle();
      assert.equal(await notice(), null);
      assert.equal(await text('[data-ccd-branch-menu] [aria-current=true]'), 'main');
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-branch-name][aria-disabled], [data-ccd-branch-name][aria-busy]').length`), 0);
      await page.evaluate(`checkout = { state: 'switched', carried: 2, message: '' }`);
      await pick('feat/tool-call-cards'); await settle();
      // Picking the checked branch is a no-op.
      await pick('feat/tool-call-cards'); await settle();
      assert.equal(await page.evaluate('posts.length'), 4);
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
      assert.equal(await text('[data-ccd-branch-value]'), 'feat/tool-call-cards', 'the listing re-read after the switch');
      await page.evaluate('release()');
      assert.equal(await page.evaluate(`document.querySelectorAll('[data-ccd-workspace-extra], [data-ccd-branch-menu]').length`), 0);
      assert.equal(await text('._footer_4ub78_62 ._itemLabel_4ub78_190'), '添加工作区…');
      assert.deepEqual(await page.evaluate('errors'), []);
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 150 }); }
});
