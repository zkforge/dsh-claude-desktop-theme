#!/usr/bin/env node
/** Render the real persistent balance widget above a demo account footer.
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
    // A fixed weekday peak hour and a seeded week of spend keep the shot stable.
    const now = Date.parse('2026-10-20T10:30:00+08:00'), RealDate = Date;
    Date.now = () => now;
    const day = new RealDate(now), key = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const history = [380, 455, 290, 510, 420, 365, 440].map((spent, i) =>
      [key(new RealDate(day.getFullYear(), day.getMonth(), day.getDate() - 7 + i)), spent]);
    const items = {'ccd-balance-ledger': JSON.stringify({day:key(day),last:13170,spent:0,history})};
    Object.defineProperty(window, 'localStorage', {configurable:true, value:{
      getItem: name => items[name] ?? null, setItem: (name, value) => { items[name] = String(value); }}});
    mountAccountBalance(document.getElementById('balance'), {}, 'sidebar');
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
    document.body.innerHTML='<aside id="menu"><div class="demo-space"></div><div id="balance" data-ccd-balance-slot></div><div class="demo-account"><span class="demo-avatar">K</span><span>演示账号</span><span class="demo-chevron">⌄</span></div></aside>';
    const style=document.createElement('style');
    style.textContent=${JSON.stringify(styles)}+
      '@font-face{font-family:Geist;src:url(data:font/ttf;base64,${font}) format("truetype");font-weight:100 900}'+
      'html[data-dsh-ccd-style="true"]{--ccd-font-ui:Geist,"PingFang SC",sans-serif}'+
      'body{margin:0;background:var(--ccd-canvas);font-family:var(--ccd-font-ui)}'+
      '#menu{position:fixed;left:560px;top:350px;width:240px;padding:0 12px 8px;background:var(--ccd-sidebar);border-right:0.5px solid var(--ccd-border);font-family:var(--ccd-font-ui)}'+
      '.demo-space{height:40px}.demo-account{display:flex;align-items:center;gap:6px;height:42px;border-top:1px solid var(--ccd-border-soft);padding:4px 6px 0;color:var(--ccd-text-secondary);font-size:13px}.demo-avatar{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--ccd-hover);font-size:11px}.demo-chevron{margin-left:8px}';
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
    assert.equal(facts.amount, 'API 余额¥128.50峰时至 12:00');
    assert.equal(facts.busy, false);
    assert.equal(facts.title, '');
    const shot = await page.send('Page.captureScreenshot',{format:'png',clip:facts.clip});
    const png=join(work,`account-balance-${theme}.png`);
    await writeFile(png,Buffer.from(shot.data,'base64'));
    await run('cwebp',['-quiet','-q','82',png,'-o',join(output,`account-balance-${theme}.webp`)]);
    console.log('assets/screenshots/account-balance-'+theme+'.webp');
  }
});
