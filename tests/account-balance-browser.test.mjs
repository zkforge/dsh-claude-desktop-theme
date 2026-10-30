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
const ready = { state: 'ready', balance: { total: '12.30', toppedUp: '10.00', granted: '2.30' } };
const card = '[data-ccd-account-balance][data-ccd-balance-card]';

async function fixture(run) {
  const bundle = await build({
    stdin: { resolveDir: root, contents: `
      import {mountAccountBalance} from './src/client/compat/account-balance.ts';
      import {mountAccountMenu} from './src/client/compat/account-menu.ts';
      window.mountBalance=mountAccountBalance;
      window.mountMenu=mountAccountMenu;
    ` }, bundle: true, write: false, format: 'iife',
  });
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/features/sidebar/account-menu.css',
  ].map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-account-balance-'));
  try {
    await withPage({ url: 'about:blank', width: 360, height: 240, scale: 2, profile }, async page => {
      await page.evaluate(`
        document.documentElement.lang='en';
        document.documentElement.setAttribute('data-dsh-ccd-style','true');
        document.body.innerHTML='<div id="fixture"></div>';
        const style=document.createElement('style');
        style.textContent=${JSON.stringify(styles)}+\`
          body{margin:0;background:var(--ccd-sidebar);color:var(--ccd-text);font-family:var(--ccd-font-ui)}
          #fixture{box-sizing:border-box;width:264px;margin:28px;padding:10px;background:var(--ccd-sidebar)}
          ._3WPZCG_root{display:flex;flex-direction:column;width:100%;box-sizing:border-box}
          ._3WPZCG_footArea{height:32px;display:flex;position:relative;align-items:center}
          .ZogL4G_trigger{display:flex;align-items:center;background:transparent;border:0;color:inherit;font:inherit}
        \`;
        document.head.append(style);
        window.requests=[];window.response=${JSON.stringify(ready)};window.fail=false;
        window.fetch=async (url,options)=>{
          window.requests.push({url:String(url),signal:options.signal});
          if(window.fail)throw new Error('Offline');
          return {ok:true,json:async()=>window.response};
        };
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      await run(page);
    });
  } finally {
    // mkdtemp returns this test's own isolated Chrome profile.
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function until(page, expression, message) {
  const success = await page.evaluate(`(async()=>{
    for(let i=0;i<80;i++){
      if(${expression})return true;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    return false;
  })()`);
  assert.equal(success, true, message);
}

async function key(page, key, code, windowsVirtualKeyCode) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(key === 'Enter' ? { text: '\r' } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
}

test('sidebar balance shows total and period, refreshes with keyboard, and fits both themes at 200px', options, async () => {
  await fixture(async page => {
    await page.evaluate(`window.stopBalance=window.mountBalance(document.querySelector('#fixture'),{},'sidebar')`);
    await until(page, `document.querySelector('${card} [data-ccd-balance-amount]')?.textContent==='¥12.30'`, 'sidebar card reaches ready state');
    assert.equal(await page.evaluate(`document.querySelector('${card}').tagName`), 'BUTTON');
    assert.match(await page.evaluate(`document.querySelector('${card}').textContent`), /API balance/);
    const details = await page.evaluate(`document.querySelector('${card} [data-ccd-balance-details]').textContent`);
    assert.doesNotMatch(details, /Granted|2\.30|10\.00|Today/, 'breakdown and spend live in the hover hint');
    assert.equal(await page.evaluate(`document.querySelector('${card} [data-ccd-balance-details]').getBoundingClientRect().height>0`), true, 'period line is visible without hover');
    assert.match(await page.evaluate(`document.querySelector('[data-ccd-balance-hint]').textContent`), /Spent today¥0\.00.*Top-up balance¥10\.00Granted balance¥2\.30/);

    await key(page, 'Tab', 'Tab', 9);
    assert.equal(await page.evaluate(`document.activeElement===document.querySelector('${card}')`), true, 'card participates in keyboard tab order');
    const focus = await page.evaluate(`(()=>{const el=document.activeElement,s=getComputedStyle(el);return {visible:el.matches(':focus-visible'),outlined:s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0};})()`);
    assert.deepEqual(focus, { visible: true, outlined: true }, 'keyboard focus has a visible outline');
    await page.evaluate(`window.response={state:'ready',balance:{total:'14.50',toppedUp:'12.20',granted:'2.30'}}`);
    await key(page, 'Enter', 'Enter', 13);
    await until(page, `document.querySelector('[data-ccd-balance-amount]').textContent==='¥14.50'`, 'Enter refreshes balance');
    assert.equal(await page.evaluate('window.requests.length'), 2);

    await page.evaluate(`window.response=${JSON.stringify(ready)};document.querySelector('${card}').click();document.activeElement.blur()`);
    await until(page, `document.querySelector('[data-ccd-balance-amount]').textContent==='¥12.30'`, 'demo balance restored');
    const backgrounds = [];
    for (const theme of ['light', 'dark']) {
      await page.evaluate(`document.body.toggleAttribute('data-ds-dark-theme',${theme === 'dark'});document.querySelector('#fixture').style.width='200px'`);
      const layout = await page.evaluate(`(()=>{
        const el=document.querySelector('${card}'),r=el.getBoundingClientRect(),details=el.querySelector('[data-ccd-balance-details]');
        const label=el.querySelector(':scope > span'),period=details.querySelector('.ccd-balance-period');
        return {width:r.width,overflow:el.scrollWidth>el.clientWidth,detailsVisible:details.getBoundingClientRect().height>0,
          periodAtLeft:Math.abs(period.getBoundingClientRect().left-label.getBoundingClientRect().left)<1,
          amountSize:getComputedStyle(el.querySelector('[data-ccd-balance-amount]')).fontSize,
          outside:Array.from(el.querySelectorAll('*')).some(child=>{const c=child.getBoundingClientRect();return c.width>0&&(c.left<r.left-1||c.right>r.right+1)}),
          background:getComputedStyle(document.body).backgroundColor};
      })()`);
      assert.ok(layout.width <= 200, `${theme}: card fits a 200px sidebar`);
      assert.equal(layout.overflow, false, `${theme}: no horizontal overflow`);
      assert.equal(layout.outside, false, `${theme}: children remain inside card`);
      assert.equal(layout.detailsVisible, true, `${theme}: period line remains visible`);
      assert.equal(layout.periodAtLeft, true, `${theme}: period aligns with the balance label`);
      assert.equal(layout.amountSize, '16px', `${theme}: total has the larger type size`);
      backgrounds.push(layout.background);
      if (process.env.CCD_BALANCE_PREVIEW === '1') {
        await page.evaluate(`document.querySelector('#fixture').style.width='264px'`);
        const { data } = await page.send('Page.captureScreenshot', { format: 'png', clip: { x: 18, y: 18, width: 284, height: 180, scale: 1 } });
        await mkdir(join(root, 'artifacts'), { recursive: true });
        await writeFile(join(root, `artifacts/account-balance-${theme}.png`), Buffer.from(data, 'base64'));
      }
    }
    assert.notEqual(backgrounds[0], backgrounds[1], 'real light and dark theme tokens differ');
    await page.evaluate(`window.fail=true;document.querySelector('${card}').click()`);
    await until(page, `/Unavailable/.test(document.querySelector('[data-ccd-balance-amount]').textContent)`, 'network failure offers retry');
    assert.equal(await page.evaluate(`document.querySelector('${card}').hasAttribute('aria-busy')`), false);
    assert.doesNotMatch(await page.evaluate(`document.querySelector('${card}').innerText`), /10\.00|2\.30/, 'failure hides stale breakdown');
    for (const state of ['unconfigured', 'unauthorized', 'no-cny', 'offline']) {
      await page.evaluate(`window.fail=${state === 'offline'};window.response={state:${JSON.stringify(state)}};document.querySelector('${card}').click()`);
      await until(page, `!document.querySelector('${card}').hasAttribute('aria-busy')`, 'failure state settles');
      const layout = await page.evaluate(`(()=>{
        const el=document.querySelector('${card}'),label=el.querySelector(':scope > span'),amount=el.querySelector('[data-ccd-balance-amount]');
        const l=label.getBoundingClientRect(),a=amount.getBoundingClientRect();
        return {sameRow:a.top<l.bottom&&a.bottom>l.top,oneLine:a.height<=18,overflow:el.scrollWidth>el.clientWidth};
      })()`);
      assert.equal(layout.sameRow, true, state + ': status stays beside the balance label');
      assert.equal(layout.oneLine, true, state + ': status does not wrap');
      assert.equal(layout.overflow, false, state + ': a long status fits the narrow sidebar');
    }
    await page.evaluate('window.stopBalance()');
    assert.equal(await page.evaluate(`document.querySelector('${card}')===null`), true);
  });
});

test('closed account menu owns a sidebar balance slot through collapse, trigger replacement and disposal', options, async () => {
  await fixture(async page => {
    await page.evaluate(`
      window.errors=[];
      document.querySelector('#fixture').innerHTML='<aside class="_3WPZCG_root"><div class="_3WPZCG_footArea"><button class="ZogL4G_trigger" data-collapsed="false" aria-expanded="false"><span class="ZogL4G_label">Demo account</span></button></div></aside>';
      window.stopMenu=window.mountMenu(document,error=>window.errors.push(String(error)));
    `);
    await until(page, `document.querySelector('[data-ccd-balance-slot] ${card} [data-ccd-balance-amount]')?.textContent==='¥12.30'`, 'closed menu immediately loads sidebar balance');
    assert.equal(await page.evaluate('window.requests.length'), 1);
    assert.equal(await page.evaluate(`document.querySelector('[role="menu"]')===null`), true);
    assert.equal(await page.evaluate(`document.querySelector('[data-ccd-balance-slot]').nextElementSibling.matches('._3WPZCG_footArea')`), true, 'balance slot precedes host foot area');
    await page.evaluate(`window.response={state:'ready',balance:{total:'13.30',toppedUp:'11.00',granted:'2.30'}};document.querySelector('${card}').click()`);
    await until(page, `document.querySelector('[data-ccd-balance-amount]').textContent==='¥13.30'`, 'click refreshes closed-menu balance');
    await page.evaluate(`document.querySelector('._3WPZCG_root').classList.add('_3WPZCG_collapsed');document.querySelector('.ZogL4G_trigger').setAttribute('data-collapsed','true')`);
    await until(page, `!document.querySelector('[data-ccd-balance-slot]')||document.querySelector('[data-ccd-balance-slot]').getBoundingClientRect().height===0`, 'collapsed rail hides balance slot');
    await page.evaluate(`document.querySelector('._3WPZCG_root').classList.remove('_3WPZCG_collapsed');document.querySelector('.ZogL4G_trigger').setAttribute('data-collapsed','false')`);
    await until(page, `document.querySelector('${card}')?.getBoundingClientRect().height>0`, 'expanding restores balance');
    await page.evaluate(`const old=document.querySelector('.ZogL4G_trigger');old.replaceWith(old.cloneNode(true))`);
    await until(page, `document.querySelectorAll('[data-ccd-balance-slot]').length===1&&document.querySelectorAll('${card}').length===1`, 'replacement leaves exactly one balance card');
    await page.evaluate('window.stopMenu()');
    assert.equal(await page.evaluate(`document.querySelector('[data-ccd-balance-slot]')===null`), true, 'dispose removes owned slot');
    assert.equal(await page.evaluate(`document.querySelector('[data-ccd-plugin-feedback]')===null`), true);
    const requests = await page.evaluate('window.requests.length');
    await page.evaluate(`document.dispatchEvent(new Event('visibilitychange'));document.querySelector('._3WPZCG_root').append(document.createElement('div'));new Promise(resolve=>setTimeout(resolve,60))`);
    assert.equal(await page.evaluate('window.requests.length'), requests, 'disposed observers and visibility handler cannot restart polling');
    assert.deepEqual(await page.evaluate('window.errors'), []);
  });
});

test('disabling API balance removes both placements and prevents requests after configuration remount', options, async () => {
  await fixture(async page => {
    await page.evaluate(`
      document.querySelector('#fixture').innerHTML='<aside class="_3WPZCG_root"><div class="_3WPZCG_footArea"><button class="ZogL4G_trigger" aria-expanded="true"><span class="ZogL4G_label">Demo account</span></button></div></aside><div role="menu" style="position:fixed"><button role="menuitem">Settings</button></div>';
      window.mountWithBalance=enabled=>window.mountMenu(document,e=>{throw e},null,enabled);
      window.stopMenu=window.mountWithBalance(false);
      new Promise(r=>setTimeout(r,30));
    `);
    assert.equal(await page.evaluate('window.requests.length'), 0);
    assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-account-balance], [data-ccd-balance-slot]").length'), 0);
    assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-plugin-feedback]").length'), 1, 'other account controls remain available');
    await page.evaluate('window.stopMenu();window.stopMenu=window.mountWithBalance(true)');
    await until(page, `document.querySelector('${card} [data-ccd-balance-amount]')?.textContent==='¥12.30'`, 'enabling mounts the balance reader');
    await page.evaluate('window.stopMenu();window.stopMenu=window.mountWithBalance(false)');
    const requests = await page.evaluate('window.requests.length');
    await page.evaluate(`
      document.querySelector('._3WPZCG_root').classList.add('_3WPZCG_collapsed');
      document.dispatchEvent(new Event('visibilitychange'));
      new Promise(r=>setTimeout(r,60));
    `);
    assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-account-balance], [data-ccd-balance-slot], [data-ccd-balance-hint]").length'), 0);
    assert.equal(await page.evaluate('window.requests.length'), requests, 'collapse and visibility changes do not restart disabled readers');
    await page.evaluate('window.stopMenu()');
  });
});
