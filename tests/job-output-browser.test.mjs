import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChrome, withPage } from '../scripts/lib/headless-chrome.mjs';
let chrome;
try { chrome = findChrome(); } catch { /* CI provides Chrome. */ }

test('job output removes historical activity cues while preserving final outcomes and native controls', {
  skip: chrome ? false : 'Chrome unavailable', timeout: 30000,
}, async () => {
  const styles = await readFile('src/client/features/tool-calls/tool-calls.css', 'utf8');
  const profile = await mkdtemp(join(tmpdir(), 'ccd-job-output-'));
  try {
    await withPage({ url: 'about:blank', width: 800, height: 600, profile }, async page => {
      await page.evaluate(`
        document.documentElement.setAttribute('data-dsh-ccd-style', 'true');
        document.documentElement.style.cssText='--ccd-border: #ddd; --ccd-card: #fff; --ccd-font-code: monospace';
        const card=(id,tool,tone,label)=>'<section data-chat-flow-kind="tool-call"><div id="'+id+'" data-tool="'+tool+'" data-state="ok">'+
          '<div data-disclosure-row aria-expanded="true"><span class="host_title">Read job output</span><span class="host_summary">bash-123 · '+label+'</span></div>'+
          '<div class="details_root"><ul class="details_list"><li><div class="details_heading"><span>bash-123</span><span data-tone="'+tone+'">'+label+'</span></div>'+
          '<p class="details_description">exit code: 1 · output truncated</p><div data-code-wrap><div><div data-code-block-banner><span>Code block</span><div><button>Copy</button><button>Wrap</button></div></div></div>'+
          '<pre>retained output\\nsecond line</pre></div></li></ul></div></div></section>';
        document.body.innerHTML=card('running','job_output','info','运行中')+card('done','job_output','success','Completed')+card('failed','job_output','danger','Failed')+card('other','job_list','info','Running');
        const style=document.createElement('style');style.textContent=${JSON.stringify(styles)};document.head.append(style);
      `);
      const result = await page.evaluate(`(() => {
        const display=selector=>getComputedStyle(document.querySelector(selector)).display;
        const pre=getComputedStyle(document.querySelector('#running pre'));
        return {
          snapshot:display('#running .details_heading'),
          success:display('#done [data-tone]'), error:display('#failed [data-tone]'),
          other:display('#other .details_heading'),
          copy:display('#running button'), toolbar:display('#running [data-code-block-banner] > span'),
          output:document.querySelector('#running pre').textContent,
          description:display('#failed .details_description'),
          fontSize:pre.fontSize,lineHeight:pre.lineHeight,
          state:document.getElementById('running').getAttribute('data-state'),
        };
      })()`);
      assert.equal(result.snapshot, 'none');
      for (const key of ['success','error','other','copy','description']) assert.notEqual(result[key], 'none', key);
      assert.equal(result.toolbar, 'none');
      assert.equal(result.output, 'retained output\nsecond line');
      assert.equal(result.fontSize, '13px');
      assert.equal(result.lineHeight, '18px');
      assert.equal(result.state, 'ok');
      await page.evaluate(`document.querySelector('#running [data-disclosure-row]').setAttribute('aria-expanded','false')`);
      assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('#running .host_summary')).display`), 'none');
      await page.evaluate(`document.documentElement.removeAttribute('data-dsh-ccd-style')`);
      assert.notEqual(await page.evaluate(`getComputedStyle(document.querySelector('#running .details_heading')).display`), 'none');
    });
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
});
