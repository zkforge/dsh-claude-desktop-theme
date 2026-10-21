#!/usr/bin/env node
/** Render the real balance widget in a demo account menu, without API access.
 * Usage: node scripts/account-balance-screenshots.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { run, withPage } from './lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, '.cache/account-balance-screenshots');
const output = join(root, 'assets/screenshots');
await mkdir(work, { recursive: true });
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: { resolveDir: root, loader: 'ts', contents: `
    import {mountAccountBalance} from './src/client/compat/account-balance.ts';
    // Demo data only: do not read credentials or contact the balance endpoint.
    globalThis.fetch = async () => Response.json({state:'ready',
      balance:{total:'128.50',toppedUp:'100.00',granted:'28.50'}});
    mountAccountBalance(document.getElementById('menu'));
  ` },
  bundle: true, write: false, format: 'iife',
});
const styles = (await Promise.all([
  'src/client/theme/tokens.css', 'src/client/theme/menus.css',
  'src/client/features/sidebar/account-menu.css',
].map(path => readFile(join(root, path), 'utf8')))).join('\n');
const font = (await readFile(join(root, 'assets/fonts/Geist-Variable.ttf'))).toString('base64');

await withPage({url:'about:blank',width:1392,height:932,scale:2,profile:join(work,'profile')}, async page => {
  await page.evaluate(`(async()=>{
    document.documentElement.setAttribute('data-dsh-ccd-style','true');
    document.documentElement.lang='zh-CN';
    document.body.innerHTML='<div id="menu" role="menu" data-menu-material data-ccd-account-menu style="--ccd-account-name:&quot;演示账号&quot;;--ccd-account-menu-left:560px"><button role="menuitem"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m9 3-1 3-3 1v4l-2 1 2 2v4l3 1 1 3h6l1-3 3-1v-4l2-2-2-1V7l-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg><span>设置</span></button></div>';
    const style=document.createElement('style');
    style.textContent=${JSON.stringify(styles)}+
      '@font-face{font-family:Geist;src:url(data:font/ttf;base64,${font}) format("truetype");font-weight:100 900}'+
      'html[data-dsh-ccd-style="true"]{--ccd-font-ui:Geist,"PingFang SC",sans-serif}'+
      'body{margin:0;background:var(--ccd-canvas);font-family:var(--ccd-font-ui)}'+
      '#menu{position:fixed;top:400px;font-family:var(--ccd-font-ui)}'+
      '#menu>button{display:flex;align-items:center;gap:6px;width:100%;border:0;background:transparent;font-family:inherit;text-align:left;box-sizing:border-box}';
    document.head.append(style);
    await document.fonts.load('13px Geist');
  })()`);
  await page.evaluate(bundle.outputFiles[0].text);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(`document.body.toggleAttribute('data-ds-dark-theme',${theme === 'dark'})`);
    await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const facts = await page.evaluate(`(()=>{
      const row=document.querySelector('[data-ccd-account-balance]');
      const p=document.getElementById('menu').getBoundingClientRect();
      return {amount:row.textContent,title:row.title,busy:row.hasAttribute('aria-busy'),
        clip:{x:Math.floor(p.left-32),y:Math.floor(p.top-32),width:Math.ceil(p.width+64),height:Math.ceil(p.height+64),scale:1}};
    })()`);
    assert.equal(facts.amount, '余额¥128.50');
    assert.equal(facts.busy, false);
    assert.ok(facts.title.includes('充值余额 ¥100.00') && facts.title.includes('赠金余额 ¥28.50'));
    const shot = await page.send('Page.captureScreenshot',{format:'png',clip:facts.clip});
    const png=join(work,`account-balance-${theme}.png`);
    await writeFile(png,Buffer.from(shot.data,'base64'));
    await run('cwebp',['-quiet','-q','82',png,'-o',join(output,`account-balance-${theme}.webp`)]);
    console.log('assets/screenshots/account-balance-'+theme+'.webp');
  }
});
