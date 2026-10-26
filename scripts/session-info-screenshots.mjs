#!/usr/bin/env node
/** Real session cards with demo data, at the README's 1392×932, @2x, Geist settings. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPage, run } from './lib/headless-chrome.mjs';
import { sessionInfoDemo, mountSessionInfoDemo } from './lib/session-info-demo.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, '.cache/session-info-screenshots');
await mkdir(work, { recursive: true });
const demo = await sessionInfoDemo();
const font = (await readFile(join(root, 'assets/fonts/Geist-Variable.ttf'))).toString('base64');
await withPage({ url: 'about:blank', width: 1392, height: 932, scale: 2, profile: join(work, 'profile') }, async page => {
  await mountSessionInfoDemo(page, demo);
  await page.evaluate(`window.environmentCwd='/demo/projects/desktop-theme/worktrees/session-preview';window.environmentWorktree=true;window.demo.port.retry()`);
  await page.evaluate(`(async()=>{const style=document.createElement('style');style.textContent=
    '@font-face{font-family:Geist;src:url(data:font/ttf;base64,${font}) format("truetype");font-weight:100 900}'+
    'html[data-dsh-ccd-style="true"]{--ccd-font-ui:Geist,"PingFang SC",sans-serif}';
    document.head.append(style);document.querySelector('.ccd-info-toggle').click();
    await document.fonts.load('12px Geist');})()`);
  await page.evaluate('new Promise(resolve=>setTimeout(resolve,200))');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(`document.body.toggleAttribute('data-ds-dark-theme',${theme === 'dark'})`);
    const clip = await page.evaluate(`(()=>{const p=document.querySelector('[data-ccd-session-cards]').getBoundingClientRect();
      return {x:p.left-12,y:0,width:p.width+24,height:p.bottom+12,scale:1};})()`);
    const shot = await page.send('Page.captureScreenshot', { format: 'png', clip });
    const png = join(work, `session-info-${theme}.png`);
    await writeFile(png, Buffer.from(shot.data, 'base64'));
    await run('cwebp', ['-quiet', '-q', '82', png, '-o', join(root, `assets/screenshots/session-info-${theme}.webp`)]);
    console.log(`assets/screenshots/session-info-${theme}.webp`);
  }
  await page.evaluate('window.demo.dispose()');
});
