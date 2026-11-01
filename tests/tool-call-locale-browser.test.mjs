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

test('tool summaries, file actions and native titles follow language changes without resetting disclosures', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 30000,
}, async () => {
  const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: `
    import {mountToolCallGroups} from './src/client/compat/tool-call-groups.ts';
    import {mountToolCallLabels} from './src/client/compat/tool-call-labels.ts';
    window.errors=[];const report=e=>errors.push(String(e));
    const groups=mountToolCallGroups(document,report),labels=mountToolCallLabels(document,report);
    window.release=()=>{labels();groups();};
  ` }, bundle: true, write: false, format: 'iife' });
  const styles = await readFile(join(root, 'src/client/features/tool-calls/tool-calls.css'), 'utf8');
  const row = (id, name, title, summary, extra = '') => `<div data-chat-flow-kind="tool-call" data-chat-turn="1">
    <div data-chat-call-id="${id}"><div data-tool="${name}" data-state="ok">
      <button data-disclosure-row aria-expanded="false"><span class="host_title">${title}</span>
        <span class="host_summary">${summary}</span>${extra}</button>
      <pre hidden>Original tool output</pre>
    </div></div></div>`;
  const html = `<main id="flow">
    <div data-chat-flow-kind="assistant-step" data-chat-group-part="reasoning" data-chat-turn="1">
      <div data-variant="think" data-state="ok"><button data-disclosure-row aria-expanded="false"><span class="host_title">思考</span></button></div>
    </div>
    ${row('write', 'write', '写入', 'Thought.ts', '<span class="host_diffAdded">+2</span><span class="host_diffRemoved">-1</span>')}
    ${row('read1', 'read', '读取文件', '路径/文件.md')}
    ${row('read2', 'read', '读取文件', 'README.md')}
    ${row('command', 'bash', '运行命令', 'printf Thought')}
    <p id="answer">Original final answer.</p>
  </main>`;
  const profile = await mkdtemp(join(tmpdir(), 'ccd-tool-locale-'));
  try {
    await withPage({ url: 'about:blank', width: 1000, height: 750, profile }, async page => {
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await page.evaluate(`
        document.documentElement.lang='zh-CN';document.documentElement.setAttribute('data-dsh-ccd-style','true');
        document.body.innerHTML=${JSON.stringify(html)};
        const sheet=document.createElement('style');sheet.textContent=${JSON.stringify(styles)};document.head.append(sheet);
        window.settle=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      `);
      await page.evaluate(bundle.outputFiles[0].text);
      await page.evaluate('settle()');
      const summary = () => page.evaluate('document.querySelector("[data-ccd-tool-roll-label]").textContent');
      assert.equal(await summary(), '已写入 Thought.ts、思考、读取 2 个文件、运行 1 条命令+2−1');
      assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-english-label]").length'), 0);
      assert.equal(await page.evaluate('document.querySelector("[data-ccd-file-action]").textContent'), '已写入');
      await page.evaluate(`window.toggle=document.querySelector('[data-ccd-tool-group-toggle]');toggle.click();settle()`);
      for (const language of ['en-US', 'zh-TW', 'en']) {
        await page.evaluate(`document.documentElement.lang=${JSON.stringify(language)};settle()`);
        const chinese = language.startsWith('zh');
        assert.equal(await summary(), chinese ? '已写入 Thought.ts、思考、读取 2 个文件、运行 1 条命令+2−1'
          : 'Wrote Thought.ts, Thought, read 2 files, ran a command+2−1');
        assert.equal(await page.evaluate('document.querySelector("[data-ccd-file-action]").textContent'), chinese ? '已写入' : 'Wrote');
        assert.equal(await page.evaluate('document.querySelector("[data-ccd-tool-group-toggle]")===toggle'), true);
        assert.equal(await page.evaluate('toggle.getAttribute("aria-expanded")'), 'true');
        assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-english-label]").length>0'), !chinese);
        assert.equal(await page.evaluate('document.querySelector("[data-tool=read] .host_title:not([data-ccd-english-label])").textContent'), '读取文件');
        assert.equal(await page.evaluate('document.querySelector("[data-tool=bash] .host_summary").textContent'), 'printf Thought');
        assert.equal(await page.evaluate('document.querySelector("#answer").textContent'), 'Original final answer.');
      }
      await page.evaluate(`document.documentElement.lang='zh-CN';
        document.querySelector('#answer').remove();
        const running=document.createElement('div');running.setAttribute('data-chat-running','');document.body.append(running);
        document.querySelector('[data-variant=think]').setAttribute('data-state','running');settle()`);
      assert.equal(await summary(), '思考中');
      await page.evaluate("document.documentElement.lang='en';settle()");
      assert.equal(await summary(), 'Thinking');
      assert.equal(await page.evaluate('document.querySelector("[data-variant=think] [data-ccd-english-label]").textContent'), 'Thinking');
      await page.evaluate('release();settle()');
      assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-tool-group-toggle], [data-ccd-english-label], [data-ccd-file-action]").length'), 0);
      assert.deepEqual(await page.evaluate('errors'), []);
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
