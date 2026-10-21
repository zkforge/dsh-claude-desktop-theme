#!/usr/bin/env node
/** Render the real model picker with a demo directory in both colour schemes.
 * Usage: node scripts/model-picker-screenshots.mjs
 * Captures a component crop at @2x; full application screenshots stay manual.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { run, withPage } from './lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = join(root, '.cache/model-picker-screenshots');
const output = join(root, 'assets/screenshots');
await mkdir(work, { recursive: true });
await mkdir(output, { recursive: true });

const bundle = await build({
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {ModelControls} from './src/client/features/model-controls/ModelControls.tsx';
    import {mountScrollPills} from './src/client/compat/scroll-pill.ts';
    // Keep pricing state and the minute countdown reproducible for the demo.
    Date.now = () => Date.parse('2026-10-20T05:42:00Z');
    const reasoning = {defaultEffort:'high', efforts:[
      {id:'low',name:'Low'}, {id:'medium',name:'Medium'}, {id:'high',name:'High'}, {id:'max',name:'Max'},
    ]};
    const group = (id, name, models) => ({id, name,
      models:models.map(([id, name])=>({id, name, reasoning})),
    });
    const directory = {
      current:{provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'high'},
      groups:[
        group('deepseek-official','DeepSeek',[['deepseek-flash','DeepSeek-V4.1-Flash'],['deepseek-v4-pro','DeepSeek-V4-Pro']]),
        group('magpie','Magpie',[['step-5-preview','Step-5-Preview'],['hy3','Hy3'],['kimi-k3','Kimi-K3'],
          ['deepseek-v4.1-flash','Deepseek-V4.1-Flash'],['gpt-6.1-sol','GPT-6.1-Sol']]),
      ],
      status:'ready', pending:null, failures:[], error:null, routable:true,
    };
    const words = {
      'menu.model':'模型', 'search.placeholder':'搜索模型',
      'trigger.fallback':'选择模型', 'trigger.selectAria':'选择模型',
      'effort.providerDefault':'提供商默认',
    };
    createRoot(document.getElementById('preview')).render(<ModelControls
      showModelIcons={true} locked={false} available={true}
      useDirectory={()=>directory} load={()=>{}} select={async()=>({ok:true})} selectEffort={()=>{}}
      t={(key, params)=>key==='trigger.aria' ? '选择模型，当前 '+params.model : words[key] ?? key}
    />);
    mountScrollPills(document, error=>{throw error;});
  ` },
  bundle: true, write: false, format: 'iife', jsx: 'automatic',
});
const styles = (await Promise.all([
  'src/client/theme/tokens.css', 'src/client/theme/scrollbars.css',
  'src/client/features/model-controls/controls.css',
].map(path => readFile(join(root, path), 'utf8')))).join('\n');
const font = (await readFile(join(root, 'assets/fonts/Geist-Variable.ttf'))).toString('base64');

await withPage({
  url: 'about:blank', width: 1392, height: 932, scale: 2,
  hideScrollbars: false, profile: join(work, 'profile'),
}, async page => {
  await page.evaluate(`(async()=>{
    document.documentElement.setAttribute('data-dsh-ccd-style','true');
    document.documentElement.lang='zh-CN';
    document.body.innerHTML='<div id="preview"></div>';
    const style=document.createElement('style');
    style.textContent=${JSON.stringify(styles)}+
      '@font-face{font-family:Geist;src:url(data:font/ttf;base64,${font}) format("truetype");font-weight:100 900}'+
      'html[data-dsh-ccd-style="true"]{--ccd-font-ui:Geist,"PingFang SC",sans-serif}'+
      'body{margin:0;background:var(--ccd-canvas);font-family:var(--ccd-font-ui)}'+
      '#preview{position:absolute;left:680px;top:700px;width:240px}';
    document.head.append(style);
    await document.fonts.load('13px Geist');
  })()`);
  await page.evaluate(bundle.outputFiles[0].text);
  await page.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  await page.evaluate(`document.querySelector('[data-ccd-model-trigger]').click()`);
  await page.evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);

  for (const theme of ['light', 'dark']) {
    const facts = await page.evaluate(`(async()=>{
      document.body.toggleAttribute('data-ds-dark-theme', ${theme === 'dark'});
      const list=document.querySelector('.ccd-model-options');
      list.scrollTop=1;
      list.dispatchEvent(new Event('scroll'));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const panel=document.querySelector('.ccd-model-panel');
      const p=panel.getBoundingClientRect(), c=document.querySelector('.ccd-model-controls').getBoundingClientRect();
      const row=list.querySelector('.ccd-price-anchor-row'), dot=row?.querySelector('.ccd-model-name .ccd-price-badge');
      const d=dot?.getBoundingClientRect(), b=row?.querySelector('button').getBoundingClientRect(), n=row?.querySelector('.ccd-model-name-text').getBoundingClientRect();
      const left=Math.floor(Math.min(p.left,c.left)-32), top=Math.floor(p.top-32);
      return {
        clip:{x:left,y:top,width:Math.ceil(Math.max(p.right,c.right)+32)-left,height:Math.ceil(c.bottom+32)-top,scale:1},
        open:panel.matches(':popover-open'),
        icons:list.querySelectorAll('.ccd-model-glyph svg').length,
        chosen:list.querySelector('button[aria-pressed="true"] .ccd-model-name-text')?.textContent,
        card:getComputedStyle(panel).backgroundColor,
        badgeAfterName:!!d && !!b && !!n && d.width>10 && d.height===16 && Math.abs(d.left-n.right-6)<1 && d.right<b.right,
        priceBadges:list.querySelectorAll('.ccd-price-anchor-row .ccd-model-name .ccd-price-badge').length,
      };
    })()`);
    assert.equal(facts.open, true);
    assert.equal(facts.badgeAfterName, true, 'period badge follows the model name with a 6px gap');
    assert.equal(facts.priceBadges, 2, 'both official models show a period badge');
    assert.ok(facts.icons > 0);
    assert.equal(facts.chosen, 'DeepSeek-V4.1-Flash');
    assert.equal(facts.card, theme === 'dark' ? 'rgb(48, 48, 46)' : 'rgb(255, 255, 255)');
    const shot = await page.send('Page.captureScreenshot', { format:'png', clip:facts.clip });
    const png = join(work, `model-picker-${theme}.png`);
    const webp = join(output, `model-picker-${theme}.webp`);
    await writeFile(png, Buffer.from(shot.data, 'base64'));
    await run('cwebp', ['-quiet', '-q', '82', png, '-o', webp]);
    console.log(`assets/screenshots/model-picker-${theme}.webp (${facts.clip.width * 2}×${facts.clip.height * 2})`);

    // Include the real pricing hover card in the README component gallery.
    const row = await page.evaluate(`(()=>{
      const row=document.querySelector('[data-model-option]');
      const r=row.getBoundingClientRect(); return {x:r.left+20,y:r.top+r.height/2};
    })()`);
    await page.send('Input.dispatchMouseEvent', {type:'mouseMoved', x:row.x, y:row.y});
    await page.evaluate('new Promise(resolve=>setTimeout(resolve,900))');
    const pricing = await page.evaluate(`(()=>{
      const card=document.querySelector('.ccd-price-tooltip');
      if(!card?.matches(':popover-open')) throw new Error('Pricing hover did not open');
      const p=document.querySelector('.ccd-model-panel').getBoundingClientRect(), t=card.getBoundingClientRect(), c=document.querySelector('.ccd-model-controls').getBoundingClientRect();
      const x=Math.floor(Math.min(p.left,t.left,c.left)-24), y=Math.floor(Math.min(p.top,t.top)-24);
      return {text:card.textContent,clip:{x,y,width:Math.ceil(Math.max(p.right,t.right,c.right)+24)-x,height:Math.ceil(Math.max(p.bottom,t.bottom,c.bottom)+24)-y,scale:1}};
    })()`);
    assert.ok(pricing.text.includes('18 分钟'));
    assert.ok(pricing.text.includes('¥0.02'));
    assert.ok(pricing.text.includes('元 / 百万 tokens'));
    assert.ok(!pricing.text.includes('下次切换') && !pricing.text.includes('api-docs.deepseek.com'));
    const preview = await page.send('Page.captureScreenshot', {format:'png',clip:pricing.clip});
    const pricingPng = join(work, `model-pricing-${theme}.png`);
    await writeFile(pricingPng, Buffer.from(preview.data,'base64'));
    await run('cwebp', ['-quiet', '-q', '82', pricingPng, '-o', join(output, `model-pricing-${theme}.webp`)]);
    await page.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:0,y:0});
    await page.evaluate(`new Promise(resolve=>setTimeout(resolve,150))`);
    // Keyboard focus exposes the same information; Escape dismisses only it.
    await page.evaluate(`document.querySelector('.ccd-model-search').focus()`);
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown'});
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown'});
    await page.evaluate(`new Promise(resolve=>setTimeout(resolve,900))`);
    assert.equal(await page.evaluate(`!!document.querySelector('.ccd-price-tooltip')?.matches(':popover-open')`), true);
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    assert.equal(await page.evaluate(`document.querySelector('.ccd-price-tooltip')===null && document.querySelector('.ccd-model-panel').matches(':popover-open')`), true);
    await page.evaluate(`document.querySelector('.ccd-model-search').focus()`);
  }
  // Short catalogs must not reserve an empty scrollbar strip on the right.
  await page.send('Input.insertText', {text:'DeepSeek'});
  await page.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
  assert.equal(await page.evaluate(`(()=>{
    const list=document.querySelector('.ccd-model-options'), row=list.querySelector('[data-model-option]');
    return list.scrollHeight<=list.clientHeight && list.offsetWidth===list.clientWidth && Math.abs(row.getBoundingClientRect().right-list.getBoundingClientRect().right)<1;
  })()`), true, 'short lists extend to the same inset on both sides');
});
