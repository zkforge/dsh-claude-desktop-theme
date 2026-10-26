/** Summarize opt-in component profiles without conflating test time with latency. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'artifacts/performance/components-final');
const rows = [];
for (const file of await readdir(directory)) {
  if (!file.endsWith('.json') || file.endsWith('.trace.json') || file === 'summary.json') continue;
  const row = JSON.parse(await readFile(join(directory, file), 'utf8'));
  if (typeof row.label === 'string' && Array.isArray(row.evaluations)) rows.push(row);
}
rows.sort((a, b) => a.label.localeCompare(b.label));
const events = rows.flatMap(row => row.events);
const tasks = rows.flatMap(row => row.tasks.map(task => ({ page: row.label, ...task })));
const suites = new Map();
for (const row of rows) {
  const name = row.label.replace(/-\d+$/u, '');
  const suite = suites.get(name) ?? { name, pages: 0, failures: 0, tasks: 0, events: 0, maxEventMs: null };
  suite.pages++;
  suite.failures += row.failure ? 1 : 0;
  suite.tasks += row.tasks.length;
  suite.events += row.events.length;
  if (row.events.length) suite.maxEventMs = Math.max(suite.maxEventMs ?? 0, ...row.events.map(event => event.duration));
  suites.set(name, suite);
}
const result = { pages: rows.length, failedPages: rows.filter(row => row.failure).map(row => row.label),
  suites: [...suites.values()], tasks, eventSamples: events.length,
  maxRecordedEventMs: events.length ? Math.max(...events.map(event => event.duration)) : null,
  measures: rows.flatMap(row => row.measures.map(measure => ({ page: row.label, ...measure }))) };
await writeFile(join(directory, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
const lines = ['# Component fixture profiles', '',
  'Named measures wait for the asserted ready state and two animation-frame callbacks; they are rendering-opportunity proxies, not INP.',
  'Event Timing only lists browser-reported entries meeting the 16ms recording threshold. An empty set is unavailable, not zero latency.',
  'Fixtures use demo ports. Host startup, network, real account data, and long-term memory growth are outside this run.', '',
  '| Suite | Pages | Failed pages | Long tasks | Event samples | Max recorded event (ms) |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...result.suites.map(suite => '| ' + [suite.name, suite.pages, suite.failures, suite.tasks, suite.events, suite.maxEventMs ?? '—'].join(' | ') + ' |'),
  '', '| Named ready + render measure | ms | Profile page |', '| --- | ---: | --- |',
  ...result.measures.map(measure => '| ' + [measure.name, measure.duration.toFixed(1), measure.page].join(' | ') + ' |'),
];
await writeFile(join(directory, 'summary.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ pages: result.pages, failedPages: result.failedPages, longTasks: tasks,
  eventSamples: events.length, maxRecordedEventMs: result.maxRecordedEventMs }, null, 2));
