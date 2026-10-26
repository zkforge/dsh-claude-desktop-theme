import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';

let chrome;
try { chrome = findChrome(); } catch { /* Optional local Chrome. */ }
const root = fileURLToPath(new URL('../', import.meta.url));

test('native mutation delivery keeps transcript caches fresh without repainting historical markers', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 60000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: [
    "import {mountToolCallGroups} from './src/client/compat/tool-call-groups.ts';",
    "import {mountToolCallDetails} from './src/client/compat/tool-call-details.ts';",
    "import {mountToolCallLabels} from './src/client/compat/tool-call-labels.ts';",
    'window.errors=[];window.release=[mountToolCallGroups,mountToolCallDetails,mountToolCallLabels].map(mount=>mount(document,e=>window.errors.push(String(e))));',
  ].join('\n') }, bundle: true, write: false, format: 'iife' });
  const profile = await mkdtemp(join(tmpdir(), 'ccd-transcript-'));
  try {
    await withPage({ url: 'about:blank', width: 800, height: 500, profile }, async page => {
      // Count streaming work independently of an outgoing label's delayed
      // animation removal, even when other browser workers delay this test.
      await page.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
      await page.evaluate(`
        const call=(id,state='ok')=>'<section id="'+id+'" data-chat-flow-kind="tool-call" data-chat-turn="'+id+'">'
          +'<div data-chat-call-id="'+id+'"><div data-tool="bash" data-terminal data-state="'+state+'"><header data-disclosure-row>'
          +'<span class="host_title">运行命令</span><span data-command-text>git status</span><button>Copy</button></header><pre>output</pre></div></div></section>';
        document.body.innerHTML='<main>'+call('history')+'<article data-chat-flow-kind="assistant-step">Answer</article>'
          +call('live','running')+'<div data-chat-running></div></main><aside>Sidebar</aside>';
        window.tick=()=>new Promise(r=>setTimeout(r,0));
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      await page.evaluate('tick()');
      await page.evaluate(`
        window.historyFlow=document.querySelector('#history');
        window.nativeCommand=historyFlow.querySelector('[data-command-text]');
        window.liveFlow=document.querySelector('#live');
        window.historyQueries=0;window.historyWrites=0;
        const query=historyFlow.querySelectorAll.bind(historyFlow);
        historyFlow.querySelectorAll=(...args)=>{historyQueries++;return query(...args);};
        const set=historyFlow.setAttribute.bind(historyFlow);
        historyFlow.setAttribute=(...args)=>{historyWrites++;return set(...args);};
        window.historyView=nativeCommand.nextElementSibling;
        window.historyCopy=historyFlow.querySelector('[data-ccd-command-copy]');
        window.historyLabel=historyFlow.querySelector('[data-ccd-english-label]');
        window.historyOwnershipReads=0;
        for(const source of [nativeCommand,historyFlow.querySelector('[data-ccd-english-source]')]){
          const closest=source.closest.bind(source);
          source.closest=(...args)=>{historyOwnershipReads++;return closest(...args);};
        }
        window.output=liveFlow.querySelector('pre').firstChild;
      `);
      await page.evaluate(`(async()=>{for(let i=0;i<20;i++){output.appendData(' chunk');await tick();}})()`);
      assert.deepEqual(await page.evaluate('[historyQueries,historyWrites]'), [0, 0]);
      assert.equal(await page.evaluate('historyOwnershipReads'), 0, 'streaming does not sweep historical title or command ownership');
      assert.equal(await page.evaluate('nativeCommand.nextElementSibling===historyView'), true);
      assert.equal(await page.evaluate('historyFlow.querySelector("[data-ccd-command-copy]")===historyCopy'), true);
      await page.evaluate(`
        nativeCommand.firstChild.data='pwd';
        historyFlow.querySelector('[data-ccd-english-source]').firstChild.data='读取文件';
        historyFlow.querySelector('[data-tool]').setAttribute('data-tool','read');
        tick();
      `);
      assert.equal(await page.evaluate('historyView.textContent'), 'pwd');
      assert.equal(await page.evaluate('historyLabel.textContent'), 'Read file');
      assert.equal(await page.evaluate('historyFlow.previousElementSibling.querySelector("[data-ccd-tool-roll-label]").textContent'), 'Read 1 file');
      // A nested flow's state also invalidates its outer call's cached status.
      await page.evaluate(`
        liveFlow.querySelector('[data-tool]').setAttribute('data-state','ok');
        liveFlow.querySelector('[data-chat-call-id]').insertAdjacentHTML('beforeend',
          '<div data-chat-flow-kind="tool-call"><div data-chat-call-id="nested"><div data-tool="bash" data-state="running">Nested</div></div></div>');
        tick();
      `);
      assert.equal(await page.evaluate('liveFlow.hasAttribute("data-ccd-tool-group-member")'), false);
      await page.evaluate(`liveFlow.querySelector('[data-chat-call-id="nested"] [data-tool]').setAttribute('data-state','ok');tick()`);
      assert.equal(await page.evaluate('liveFlow.getAttribute("data-ccd-tool-group-member")'), 'closed');
      // Replacing a header releases its old copy control and attaches a new one.
      await page.evaluate(`
        historyFlow.querySelector('header').outerHTML='<header data-disclosure-row><span class="host_title">运行命令</span><span data-command-text>echo replaced</span><button>Copy</button></header>';
        tick();
      `);
      assert.equal(await page.evaluate('historyCopy.isConnected'), false);
      assert.equal(await page.evaluate('historyFlow.querySelectorAll("[data-ccd-command-copy]").length'), 1);
      assert.equal(await page.evaluate('historyFlow.querySelector("[data-ccd-command-highlight]").textContent'), 'echo replaced');
      assert.equal(await page.evaluate('nativeCommand.hasAttribute("data-ccd-command-source")'), false);
      // Attribute-only scope loss must release owned views too.
      await page.evaluate('window.replacedLabel=historyFlow.querySelector("[data-ccd-english-label]")');
      await page.evaluate('historyFlow.removeAttribute("data-chat-flow-kind");tick()');
      assert.equal(await page.evaluate('historyFlow.querySelectorAll("[data-ccd-command-highlight], [data-ccd-command-copy]").length'), 0);
      assert.equal(await page.evaluate('replacedLabel.isConnected'), false);
      await page.evaluate('historyFlow.remove();tick()');
      await page.evaluate('window.release.reverse().forEach(release=>release());tick()');
      assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-tool-group-toggle], [data-ccd-command-highlight], [data-ccd-english-label]").length'), 0);
      assert.deepEqual(await page.evaluate('window.errors'), []);
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
