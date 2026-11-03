import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* CI supplies Chrome. */ }
const options = { skip: chrome ? false : 'Chrome unavailable', timeout: 30000 };

// Shipped rc5 Menu, AccountMenu, Modal and FeedbackDialog rules. Only the
// feedback module prefix is renamed: its class is intentionally not a theme API.
const hostCss = `
._list_4ub78_7,._submenu_4ub78_8{box-sizing:border-box;padding:4px;display:flex;flex-direction:column;gap:0;border:0;--dsw-elevation-stroke-color: var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);--dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2)}
._list_4ub78_7{position:absolute;top:calc(100% + 4px);left:0;z-index:100;min-width:144px;max-width:360px}
._itemWrap_4ub78_90{position:relative}
._item_4ub78_90{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:none;border-radius:var(--dsw-radius-md);background:transparent;cursor:pointer;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);text-align:left}
._itemIcon_4ub78_148{display:inline-flex;flex:none;width:14px;height:14px;align-items:center;justify-content:center;color:var(--dsw-alias-menu-icon)}
._itemIcon_4ub78_148 svg,._check_4ub78_179{width:14px;height:14px}
._itemLabel_4ub78_190{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
._root_o6lrb_6{pointer-events:auto;position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-frame-overlay-top, 24px)) 24px}
._dialog_o6lrb_33{box-sizing:border-box;position:relative;z-index:1;display:flex;flex-direction:column;gap:20px;width:min(380px,100%);padding:0 0 24px;overflow:hidden;border:0;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);animation:_modalEnter_o6lrb_1 var(--ds-transition-duration) var(--ds-ease-in-out)}
._mask_o6lrb_18:after,._dialog_o6lrb_33{animation:none}
._content_o6lrb_63{display:flex;flex-direction:column;width:100%}
._header_o6lrb_71{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 12px 24px}
._title_o6lrb_79{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
._close_o6lrb_87{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary)}
._body_o6lrb_115{display:flex;flex-direction:column;min-width:0;margin-top:20px;padding:0 24px}
._footer_o6lrb_123{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px}
.ZogL4G_signedOutMenu[role=menu]{min-width:124px;max-width:280px;padding:4px}
.ZogL4G_signedOutMenu [role=menuitem]{border-radius:var(--dsw-radius-md);gap:8px;min-height:40px;padding:8px 10px;font-size:14px;line-height:22px}
.ZogL4G_signedOutMenu [role=menuitem]>span:first-child:not(:last-child){width:16px;height:16px;color:var(--dsw-alias-menu-icon)}
.ZogL4G_signedOutMenu [role=menuitem]>span:first-child:not(:last-child) svg{width:16px;height:16px}
.fixtureFeedback_dialog.fixtureFeedback_dialog{border-radius:var(--dsw-radius-panel);gap:38px;width:min(488px,100%)}
.fixtureFeedback_categories{flex-wrap:wrap;gap:8px;margin-top:-14px;display:flex}
.fixtureFeedback_chip{border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);height:28px;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:0 0;padding:0 12px;font-size:13px;line-height:18px;transition:background-color .12s,border-color .12s,color .12s}
.fixtureFeedback_detail{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);width:100%;min-height:116px;max-height:280px;color:var(--dsw-alias-label-primary);font:inherit;field-sizing:content;resize:none;margin-top:18px;padding:12px 14px;font-size:14px;line-height:22px;transition:border-color .12s,box-shadow .12s;display:block}
.fixtureFeedback_submit{border-radius:var(--dsw-radius-lg);width:100%;height:44px;font-size:14px;font-weight:500}
`;

async function fixture(run) {
  const bundle = await build({
    stdin: { resolveDir: root, contents: `
      import {mountAccountMore} from './src/client/compat/account-more.ts';
      window.mountMore=mountAccountMore;
    ` }, bundle: true, write: false, format: 'iife',
  });
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/theme/menus.css',
    'src/client/theme/dialogs.css', 'src/client/features/sidebar/account-menu.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-account-layout-'));
  try {
    await withPage({ url: 'about:blank', width: 640, height: 720, scale: 2, profile }, async page => {
      await page.evaluate(`
        document.documentElement.lang='en';
        document.documentElement.dataset.dshCcdStyle='true';
        const style=document.createElement('style');
        style.textContent=${JSON.stringify(hostCss)}+${JSON.stringify(styles)}+
          \`:root{--dsw-alias-label-primary:var(--ccd-text);--dsw-alias-border-l4:var(--ccd-border);
            --dsw-alias-bg-layer-1:var(--ccd-card);--dsw-radius-sm:6px;--dsw-radius-lg:12px}
           *{box-sizing:border-box}body{margin:0;font:13px/1.4 system-ui;background:var(--ccd-canvas)}\`;
        document.head.append(style);
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      await run(page);
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const icon = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8h12" stroke="currentColor"/></svg>';

test('account More label and icon align with native rows signed in and signed out', options, async () => {
  await fixture(async page => {
    for (const signedOut of [true, false]) {
      for (const lang of ['en', 'zh']) {
        await page.evaluate(`
          document.documentElement.lang=${JSON.stringify(lang)};
          document.body.innerHTML='<div class="_list_4ub78_7 ${signedOut ? 'ZogL4G_signedOutMenu' : ''}" role="menu" data-menu-material data-ccd-account-menu style="--ccd-account-menu-width:266px;--ccd-account-menu-left:16px;top:16px">'+
            ${JSON.stringify(['Settings', 'Feedback', signedOut ? 'Sign in' : 'Sign out'].map((label, i) => `<div class="_itemWrap_4ub78_90"><button id="row${i}" role="menuitem" class="_item_4ub78_90"><span class="_itemIcon_4ub78_148">${icon}</span><span class="_itemLabel_4ub78_190">${label}</span></button></div>`).join(''))}+'</div>';
          window.originalContact=document.querySelector('#row1').innerHTML;
          window.forwarded=0;
          document.querySelector('#row1').addEventListener('click',()=>window.forwarded++);
          window.stopMore=window.mountMore(document.querySelector('[role=menu]'));
        `);
        const layout = await page.evaluate(`(() => {
          const rows=[...document.querySelectorAll('[data-ccd-account-menu] > div > button')];
          return rows.map(row=>{
            const cells=[...row.children].filter(cell=>getComputedStyle(cell).display!=='none');
            return {icon:cells[0].getBoundingClientRect().width,label:cells[1].getBoundingClientRect().left};
          });
        })()`);
        if (process.env.CCD_ACCOUNT_LAYOUT_PREVIEW === '1' && signedOut && lang === 'en') {
          await mkdir(join(root, 'artifacts'), { recursive: true });
          const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 8, y: 8, width: 284, height: 190, scale: 1 } });
          await writeFile(join(root, 'artifacts/issue-13-account.png'), Buffer.from(data, 'base64'));
        }
        assert.equal(layout[1].label, layout[0].label, `${lang}, signedOut=${signedOut}: More text aligns with Settings`);
        assert.equal(layout[1].icon, layout[0].icon, `${lang}, signedOut=${signedOut}: icon seats match`);
        assert.equal(layout[1].label, layout[2].label, 'sign-in/out shares the same text column');
        await page.evaluate(`document.querySelector('#row1').click();document.querySelector('[data-ccd-account-more-menu] button').click()`);
        assert.equal(await page.evaluate('window.forwarded'), 1, 'feedback still forwards the native action');
        await page.evaluate('window.stopMore()');
        assert.equal(await page.evaluate(`document.querySelector('#row1').innerHTML===window.originalContact`), true, 'disposal restores the native row');
      }
    }
  });
});

test('feedback categories keep visible space below the modal title in English and Chinese', options, async () => {
  await fixture(async page => {
    for (const lang of ['en', 'zh']) {
      for (const dark of [false, true]) {
        await page.evaluate(`
          document.documentElement.lang=${JSON.stringify(lang)};
          document.body.toggleAttribute('data-ds-dark-theme',${dark});
          document.body.innerHTML='<div class="_root_o6lrb_6"><div role="dialog" class="_dialog_o6lrb_33 fixtureFeedback_dialog">'+
            '<div class="_content_o6lrb_63"><div class="_header_o6lrb_71"><h2 class="_title_o6lrb_79">${lang === 'en' ? 'Submit feedback' : '提交反馈'}</h2><button class="_close_o6lrb_87" aria-label="Close">×</button></div>'+
            '<div class="_body_o6lrb_115"><div role="group" class="fixtureFeedback_categories"><button class="fixtureFeedback_chip">${lang === 'en' ? 'Task result' : '任务结果'}</button><button class="fixtureFeedback_chip">${lang === 'en' ? 'Instruction understanding and following' : '指令理解与遵循'}</button></div>'+
            '<textarea class="fixtureFeedback_detail" placeholder="Add details"></textarea></div></div><div class="_footer_o6lrb_123"><button class="fixtureFeedback_submit">Submit</button></div></div></div>';
        `);
        if (process.env.CCD_ACCOUNT_LAYOUT_PREVIEW === '1' && lang === 'en' && !dark) {
          const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
          await writeFile(join(root, 'artifacts/issue-13-feedback.png'), Buffer.from(data, 'base64'));
        }
        const gap = await page.evaluate(`document.querySelector('[role=group]').getBoundingClientRect().top-document.querySelector('h2').getBoundingClientRect().bottom`);
        assert.ok(gap >= 8, `${lang}, dark=${dark}: title/category gap must be >=8px, got ${gap}px`);
        await page.evaluate(`document.querySelector('[role=dialog]').className='_dialog_o6lrb_33 _confirmation_cjd8z_1'`);
        assert.equal(await page.evaluate(`document.querySelector('._body_o6lrb_115').getBoundingClientRect().top-document.querySelector('._header_o6lrb_71').getBoundingClientRect().bottom`), 8, 'compact confirmations keep their existing body spacing');
      }
    }
  });
});
