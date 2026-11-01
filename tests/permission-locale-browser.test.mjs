import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let chrome;
try { chrome = findChrome(); } catch { /* Optional locally, installed in CI. */ }

test('permission and Agent menus follow live native locale updates and retain native actions and descriptions', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 30000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import {mountAgentPresetMenu,mountPermissionMenu} from './src/client/compat/permission-menu.ts';
    window.errors=[];window.planChanges=[];window.nativeSelections=[];
    let active=false;const listeners=new Set();
    const permission=mountPermissionMenu(document,e=>errors.push(String(e)),{
      read:()=>({active}),subscribe:l=>{listeners.add(l);return()=>listeners.delete(l);},
      set:async(id,value)=>{planChanges.push([id,value]);active=value;listeners.forEach(l=>l());}
    });
    const agent=mountAgentPresetMenu(document,e=>errors.push(String(e)));
    window.release=()=>{agent();permission();};
  ` }, bundle: true, write: false, format: 'iife' });
  const styles = (await Promise.all(['src/client/theme/tokens.css', 'src/client/theme/menus.css']
    .map(path => readFile(join(root, path), 'utf8')))).join('\n');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-permission-locale-'));
  try {
    await withPage({ url: 'about:blank', width: 1000, height: 900, profile }, async page => {
      await page.evaluate(`
        document.documentElement.lang='en-US';document.documentElement.setAttribute('data-dsh-ccd-style','true');
        const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);
        window.names={
          en:['Read Only','Workspace Write','Full access','Auto review'],
          zh:['仅可查看','工作区内修改','完全权限','自动审查']};
        window.agentNames={en:['Standard mode','PTC mode','Minimal mode','Creator mode'],zh:['标准模式','PTC 模式','极简模式','创造模式']};
        window.nativeDescriptions={
          en:['Work with code, files, and information. Suitable for most tasks, with search, editing, terminal commands, and other tools available as needed.',
            'Includes all Standard mode capabilities. Better suited to tasks that call tools in batches and then filter, organize, deduplicate, count, or summarize the results.',
            'The agent uses a terminal and image reading, with context compaction. Useful for testing and comparing its basic performance.',
            'Customize DSH through conversation. Let the agent write plugins that add features or UI, or combine tools and prompts to create your own mode.'],
          zh:['处理代码、文件和资料，适合大多数任务。Agent 会按需使用检索、编辑和终端等工具。',
            '包含标准模式的所有能力，更适合批量调用工具，并对结果进行筛选、整理、去重、统计或汇总的任务。',
            'Agent 使用终端和图片读取工具，并支持上下文压缩，适合测试和对比其基础表现。',
            '用对话定制 DSH：让 Agent 编写插件，添加新功能或界面；也能组合工具和提示词，创建自己的模式。']};
        const permissionRows=names.en.map((name,i)=>'<button role="menuitem" data-native-permission="'+i+'"><span class="_itemLabel_4ub78_190">'+
          (i===3?'<span class="wXeviG_optionLabel"><span class="wXeviG_optionLabelText">'+name+'</span><span class="wXeviG_badge">EXP</span></span>':name)+
          '</span></button>').join('');
        const agentRows=agentNames.en.map((name,i)=>'<button role="menuitem" data-native-agent="'+i+'"><span class="_itemLabel_4ub78_190"><span style="display:flex;flex-direction:column"><span>'+name+'</span><span class="native-description">'+nativeDescriptions.en[i]+'</span></span></span></button>').join('');
        document.body.innerHTML='<section data-conversation-session="session-a"><button class="wXeviG_trigger"><span class="wXeviG_triggerLabel">Full access</span></button></section>'+
          '<div id="permission" role="menu" data-menu-material><div class="_viewport_4ub78_19">'+permissionRows+'</div></div>'+
          '<div id="agent" role="menu" data-menu-material><div class="_viewport_4ub78_19">'+agentRows+'</div></div>';
        window.originalPermissions=[...document.querySelectorAll('[data-native-permission]')];
        window.originalDescriptions=[...document.querySelectorAll('.native-description')];
        window.originalAgentLabels=[...document.querySelectorAll('[data-native-agent] ._itemLabel_4ub78_190')];
        for(const row of originalPermissions)row.onclick=()=>nativeSelections.push(row.getAttribute('data-native-permission'));
        window.settle=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        window.nativeLanguage=async language=>{
          document.documentElement.lang=language;
          await settle(); // Locale invalidates the adapter before React rewrites its existing Text nodes.
          const key=language.startsWith('zh')?'zh':'en';
          originalPermissions.forEach((row,i)=>{
            const label=row.querySelector('.wXeviG_optionLabelText')??row.querySelector('._itemLabel_4ub78_190');
            label.firstChild.data=names[key][i];
            const badge=row.querySelector('.wXeviG_badge');if(badge)badge.firstChild.data='EXP';
          });
          document.querySelector('.wXeviG_triggerLabel').firstChild.data=names[key][2];
          originalAgentLabels.forEach((label,i)=>{
            label.querySelector(':scope > span > :first-child').firstChild.data=agentNames[key][i];
            originalDescriptions[i].firstChild.data=nativeDescriptions[key][i];
          });
          await settle();
        };
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      await page.evaluate('settle()');
      for (const language of ['en-US', 'zh-CN', 'en', 'zh-CN']) {
        await page.evaluate(`nativeLanguage(${JSON.stringify(language)})`);
        const chinese = language.startsWith('zh');
        const state = await page.evaluate(`(() => {
          const rows=[...document.querySelectorAll('#permission [data-ccd-permission-mode]')];
          const key=document.documentElement.lang.startsWith('zh')?'zh':'en';
          return {order:rows.map(e=>e.getAttribute('data-ccd-permission-mode')),
            labels:rows.map(e=>e.querySelector('._itemLabel_4ub78_190').textContent.replace(/实验|EXP/g,'').trim()),
            shortcuts:rows.map(e=>e.querySelector('[data-ccd-permission-shortcut]').textContent),
            trigger:document.querySelector('.wXeviG_triggerLabel').textContent,
            permissionHeadings:document.querySelectorAll('[data-ccd-permission-heading]').length,
            agentRows:document.querySelectorAll('[data-ccd-agent-mode]').length,
            agentHeadings:document.querySelectorAll('[data-ccd-agent-heading]').length,
            agentDescriptions:originalDescriptions.map(e=>e.textContent),expectedDescriptions:nativeDescriptions[key],
            agentTitles:originalAgentLabels.map(e=>e.querySelector(':scope > span > :first-child').textContent),expectedTitles:agentNames[key],
            nativeNodesKept:originalDescriptions.every((e,i)=>e.isConnected&&e.parentElement.parentElement===originalAgentLabels[i]),
            visible:originalDescriptions.every(e=>getComputedStyle(e).display!=='none'&&e.getClientRects().length>0),
            ownDescriptions:document.querySelectorAll('[data-ccd-agent-desc]').length};
        })()`);
        assert.deepEqual(state.order, ['auto', 'read-only', 'workspace-write', 'plan', 'danger-full-access']);
        assert.deepEqual(state.labels, chinese ? ['自动', '手动', '接受编辑', '计划', '跳过权限确认']
          : ['Auto', 'Manual', 'Accept edits', 'Plan', 'Bypass permissions']);
        assert.deepEqual(state.shortcuts, ['1', '2', '3', '4', '5']);
        assert.equal(state.trigger, chinese ? '跳过权限确认' : 'Bypass permissions');
        assert.equal(state.permissionHeadings, 1); assert.equal(state.agentHeadings, 1); assert.equal(state.agentRows, 4);
        assert.deepEqual(state.agentDescriptions, state.expectedDescriptions); assert.deepEqual(state.agentTitles, state.expectedTitles);
        assert.equal(state.nativeNodesKept, true); assert.equal(state.visible, true); assert.equal(state.ownDescriptions, 0);
      }
      await page.evaluate("document.querySelector('[data-ccd-permission-mode=plan]').click();settle()");
      await page.evaluate("document.querySelector('[data-ccd-permission-mode=workspace-write]').click();settle()");
      assert.deepEqual(await page.evaluate('planChanges'), [['session-a', true], ['session-a', false]]);
      assert.deepEqual(await page.evaluate('nativeSelections'), ['1']);
      await page.evaluate('release();settle()');
      assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-permission-mode],[data-ccd-agent-mode],[data-ccd-permission-heading],[data-ccd-agent-heading]").length'), 0);
      assert.equal(await page.evaluate('document.querySelector(".wXeviG_triggerLabel").textContent'), '完全权限');
      assert.equal(await page.evaluate('[...document.querySelectorAll("#permission [data-native-permission]")].every((e,i)=>e===originalPermissions[i])'), true);
      assert.deepEqual(await page.evaluate('errors'), []);
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
