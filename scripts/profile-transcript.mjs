/** Profile synthetic history with real adapters; no account or conversation data.
 * node scripts/profile-transcript.mjs [label] [history turns] [chunks]
 * Open .cpuprofile or .trace.json in Chrome DevTools Performance.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { withPage } from './lib/headless-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const label = process.argv[2] ?? 'current';
if (!/^[a-zA-Z0-9_-]+$/u.test(label)) throw new Error('Use a filename-safe label');
const turns = Number(process.argv[3] ?? 250);
const chunks = Number(process.argv[4] ?? 120);
if (![turns, chunks].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('Positive integer counts required');
const output = join(root, 'artifacts/performance');
await mkdir(output, { recursive: true });
const bundle = await build({ stdin: { resolveDir: root, loader: 'ts', contents: [
  "import {mountToolCallGroups} from './src/client/compat/tool-call-groups.ts';",
  "import {mountToolCallLabels} from './src/client/compat/tool-call-labels.ts';",
  "import {mountToolCallDetails} from './src/client/compat/tool-call-details.ts';",
  "import {mountReplySignature} from './src/client/compat/reply-signature.ts';",
  'window.errors=[];const report=e=>window.errors.push(String(e));',
  'window.releases=[mountToolCallGroups,mountToolCallLabels,mountToolCallDetails,mountReplySignature].map(mount=>mount(document,report));',
].join('\n') }, bundle: true, write: false, format: 'iife', sourcemap: 'inline' });

function setup(turns) {
  document.body.innerHTML = '<main id="transcript"></main><aside id="elsewhere"></aside>';
  const list = document.querySelector('#transcript');
  const call = (turn, state = 'ok') => '<section data-chat-flow-kind="tool-call" data-chat-turn="' + turn
    + '"><div data-chat-call-id="' + turn + '"><div data-tool="bash" data-terminal data-state="' + state
    + '"><header data-disclosure-row><span class="host_title">运行命令</span><span data-command-text>git status --short</span>'
    + '<button>Copy</button></header><pre>demo output</pre></div></div></section>';
  list.innerHTML = Array.from({ length: turns }, (_, i) => call(i) + call(i)
    + '<article data-chat-flow-kind="assistant-step" data-chat-turn="' + i + '"><p>Finished demo reply ' + i + '</p></article>').join('')
    + call('live', 'running') + '<article data-chat-flow-kind="assistant-step"><p id="reply"></p></article><div data-chat-running></div>';
  window.tick = () => new Promise(resolve => setTimeout(resolve, 0));
  window.counts = { queries: 0, writes: 0 };
  for (const proto of [Element.prototype, Document.prototype]) for (const name of ['querySelector', 'querySelectorAll']) {
    const native = proto[name];
    proto[name] = function (...args) { window.counts.queries++; return native.apply(this, args); };
  }
  const nativeSet = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (...args) { window.counts.writes++; return nativeSet.apply(this, args); };
  window.longTasks = [];
  window.longObserver = new PerformanceObserver(list => window.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration }))));
  window.longObserver.observe({ entryTypes: ['longtask'] });
}

async function sample(scenario, chunks) {
  window.counts = { queries: 0, writes: 0 };
  window.longTasks.length = 0;
  performance.mark(scenario + '-start');
  const selector = scenario === 'reply' ? '#reply' : scenario === 'output' ? '[data-chat-turn="live"] pre' : '#elsewhere';
  const target = document.querySelector(selector);
  if (!target.firstChild) target.append(document.createTextNode(''));
  const started = performance.now();
  for (let i = 0; i < chunks; i++) { target.firstChild.appendData(' chunk'); await window.tick(); }
  await window.tick();
  performance.mark(scenario + '-end');
  performance.measure(scenario, scenario + '-start', scenario + '-end');
  return { elapsedMs: performance.now() - started, ...window.counts, longTasks: [...window.longTasks] };
}

const profile = await mkdtemp(join(tmpdir(), 'ccd-profile-'));
try {
  await withPage({ url: 'about:blank', width: 1392, height: 932, profile }, async page => {
    await page.evaluate('(' + setup.toString() + ')(' + turns + ')');
    await page.evaluate(bundle.outputFiles[0].text + '\n//# sourceURL=ccd-transcript-profile.js');
    await page.evaluate('tick()');
    assert.deepEqual(await page.evaluate('window.errors'), []);
    await page.send('Performance.enable');
    await page.send('Profiler.enable');
    await page.send('Profiler.start');
    const events = [];
    page.events.set('Tracing.dataCollected', [data => events.push(...data.value)]);
    await page.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing', transferMode: 'ReportEvents' });
    const scenarios = [];
    for (const scenario of ['reply', 'output', 'unrelated']) {
      const before = await page.send('Performance.getMetrics');
      const measured = await page.evaluate('(' + sample.toString() + ')(' + JSON.stringify(scenario) + ',' + chunks + ')');
      const after = await page.send('Performance.getMetrics');
      const metrics = Object.fromEntries(after.metrics.map(item => [item.name, item.value
        - (before.metrics.find(old => old.name === item.name)?.value ?? 0)]));
      scenarios.push({ scenario, ...measured, taskMs: metrics.TaskDuration * 1000,
        scriptMs: metrics.ScriptDuration * 1000, layoutMs: metrics.LayoutDuration * 1000,
        styleMs: metrics.RecalcStyleDuration * 1000 });
    }
    const cpu = await page.send('Profiler.stop');
    const complete = page.once('Tracing.tracingComplete');
    await page.send('Tracing.end');
    await complete;
    assert.deepEqual(await page.evaluate('window.errors'), []);
    assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-tool-group-toggle]").length'), turns + 1);
    await page.evaluate('window.releases.reverse().forEach(release=>release());window.longObserver.disconnect();');
    assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-tool-group-toggle], [data-ccd-command-highlight], [data-ccd-english-label]").length'), 0);
    const result = { label, turns, chunks, browser: await page.send('Browser.getVersion'), scenarios };
    await writeFile(join(output, label + '.cpuprofile'), JSON.stringify(cpu.profile));
    await writeFile(join(output, label + '.trace.json'), JSON.stringify({ traceEvents: events }));
    await writeFile(join(output, label + '.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  });
} finally {
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
