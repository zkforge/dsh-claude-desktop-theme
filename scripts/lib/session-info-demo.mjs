/** Real card + adapter with inert demo stores; shared by screenshots and integration coverage. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));

export async function sessionInfoDemo() {
  const bundle = await build({
    stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {createPortal} from 'react-dom';
      import {SessionCards} from './src/client/features/session-info/SessionCards.tsx';
      import {SessionInfoButton} from './src/client/features/session-info/SessionInfoButton.tsx';
      import {createSessionInfoPort} from './src/client/compat/session-info.ts';
      const listeners=new Set();
      const values={
        tokenUsage:{uncachedInputTokens:25000,cacheReadTokens:150000,cacheWriteTokens:25000,outputTokens:18000},
        sessionStats:{decodeTokens:18000,decodeMs:240000},ccdSessionInfo:{prompts:12},workingDirectory:'/demo/desktop-theme',
      };
      let list={byId:{demo:{cwd:'/demo/desktop-theme'}},projectionsBySession:{demo:{values}}};
      const context={window:200000,used:92000,systemTokens:4600,toolsTokens:44000,messageTokens:43400,
        breakdown:{tools:[['mcp__docs__search',18000],['mcp__docs__read',10000],['bash',16000]],
          files:[['/demo/desktop-theme/AGENTS.md',600]],skills:[['code-review',4800]],skillTokens:4800,fileTokens:600,compaction:null}};
      const store={getSnapshot:()=>list,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}};
      const ctx={sessions:{list:store},workspaces:{list:{getSnapshot:()=>({items:[{workspaceId:'workspace',title:'desktop-theme',path:'/demo/desktop-theme',sessionIds:['demo','other']}]}),subscribe:()=>()=>{}}}};
      window.requests=[];
      window.fetch=async(url,{signal})=>{window.requests.push(url);await new Promise(resolve=>setTimeout(resolve,30));
        if(signal.aborted)throw new Error('aborted');
        return {ok:window.environmentStatus!==404,status:window.environmentStatus??200,json:async()=>({cwd:window.environmentCwd??'/demo/desktop-theme',branch:'main',detached:false,git:'ready',worktree:window.environmentWorktree??false})};};
      const port=createSessionInfoPort(ctx,document,{read:()=>context,subscribe:()=>()=>{}});
      const root=createRoot(document.getElementById('overlay'));
      root.render(<>{createPortal(<SessionInfoButton port={port}/>,document.getElementById('header-control'))}<SessionCards port={port} contextEnabled={true}/></>);
      window.demo={port,listeners,root,changeSession(){list={byId:{other:{cwd:'/demo/other'}},projectionsBySession:{}};
        document.getElementById('chat').setAttribute('data-conversation-session','other');listeners.forEach(fn=>fn());},
        dispose(){root.unmount();port.dispose();}};
    ` }, bundle: true, write: false, format: 'iife', jsx: 'automatic',
  });
  const styles = (await Promise.all([
    'src/client/theme/tokens.css', 'src/client/features/conversation/conversation.css',
    'src/client/features/conversation/header-actions/header-actions.css', 'src/client/features/session-info/session-info.css',
  ].map(path => readFile(new URL(path, `file://${root}`), 'utf8')))).join('\n');
  return { bundle: bundle.outputFiles[0].text, styles };
}

export async function mountSessionInfoDemo(page, demo) {
  await page.evaluate(`document.documentElement.lang='zh-CN';document.documentElement.setAttribute('data-dsh-ccd-style','true');
    document.body.innerHTML='<div class="ST7X_W_root"><div class="ST7X_W_header"><div class="ST7X_W_headerUtilities"><span data-slot="conversation.session.header.utilities" id="header-control"></span><span data-slot="conversation.session.header.utilities"><button class="ccd-header-action" title="终端"></button></span></div></div><div id="chat" data-conversation-content data-content-phase="active" data-conversation-session="demo"><div data-conversation-scroll></div></div></div><div id="overlay"></div>';
    const style=document.createElement('style');style.textContent=${JSON.stringify(demo.styles)}+
      'body{margin:0;background:var(--ccd-canvas)}.ST7X_W_root{height:100vh}.ST7X_W_header{box-sizing:border-box;width:1100px;height:40px;display:flex;justify-content:flex-end;padding-right:12px}#chat{position:relative;display:flex;flex-direction:column;width:1100px;height:780px}[data-conversation-scroll]{height:100%;box-sizing:border-box}';
    document.head.append(style);`);
  await page.evaluate(demo.bundle);
  await page.evaluate('new Promise(resolve=>setTimeout(resolve,120))');
}
