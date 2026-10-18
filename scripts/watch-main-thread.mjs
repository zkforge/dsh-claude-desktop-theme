/*
 * Attach to the running DSH desktop app and record what the page reports while
 * the reader reproduces a freeze: console output, uncaught errors and long
 * tasks. Never pauses the page -- a paused main thread looks exactly like the
 * freeze this is meant to diagnose.
 *
 * Usage:
 *   node scripts/watch-main-thread.mjs [seconds]
 *
 * Requires the app launched with --remote-debugging-port=9222.
 */
import { Devtools } from './lib/headless-chrome.mjs';

const PORT = Number(process.env.DSH_DEBUG_PORT ?? 9222);
const SECONDS = Number(process.argv[2] ?? 90);

const devtools = await Devtools.open(PORT);
await devtools.ready;
await devtools.send('Runtime.enable');
await devtools.send('Log.enable');
await devtools.send('Performance.enable').catch(() => {});

const started = Date.now();
const stamp = () => ((Date.now() - started) / 1000).toFixed(1).padStart(6);

devtools.events.set('Runtime.consoleAPICalled', [params => {
  const text = params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' ');
  console.log(`${stamp()}s console.${params.type}: ${text.slice(0, 400)}`);
}]);
devtools.events.set('Runtime.exceptionThrown', [params => {
  const detail = params.exceptionDetails;
  console.log(`${stamp()}s EXCEPTION: ${detail.text} ${(detail.exception?.description ?? '').slice(0, 1200)}`);
}]);
devtools.events.set('Log.entryAdded', [params => {
  console.log(`${stamp()}s log.${params.entry.level}: ${params.entry.text.slice(0, 600)}`);
}]);
devtools.events.set('Inspector.targetCrashed', [() => console.log(`${stamp()}s TARGET CRASHED`)]);

await devtools.evaluate(`
  window.__ccdLongTasks = window.__ccdLongTasks ?? [];
  window.__ccdLongTasks.length = 0;
  if (!window.__ccdLongObserver) {
    window.__ccdLongObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) window.__ccdLongTasks.push({ start: Math.round(entry.startTime), duration: Math.round(entry.duration) });
    });
    window.__ccdLongObserver.observe({ entryTypes: ['longtask'] });
  }
  'observing'
`);

console.log(`${stamp()}s attached; reproduce the freeze now (${SECONDS}s)`);

const deadline = Date.now() + SECONDS * 1000;
while (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1000));

try {
  const tasks = await devtools.evaluate('JSON.stringify(window.__ccdLongTasks)');
  console.log(`${stamp()}s long tasks: ${tasks}`);
  const metrics = await devtools.send('Performance.getMetrics');
  const wanted = new Set(['JSHeapUsedSize', 'Nodes', 'Documents', 'LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration']);
  console.log(`${stamp()}s metrics: ${metrics.metrics.filter(m => wanted.has(m.name))
    .map(m => `${m.name}=${Math.round(m.value * 100) / 100}`).join(' ')}`);
} catch (error) {
  console.log(`summary failed: ${error.message}`);
}
devtools.close();
