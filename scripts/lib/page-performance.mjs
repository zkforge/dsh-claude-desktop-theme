/** Opt-in CDP diagnostics for real component/browser fixtures. */
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

let serial = 0;
function install() {
  const state = window.__ccdPerf = { tasks: [], events: [], measures: [] };
  const observers = [];
  for (const type of ['longtask', 'event']) {
    if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (type === 'longtask') state.tasks.push({ start: entry.startTime, duration: entry.duration });
        else state.events.push({ name: entry.name, duration: entry.duration,
          inputDelay: entry.processingStart - entry.startTime,
          handler: entry.processingEnd - entry.processingStart, interactionId: entry.interactionId });
      }
    });
    observer.observe(type === 'event' ? { type, durationThreshold: 16 } : { type });
    observers.push(observer);
  }
  state.measure = async (name, action, ready = () => true) => {
    const start = performance.now();
    performance.mark(name + ':start');
    await action();
    await new Promise((resolve, reject) => {
      const check = () => {
        if (performance.now() - start > 5000) { reject(new Error(name + ': readiness timed out')); return; }
        if (!ready()) { requestAnimationFrame(check); return; }
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      };
      check();
    });
    const duration = performance.now() - start;
    state.measures.push({ name, duration });
    performance.mark(name + ':end');
    performance.measure(name, name + ':start', name + ':end');
    return duration;
  };
  state.finish = () => { observers.forEach(observer => observer.disconnect()); };
}

export async function recordPage(page, viewport) {
  const directory = resolve(process.env.CCD_PERF_DIR);
  await mkdir(directory, { recursive: true });
  const label = basename(process.argv[1] ?? 'page').replace(/[^\w.-]/gu, '_') + '-' + (++serial);
  const evaluate = page.evaluate.bind(page);
  await evaluate('(' + install.toString() + ')()');
  await page.send('Performance.enable');
  await page.send('Profiler.enable');
  await page.send('Profiler.start');
  const trace = [];
  const tracing = process.env.CCD_PERF_TRACE === '1';
  if (tracing) {
    page.events.set('Tracing.dataCollected', [data => trace.push(...data.value)]);
    await page.send('Tracing.start', { categories: 'devtools.timeline,blink.user_timing', transferMode: 'ReportEvents' });
  }
  const initial = await page.send('Performance.getMetrics');
  const evaluations = [];
  page.evaluate = async expression => {
    const before = await page.send('Performance.getMetrics');
    try { return await evaluate(expression); }
    finally {
      const after = await page.send('Performance.getMetrics');
      const delta = name => 1000 * (after.metrics.find(item => item.name === name).value
        - before.metrics.find(item => item.name === name).value);
      evaluations.push({ index: evaluations.length + 1, characters: expression.length,
        expression: expression.length > 5000 ? '[bundle or large fixture setup]' : expression.slice(0, 180),
        scriptMs: delta('ScriptDuration'), taskMs: delta('TaskDuration'),
        layoutMs: delta('LayoutDuration'), styleMs: delta('RecalcStyleDuration') });
    }
  };
  return {
    async finish(failure) {
      page.evaluate = evaluate;
      // Let observer entries from the last action be delivered before reading.
      await evaluate('new Promise(resolve=>setTimeout(resolve,50))');
      const measured = await evaluate('({tasks:__ccdPerf.tasks,events:__ccdPerf.events,measures:__ccdPerf.measures})');
      await evaluate('__ccdPerf.finish()');
      const final = await page.send('Performance.getMetrics');
      const delta = name => 1000 * (final.metrics.find(item => item.name === name).value
        - initial.metrics.find(item => item.name === name).value);
      const cpu = await page.send('Profiler.stop');
      if (tracing) {
        const complete = page.once('Tracing.tracingComplete');
        await page.send('Tracing.end');
        await complete;
        await writeFile(join(directory, label + '.trace.json'), JSON.stringify({ traceEvents: trace }));
      }
      const result = { label, viewport, failure: failure ?? null, browser: await page.send('Browser.getVersion'),
        scriptMs: delta('ScriptDuration'), taskMs: delta('TaskDuration'), layoutMs: delta('LayoutDuration'),
        styleMs: delta('RecalcStyleDuration'), ...measured, evaluations };
      await writeFile(join(directory, label + '.cpuprofile'), JSON.stringify(cpu.profile));
      await writeFile(join(directory, label + '.json'), JSON.stringify(result, null, 2) + '\n');
    },
  };
}
