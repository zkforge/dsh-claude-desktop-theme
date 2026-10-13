/**
 * Snapshot → card data: the reference's own presentation rules.
 *
 * Two views share one snapshot. `Overview` draws 182 days (26 columns × 7 rows)
 * ending on the Saturday of the current week, with the day rows running
 * Sunday-first — the window the reference computes — and levels of
 * `ceil(count / busiest day * 4)`; days after today are transparent rather than
 * empty, which is why the card data marks them instead of giving them a level.
 * `Models` draws one bar per day that produced tokens, stacked by model and
 * scaled to the axis the reference derives from the busiest day.
 *
 * The range switch filters the tiles, the chart and the footer sentence, but
 * not the heatmap or `Peak hour`: the reference feeds both from unfiltered
 * statistics, and its heatmap is a fixed 182-day window.
 */
import {
  localDayKey, rangeStart,
  type StatsDay, type StatsModelTokens, type StatsRangeId, type StatsSnapshot,
} from '../../../shared/stats.ts';
import { bookNote } from './books.ts';
import {
  HEAT_COLUMNS, HEAT_ROWS, LEGEND_LIMIT, heatLevel,
  type ChartDay, type HeatCell, type LegendRow, type StatsCardData, type StatsModelsData,
  type StatsOption, type StatsOverviewData, type StatsTabId, type StatsTile,
} from './card.ts';
import { formatCount, formatDayLabel, formatHour, formatTokens } from './format.ts';

export { formatCount, formatDayLabel, formatHour, formatTokens };

/** Days the heatmap draws: 26 weeks. */
export const HEAT_DAYS = HEAT_COLUMNS * HEAT_ROWS;

/** Placeholder the reference shows for a metric it has no data for. */
const EMPTY = '\u2014';

/** The reference's own tabs, in its order. */
export const STATS_TABS: readonly StatsOption<StatsTabId>[] = [
  { id: 'overview', label: '概览' },
  { id: 'models', label: '模型' },
];

/** The reference's own ranges, in its order. */
export const STATS_RANGE_OPTIONS: readonly StatsOption<StatsRangeId>[] = [
  { id: 'all', label: '全部' },
  { id: '30d', label: '近30天' },
  { id: '7d', label: '近7天' },
];

/** Which view and range the card is showing. */
export interface StatsViewState {
  readonly tab: StatsTabId;
  readonly range: StatsRangeId;
}

/** What a freshly mounted card shows, matching the reference's defaults. */
export const INITIAL_STATS_VIEW: StatsViewState = { tab: 'overview', range: 'all' };

/**
 * The reference hides models below this share of the range's tokens, in the
 * chart's bars and in the legend alike (`totalTokens * 5e-4`).
 */
const MODEL_SHARE_FLOOR = 5e-4;

/** Distinct shades the reference's model ramp produces before it clamps. */
const MODEL_SHADES = 6;

/** What the card draws for the 182-day window. */
export interface HeatWindow {
  /** One cell per day, column-major: `column * 7 + row`, Sunday first. */
  readonly heat: readonly HeatCell[];
  /** First index drawn after today; those cells stay transparent. */
  readonly futureFrom: number;
}

/**
 * Lay the host's sparse day counts out on the reference's 26-week grid.
 *
 * @param days - local day keys with their counts.
 * @param now - the current instant (injectable for tests).
 * @returns the cells and where "today" ends.
 */
export function heatWindow(days: readonly StatsDay[], now: Date = new Date()): HeatWindow {
  const counts = new Map(days);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(today);
  end.setDate(end.getDate() + (6 - end.getDay()));
  const start = new Date(end);
  start.setDate(start.getDate() - (HEAT_DAYS - 1));

  const keys: string[] = [];
  const raw: number[] = [];
  let peak = 0;
  let futureFrom = HEAT_DAYS;
  for (let index = 0; index < HEAT_DAYS; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = localDayKey(date.getTime());
    const future = date > today;
    const count = future ? 0 : counts.get(key) ?? 0;
    if (future && futureFrom === HEAT_DAYS) futureFrom = index;
    keys.push(key);
    raw.push(count);
    peak = Math.max(peak, count);
  }
  const heat = raw.map((count, index): HeatCell => ({
    date: keys[index] ?? '',
    count,
    level: index >= futureFrom ? null : heatLevel(count, peak),
  }));
  return { heat, futureFrom };
}

/**
 * The reference's y-axis steps: from `1/2/5/10/20/50` scaled to the magnitude
 * of `max / 6`, keep the candidates that fit in six steps and take the one
 * whose top is lowest, preferring four steps on a tie.
 *
 * @param max - the busiest day's tokens.
 * @returns the tick values, lowest first; empty when there is nothing to scale.
 */
export function tokenTicks(max: number): number[] {
  if (!(max > 0)) return [];
  const scale = 10 ** Math.floor(Math.log10(max / 6));
  const candidates = [1, 2, 5, 10, 20, 50]
    .map(step => ({ step: Math.max(1, step * scale), steps: 0 }))
    .map(candidate => ({ ...candidate, steps: Math.ceil(max / candidate.step) }))
    .filter(candidate => candidate.steps <= 6);
  if (candidates.length === 0) return [max];
  const best = candidates.reduce((left, right) => {
    const leftTop = left.step * left.steps;
    const rightTop = right.step * right.steps;
    if (rightTop < leftTop) return right;
    if (rightTop === leftTop && Math.abs(right.steps - 4) < Math.abs(left.steps - 4)) return right;
    return left;
  });
  return Array.from({ length: best.steps + 1 }, (_, index) => index * best.step);
}

/**
 * The colour of the n-th busiest model.
 *
 * The reference computes `hsl(217 70% min(88, 58 + 7n)%)`, which flattens into
 * six shades; the theme carries those six so both themes can express them.
 *
 * @param index - position in the range's model list.
 * @returns a theme variable holding that shade.
 */
export function modelColor(index: number): string {
  const shade = Math.min(Math.max(index, 0) + 1, MODEL_SHADES);
  return `var(--ccd-stats-model-${String(shade)})`;
}

/**
 * The `Overview` body for one range.
 *
 * @param snapshot - the host's aggregate.
 * @param range - the selected range.
 * @param random - stable draw for the footer's book choice.
 * @param now - the current instant (injectable for tests).
 * @returns tiles, heat cells and the footer sentence.
 */
export function buildOverview(
  snapshot: StatsSnapshot,
  range: StatsRangeId,
  random: () => number,
  now: Date = new Date(),
): StatsOverviewData {
  const totals = snapshot.ranges[range];
  const window = heatWindow(snapshot.days, now);
  const tiles: StatsTile[] = [
    { label: '会话数', value: formatCount(totals.sessions) },
    { label: '消息数', value: formatCount(totals.messages) },
    { label: 'Token 总量', value: formatTokens(totals.tokens) },
    { label: '活跃天数', value: formatCount(totals.activeDays) },
    { label: '高峰时段', value: snapshot.busyHour === null ? EMPTY : formatHour(snapshot.busyHour) },
    { label: '常用模型', value: totals.topModel ?? EMPTY, small: true },
  ];
  return {
    tiles,
    heat: window.heat,
    futureFrom: window.futureFrom,
    note: bookNote(totals.tokens, random),
  };
}

/**
 * The `Models` body for one range.
 *
 * @param snapshot - the host's aggregate.
 * @param range - the selected range.
 * @param now - the current instant (injectable for tests).
 * @returns the chart and its legend.
 */
export function buildModels(
  snapshot: StatsSnapshot,
  range: StatsRangeId,
  now: Date = new Date(),
): StatsModelsData {
  const totals = snapshot.ranges[range];
  const start = rangeStart(range, now.getTime());
  const visible: readonly StatsModelTokens[] = totals.models.filter(([, tokens]) =>
    tokens >= totals.tokens * MODEL_SHARE_FLOOR);
  const index = new Map(visible.map(([model], at) => [model, at]));

  const rows = new Map<string, { model: string; tokens: number }[]>();
  for (const [date, model, tokens] of snapshot.modelDays) {
    if (start !== null && date < start) continue;
    const list = rows.get(date) ?? [];
    list.push({ model, tokens });
    rows.set(date, list);
  }
  const days: ChartDay[] = [...rows.keys()].sort().map(date => {
    const segments = (rows.get(date) ?? [])
      .filter(entry => index.has(entry.model))
      .sort((left, right) => (index.get(left.model) ?? 0) - (index.get(right.model) ?? 0))
      .map(entry => ({
        model: entry.model,
        tokens: entry.tokens,
        color: modelColor(index.get(entry.model) ?? 0),
      }));
    return {
      date,
      label: formatDayLabel(date),
      tokens: segments.reduce((sum, segment) => sum + segment.tokens, 0),
      segments,
    };
  });
  const steps = tokenTicks(days.reduce((max, day) => Math.max(max, day.tokens), 0));

  const io = new Map(snapshot.modelIO.map(([model, input, output]) => [model, { input, output }]));
  const legend: LegendRow[] = visible.map(([model, tokens], at) => {
    const counters = io.get(model) ?? { input: 0, output: 0 };
    return {
      model,
      color: modelColor(at),
      usage: `输入 ${formatTokens(counters.input)} \u00B7 输出 ${formatTokens(counters.output)}`,
      percent: `${((tokens / (totals.tokens || 1)) * 100).toFixed(1)}%`,
    };
  });

  return {
    ticks: steps.map(formatTokens),
    top: steps.at(-1) ?? 1,
    days,
    legend,
    moreCount: Math.max(0, legend.length - LEGEND_LIMIT),
  };
}

/**
 * Build everything the card draws for one snapshot and view state.
 *
 * @param snapshot - the host's aggregate.
 * @param state - the selected tab and range.
 * @param random - stable draw for the footer's book choice.
 * @param now - the current instant (injectable for tests).
 * @returns the card data.
 */
export function buildCardData(
  snapshot: StatsSnapshot,
  state: StatsViewState,
  random: () => number,
  now: Date = new Date(),
): StatsCardData {
  return {
    tab: state.tab,
    tabs: STATS_TABS,
    ranges: STATS_RANGE_OPTIONS,
    range: state.range,
    overview: state.tab === 'overview' ? buildOverview(snapshot, state.range, random, now) : null,
    models: state.tab === 'models' ? buildModels(snapshot, state.range, now) : null,
  };
}
