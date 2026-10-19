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
    const reasoning = {defaultEffort:'high', efforts:[
      {id:'low',name:'Low'}, {id:'medium',name:'Medium'}, {id:'high',name:'High'}, {id:'max',name:'Max'},
    ]};
    const group = (id, name, models) => ({id, name,
      models:models.map(([id, name])=>({id, name, reasoning})),
    });
    const directory = {
      current:{provider:'anthropic',model:'claude-sonnet',reasoningEffort:'high'},
      groups:[
        group('deepseek','DeepSeek',[['deepseek-v3','DeepSeek V3'],['deepseek-r1','DeepSeek R1']]),
        group('anthropic','Anthropic',[['claude-sonnet','Claude Sonnet'],['claude-opus','Claude Opus'],['claude-haiku','Claude Haiku']]),
        group('openai','OpenAI',[['gpt-4.1','GPT-4.1'],['o3','o3'],['o4-mini','o4-mini']]),
        group('google','Google',[['gemini-pro','Gemini Pro'],['gemini-flash','Gemini Flash']]),
        group('qwen','Qwen',[['qwen-coder','Qwen Coder'],['qwen-max','Qwen Max']]),
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
      const left=Math.floor(Math.min(p.left,c.left)-32), top=Math.floor(p.top-32);
      return {
        clip:{x:left,y:top,width:Math.ceil(Math.max(p.right,c.right)+32)-left,height:Math.ceil(c.bottom+32)-top,scale:1},
        open:panel.matches(':popover-open'),
        icons:list.querySelectorAll('.ccd-model-glyph svg').length,
        chosen:list.querySelector('button[aria-pressed="true"] .ccd-model-name')?.textContent,
        card:getComputedStyle(panel).backgroundColor,
      };
    })()`);
    assert.equal(facts.open, true);
    assert.ok(facts.icons > 0);
    assert.equal(facts.chosen, 'Claude Sonnet');
    assert.equal(facts.card, theme === 'dark' ? 'rgb(48, 48, 46)' : 'rgb(255, 255, 255)');
    const shot = await page.send('Page.captureScreenshot', { format:'png', clip:facts.clip });
    const png = join(work, `model-picker-${theme}.png`);
    const webp = join(output, `model-picker-${theme}.webp`);
    await writeFile(png, Buffer.from(shot.data, 'base64'));
    await run('cwebp', ['-quiet', '-q', '82', png, '-o', webp]);
    console.log(`assets/screenshots/model-picker-${theme}.webp (${facts.clip.width * 2}×${facts.clip.height * 2})`);
  }
});
