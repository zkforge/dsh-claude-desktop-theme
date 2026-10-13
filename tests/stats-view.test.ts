import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  STATS_VERSION, readStatsSnapshot, type StatsRangeTotals, type StatsSnapshot,
} from '../src/shared/stats.ts';
import { bookNote } from '../src/client/features/statistics/books.ts';
import { heatTip } from '../src/client/features/statistics/card.ts';
import {
  HEAT_DAYS, buildCardData, buildModels, formatCount, formatDayLabel, formatHour, formatTokens,
  heatWindow, modelColor, tokenTicks,
} from '../src/client/features/statistics/view.ts';

/** One instant, so the window assertions hold in any time zone. */
const NOW = new Date(2026, 8, 30, 12, 0, 0);

function totals(overrides: Partial<StatsRangeTotals> = {}): StatsRangeTotals {
  return {
    sessions: 10,
    messages: 1556,
    tokens: 493_100_000,
    activeDays: 3,
    topModel: 'opencode-go/deepseek-v4.1-flash',
    models: [['opencode-go/deepseek-v4.1-flash', 493_100_000]],
    ...overrides,
  };
}

function snapshot(overrides: Partial<StatsSnapshot> = {}): StatsSnapshot {
  return {
    version: STATS_VERSION,
    ranges: { all: totals(), '30d': totals(), '7d': totals() },
    busyHour: 11,
    days: [],
    modelDays: [],
    modelIO: [],
    pending: 0,
    missed: 0,
    computedAt: 1,
    ...overrides,
  };
}

/** Local day key, the way the host writes them. */
function key(day: number, month = 8, year = 2026): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

test('the window is 26 weeks ending on this week, Sunday first', () => {
  const window = heatWindow([], NOW);
  assert.equal(window.heat.length, HEAT_DAYS);
  assert.equal(window.heat.length, 182);
  const todayIndex = 25 * 7 + NOW.getDay();
  assert.equal(window.futureFrom, todayIndex + 1);
  assert.equal(window.heat[todayIndex]?.level, 0);
  for (let index = window.futureFrom; index < HEAT_DAYS; index += 1) {
    assert.equal(window.heat[index]?.level, null);
  }
});

test('day counts land on their own weekday row and scale against the busiest day', () => {
  /* The window's own arithmetic, derived independently of the implementation. */
  const end = new Date(NOW);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const start = new Date(end);
  start.setDate(start.getDate() - (HEAT_DAYS - 1));
  const indexOf = (date: Date) =>
    Math.floor(Math.round((date.getTime() - start.getTime()) / 86_400_000) / 7) * 7 + date.getDay();
  const daysAgo = (count: number) => {
    const date = new Date(NOW);
    date.setDate(date.getDate() - count);
    return date;
  };

  const busy = daysAgo(1);
  const quiet = daysAgo(10);
  const window = heatWindow([
    [key(busy.getDate(), busy.getMonth(), busy.getFullYear()), 8],
    [key(quiet.getDate(), quiet.getMonth(), quiet.getFullYear()), 2],
    ['2020-01-01', 99],
  ], NOW);

  assert.equal(window.heat[indexOf(busy)]?.level, 4);
  assert.equal(window.heat[indexOf(busy)]?.count, 8);
  assert.equal(window.heat[indexOf(quiet)]?.level, 1);
  assert.equal(window.heat[indexOf(NOW)]?.level, 0);
  assert.equal(window.heat[indexOf(NOW)]?.date, key(NOW.getDate()));
});

test('a window with no activity is entirely empty', () => {
  const window = heatWindow([], NOW);
  assert.deepEqual([...new Set(window.heat.map(cell => cell.level))], [0, null]);
});

test('counts and compact tokens use Chinese dates and a 24-hour clock', () => {
  assert.equal(formatCount(1556), '1,556');
  assert.equal(formatCount(0), '0');
  assert.equal(formatTokens(493_100_000), '493.1M');
  assert.equal(formatTokens(1_000_000), '1M');
  assert.equal(formatTokens(12_000), '12k');
  assert.equal(formatTokens(1_500), '1.5k');
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(2_500_000_000), '2.5B');
  assert.equal(formatHour(11), '11:00');
  assert.equal(formatHour(0), '00:00');
  assert.equal(formatHour(23), '23:00');
  assert.equal(formatDayLabel('2026-09-30'), '9月30日');
});

test('the heatmap tooltip uses Chinese dates', () => {
  assert.equal(heatTip('2026-09-30', 1387), '9月30日 \u2014 1,387');
  assert.equal(heatTip('2026-10-03', 0), '10月3日 \u2014 0');
});

test('the card data uses Chinese labels and keeps tile order and hidden metrics', () => {
  const data = buildCardData(snapshot({ busyHour: null }), { tab: 'overview', range: 'all' }, () => 0, NOW);
  assert.equal(data.tab, 'overview');
  assert.deepEqual(data.tabs.map(option => option.label), ['概览', '模型']);
  assert.deepEqual(data.ranges.map(option => option.label), ['全部', '近30天', '近7天']);
  assert.equal(data.range, 'all');
  assert.equal(data.models, null);
  const tiles = data.overview?.tiles ?? [];
  assert.deepEqual(tiles.map(tile => tile.label), [
    '会话数', '消息数', 'Token 总量', '活跃天数', '高峰时段', '常用模型',
  ]);
  assert.deepEqual(tiles.map(tile => tile.value), [
    '10', '1,556', '493.1M', '3', '\u2014', 'opencode-go/deepseek-v4.1-flash',
  ]);
  assert.equal(tiles.at(-1)?.small, true);
  assert.equal(data.overview?.futureFrom, 25 * 7 + NOW.getDay() + 1);
  assert.equal(data.overview?.note, '已使用的 Token 量约相当于《小王子》的 22413 倍。');
});

test('the range switch moves the tiles and the footer, but not the heatmap', () => {
  const snap = snapshot({
    ranges: {
      all: totals(),
      '30d': totals({ sessions: 4, messages: 20, tokens: 500_000, activeDays: 2, topModel: 'a/one' }),
      '7d': totals({ sessions: 1, messages: 3, tokens: 1000, activeDays: 1, topModel: null }),
    },
    days: [['2026-09-30', 3]],
  });
  const all = buildCardData(snap, { tab: 'overview', range: 'all' }, () => 0, NOW).overview;
  const week = buildCardData(snap, { tab: 'overview', range: '7d' }, () => 0, NOW).overview;
  assert.deepEqual(week?.tiles.map(tile => tile.value), ['1', '3', '1k', '1', '11:00', '\u2014']);
  assert.equal(week?.note, null);
  assert.deepEqual(week?.heat, all?.heat);
});

test('a total too small for any book hides the footer line', () => {
  const snap = snapshot({ ranges: { all: totals({ tokens: 1000 }), '30d': totals(), '7d': totals() } });
  const data = buildCardData(snap, { tab: 'overview', range: 'all' }, () => 0, NOW);
  assert.equal(data.overview?.note, null);
});

test('the book sentence follows the reference rule', () => {
  assert.equal(bookNote(0, () => 0), null);
  assert.equal(bookNote(21_999, () => 0), null);
  assert.equal(bookNote(22_000, () => 0), '已使用的 Token 量约相当于一本《小王子》。');
  assert.equal(bookNote(43_999, () => 0), '已使用的 Token 量约相当于一本《小王子》。');
  assert.equal(bookNote(493_100_000, () => 0), '已使用的 Token 量约相当于《小王子》的 22413 倍。');
  assert.equal(bookNote(493_100_000, () => 0.999), '已使用的 Token 量约相当于《战争与和平》的 675 倍。');
  assert.equal(bookNote(500_000, () => 0.999), '已使用的 Token 量约相当于一本《白鲸》。');
});

test('the y axis is the reference\u2019s own step search', () => {
  assert.deepEqual(tokenTicks(493_100_000), [0, 100_000_000, 200_000_000, 300_000_000, 400_000_000, 500_000_000]);
  assert.deepEqual(tokenTicks(700), [0, 200, 400, 600, 800]);
  assert.deepEqual(tokenTicks(9), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(tokenTicks(0), []);
  assert.deepEqual(tokenTicks(-5), []);
});

test('models are coloured by rank and the ramp clamps at six shades', () => {
  assert.equal(modelColor(0), 'var(--ccd-stats-model-1)');
  assert.equal(modelColor(5), 'var(--ccd-stats-model-6)');
  assert.equal(modelColor(9), 'var(--ccd-stats-model-6)');
  assert.equal(modelColor(-3), 'var(--ccd-stats-model-1)');
});

test('the models view stacks each day by rank and prints lifetime in/out', () => {
  const snap = snapshot({
    ranges: {
      all: totals({ tokens: 1000, models: [['a/one', 700], ['b/two', 300]] }),
      '30d': totals({ tokens: 1000, models: [['a/one', 700], ['b/two', 300]] }),
      '7d': totals({ tokens: 1000, models: [['a/one', 700], ['b/two', 300]] }),
    },
    modelDays: [['2026-09-29', 'b/two', 300], ['2026-09-30', 'a/one', 700]],
    modelIO: [['a/one', 400, 300], ['b/two', 100, 200]],
  });
  const models = buildModels(snap, 'all', NOW);
  assert.deepEqual(models.ticks, ['0', '200', '400', '600', '800']);
  assert.equal(models.top, 800);
  assert.deepEqual(models.days.map(day => [day.date, day.label, day.tokens]), [
    ['2026-09-29', '9月29日', 300],
    ['2026-09-30', '9月30日', 700],
  ]);
  assert.deepEqual(models.days[0]?.segments, [{ model: 'b/two', tokens: 300, color: 'var(--ccd-stats-model-2)' }]);
  assert.deepEqual(models.days[1]?.segments, [{ model: 'a/one', tokens: 700, color: 'var(--ccd-stats-model-1)' }]);
  assert.deepEqual(models.legend, [
    {
      model: 'a/one', color: 'var(--ccd-stats-model-1)', usage: '输入 400 \u00B7 输出 300', percent: '70.0%',
    },
    {
      model: 'b/two', color: 'var(--ccd-stats-model-2)', usage: '输入 100 \u00B7 输出 200', percent: '30.0%',
    },
  ]);
  assert.equal(models.moreCount, 0);
});

test('the models view filters by range and hides models below the reference floor', () => {
  const snap = snapshot({
    ranges: {
      all: totals({ tokens: 1_000_000, models: [['a/one', 999_950], ['b/tiny', 50]] }),
      '30d': totals({ tokens: 1_000_000, models: [['a/one', 999_950], ['b/tiny', 50]] }),
      '7d': totals({ tokens: 0, models: [] }),
    },
    modelDays: [
      ['2026-09-01', 'a/one', 999_950],
      ['2026-09-30', 'b/tiny', 50],
    ],
    modelIO: [['a/one', 1, 2], ['b/tiny', 3, 4]],
  });
  const all = buildModels(snap, 'all', NOW);
  /* `b/tiny` is 0.005% of the range, under the 0.05% floor, so it gets no bar
     and no legend row — but its day is still a day the chart draws. */
  assert.deepEqual(all.legend.map(row => row.model), ['a/one']);
  assert.deepEqual(all.days.map(day => [day.date, day.segments.length]), [['2026-09-01', 1], ['2026-09-30', 0]]);

  const week = buildModels(snap, '7d', NOW);
  assert.deepEqual(week.days.map(day => day.date), ['2026-09-30']);
  assert.deepEqual(week.ticks, []);
  assert.equal(week.top, 1);
  assert.deepEqual(week.legend, []);
});

test('more than six models hide behind the reference\u2019s "Show more"', () => {
  const models = Array.from({ length: 8 }, (_, index) => [`m/${String(index)}`, 1000 - index] as const);
  const snap = snapshot({
    ranges: { all: totals({ tokens: 8000, models }), '30d': totals({ tokens: 8000, models }), '7d': totals() },
  });
  const data = buildCardData(snap, { tab: 'models', range: 'all' }, () => 0, NOW);
  assert.equal(data.overview, null);
  assert.equal(data.models?.legend.length, 8);
  assert.equal(data.models?.moreCount, 2);
});

test('the host snapshot is validated before the card trusts it', () => {
  const range = {
    sessions: 2, messages: 5, tokens: 9, activeDays: 2, topModel: 'p/m', models: [['p/m', 9], ['', 3]],
  };
  const body = {
    version: STATS_VERSION,
    ranges: { all: range, '30d': range, '7d': 'nope' },
    busyHour: 3,
    days: [['2026-09-30', 4], ['nope', 1]],
    modelDays: [['2026-09-30', 'p/m', 4], ['x', 'p/m', 1], ['2026-09-30', 'p/m', 0]],
    modelIO: [['p/m', 1, 2], ['', 0, 0]],
    pending: 1,
    missed: 0,
    computedAt: 42,
  };
  const parsed = readStatsSnapshot(body);
  assert.equal(parsed?.ranges.all.tokens, 9);
  assert.deepEqual(parsed?.ranges.all.models, [['p/m', 9]]);
  assert.deepEqual(parsed?.ranges['7d'], {
    sessions: 0, messages: 0, tokens: 0, activeDays: 0, topModel: null, models: [],
  });
  assert.deepEqual(parsed?.days, [['2026-09-30', 4]]);
  assert.deepEqual(parsed?.modelDays, [['2026-09-30', 'p/m', 4]]);
  assert.deepEqual(parsed?.modelIO, [['p/m', 1, 2]]);
  assert.equal(readStatsSnapshot({ ...body, version: 1 }), null);
  assert.equal(readStatsSnapshot({ ...body, busyHour: 24 }), null);
  assert.equal(readStatsSnapshot({ ...body, pending: -1 }), null);
  assert.equal(readStatsSnapshot({ ...body, ranges: 'none' })?.ranges.all.tokens, 0);
  assert.equal(readStatsSnapshot(null), null);
});
