#!/usr/bin/env node
/** Context breakdown component crops, using demo data and the host ring geometry.
 * Usage: node scripts/context-panel-screenshots.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { run, withPage } from './lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, '.cache/context-panel-screenshots');
const output = join(root, 'assets/screenshots');
await mkdir(work, { recursive: true });
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ContextPanel} from './src/client/features/context-panel/ContextPanel.tsx';
    import {contextBreakdown} from './src/shared/context.ts';
    const mcp=[['mcp__demo__search',18000],['mcp__demo__read',10000]];
    const tools=[['bash',9500],['read_file',6500]];
    const source={window:200000,used:92000,systemTokens:4600,toolsTokens:44000,
      tools:[...mcp,...tools],messageTokens:38000,skillTokens:4800,fileTokens:600,compaction:160000};
    let state={open:true,expanded:false,anchor:document.getElementById('ring'),
      breakdown:contextBreakdown(source),mcp,tools,
      files:[['AGENTS.md',400],['README.md',200]],skills:[['code-review',3000],['docs',1800]]};
    const listeners=new Set();
    const publish=next=>{state={...state,...next};listeners.forEach(fn=>fn());};
    const port={getSnapshot:()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
      close:()=>publish({open:false}),toggleExpanded:()=>publish({expanded:!state.expanded})};
    // DSH owns the trigger. Preserve its 14px circle, 5.5px radius and 2px stroke.
    const circumference=2*Math.PI*5.5;
    document.getElementById('ring').innerHTML='<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">'+
      '<circle cx="7" cy="7" r="5.5" fill="none" stroke-width="2" stroke="var(--ccd-context-ring-track)"/>'+
      '<circle class="y0jqnG_fill" cx="7" cy="7" r="5.5" fill="none" stroke-width="2" stroke-linecap="round" transform="rotate(-90 7 7)" '+
      'stroke-dasharray="'+circumference+'" stroke-dashoffset="'+circumference*(1-state.breakdown.percent/100)+'"/></svg>';
    createRoot(document.getElementById('overlay')).render(<ContextPanel port={port}/>);
  ` },
  bundle: true, write: false, format: 'iife', jsx: 'automatic',
});
const styles = (await Promise.all([
  'src/client/theme/tokens.css', 'src/client/theme/menus.css', 'src/client/theme/composer.css',
  'src/client/features/context-panel/context-panel.css',
].map(path => readFile(join(root, path), 'utf8')))).join('\n');
const font = (await readFile(join(root, 'assets/fonts/Geist-Variable.ttf'))).toString('base64');

await withPage({url:'about:blank',width:1392,height:932,scale:2,profile:join(work,'profile')}, async page => {
  await page.evaluate(`(async()=>{
    document.documentElement.setAttribute('data-dsh-ccd-style','true');
    document.documentElement.lang='zh-CN';
    document.body.innerHTML='<button id="ring" class="y0jqnG_trigger" aria-label="上下文窗口，已用 46%" aria-haspopup="dialog" aria-expanded="true"></button><div id="overlay"></div>';
    const style=document.createElement('style');
    style.textContent=${JSON.stringify(styles)}+
      '@font-face{font-family:Geist;src:url(data:font/ttf;base64,${font}) format("truetype");font-weight:100 900}'+
      'html[data-dsh-ccd-style="true"]{--ccd-font-ui:Geist,"PingFang SC",sans-serif}'+
      'body{margin:0;background:var(--ccd-canvas);--dsw-alias-border-l3:var(--ccd-border)}'+
      '#ring{position:absolute;left:894px;top:700px;box-sizing:border-box;width:26px;height:20px;padding:0;border:0;background:transparent;display:flex;align-items:center;justify-content:center}';
    document.head.append(style);
    await document.fonts.load('13px Geist');
  })()`);
  await page.evaluate(bundle.outputFiles[0].text);
  const settle = () => page.evaluate('new Promise(resolve=>setTimeout(resolve,220))');
  await settle();
  await page.evaluate(`document.querySelector('[data-ccd-context-head]').click()`);
  await settle();
  await page.evaluate(`document.querySelector('[data-ccd-context-group] button').click()`);
  await settle();
  for (const theme of ['light', 'dark']) {
    await page.evaluate(`document.body.toggleAttribute('data-ds-dark-theme',${theme === 'dark'})`);
    await settle();
    const facts = await page.evaluate(`(()=>{
      const panel=document.querySelector('[data-ccd-context-panel]'), p=panel.getBoundingClientRect(),r=document.getElementById('ring').getBoundingClientRect();
      return {open:panel.matches(':popover-open'),reading:document.querySelector('[data-ccd-context-figures]').textContent,
        rows:panel.querySelectorAll('[data-ccd-context-row]').length,details:panel.querySelectorAll('.ccd-context-detail-row').length,
        card:getComputedStyle(panel).backgroundColor,
        clip:{x:Math.floor(p.left-32),y:Math.floor(p.top-32),width:Math.ceil(p.width+64),height:Math.ceil(r.bottom-p.top+64),scale:1}};
    })()`);
    assert.equal(facts.open, true);
    assert.equal(facts.reading, '92k / 200k (46%)');
    assert.equal(facts.rows, 8);
    assert.equal(facts.details, 2);
    assert.equal(facts.card, theme === 'dark' ? 'rgb(48, 48, 46)' : 'rgb(255, 255, 255)');
    const shot = await page.send('Page.captureScreenshot',{format:'png',clip:facts.clip});
    const png=join(work,`context-panel-${theme}.png`);
    await writeFile(png,Buffer.from(shot.data,'base64'));
    await run('cwebp',['-quiet','-q','82',png,'-o',join(output,`context-panel-${theme}.webp`)]);
    console.log('assets/screenshots/context-panel-'+theme+'.webp');
  }
});
