import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameStatsDisplay, sameStatsSnapshot, sameStatsUsage, type StatsSessionUsage } from '../src/shared/stats.ts';
import { aggregateUsage } from '../src/host/stats/aggregate.ts';

const usage: StatsSessionUsage = { prompts: 1, tokens: 10, days: [['2026-10-26', 1]], hours: [[12, 1]],
  models: [['demo/model', 10, 7, 3]], modelDays: [['2026-10-26', 0, 10]] };
const snapshot = () => aggregateUsage([usage], { now: new Date(2026, 9, 26).getTime(), pending: 0, missed: 0 });

test('display equality ignores transport metadata while snapshot equality retains fold progress', () => {
  const a = snapshot(), b = structuredClone(a);
  assert.equal(sameStatsSnapshot(a, { ...b, computedAt: a.computedAt + 1000 }), true);
  assert.equal(sameStatsDisplay(a, { ...b, pending: 3, missed: 1 }), true);
  assert.equal(sameStatsSnapshot(a, { ...b, pending: 3 }), false);
  assert.equal(sameStatsSnapshot(a, { ...b, missed: 1 }), false);
});

test('range, heatmap, chart, model IO and busiest-hour changes invalidate the display', () => {
  const a = snapshot();
  for (const b of [
    { ...a, version: a.version + 1 }, { ...a, busyHour: 13 }, { ...a, days: [] }, { ...a, modelDays: [] },
    { ...a, modelIO: [] }, { ...a, ranges: { ...a.ranges, '7d': { ...a.ranges['7d'], tokens: 0 } } },
    { ...a, ranges: { ...a.ranges, all: { ...a.ranges.all, models: [] } } },
  ]) assert.equal(sameStatsDisplay(a, b), false);
});

test('effective session equality covers prompt counts, token IO and every sparse table', () => {
  assert.equal(sameStatsUsage(usage, structuredClone(usage)), true);
  assert.equal(sameStatsUsage(undefined, usage), false);
  for (const changed of [
    { ...usage, prompts: 2 }, { ...usage, tokens: 11 }, { ...usage, days: [] }, { ...usage, hours: [] },
    { ...usage, models: [] }, { ...usage, modelDays: [] },
  ]) assert.equal(sameStatsUsage(usage, changed), false);
});
