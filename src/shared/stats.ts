/**
 * Statistics-card contract shared by the plugin's two halves.
 *
 * The host half folds every stored session log into one sparse summary per
 * session (a project unit of the host's own projection seam, so incremental
 * folding and durable checkpoints stay the host's business) and aggregates
 * those summaries into a {@link StatsSnapshot}. The browser half reads that
 * snapshot from the host's authenticated route and paints the card. Both
 * halves import this file, so the wire vocabulary lives here rather than in
 * either half.
 *
 * Since the card grew the reference's `Models` view and its `All`/`30d`/`7d`
 * switch, a session's summary has to answer two more questions: which model
 * produced which tokens on which day, and how many tokens arrived with each
 * model in total (the legend prints lifetime in/out counters, exactly as the
 * reference does). The per-session value therefore carries a model table plus
 * a sparse `date → model index → tokens` list; the index keeps that list small
 * enough to ride the session payloads it is published on.
 */

/** Authenticated host route serving {@link StatsSnapshot}. */
export const STATS_PATH = '/api/ccd-stats';

/** Snapshot revision; a client that does not know the version ignores the body. */
export const STATS_VERSION = 2;

/** Days of history one snapshot ships; the card itself draws 26 weeks. */
export const STATS_DAY_LIMIT = 366;

/** The reference's three date ranges, in the order it draws them. */
export const STATS_RANGES = ['all', '30d', '7d'] as const;

/** One of the reference's range switches. */
export type StatsRangeId = (typeof STATS_RANGES)[number];

/** Days each range covers, counting back from today; `all` has no cutoff. */
export const STATS_RANGE_DAYS: Readonly<Record<StatsRangeId, number | null>> = {
  all: null,
  '30d': 30,
  '7d': 7,
};

/** Local `YYYY-MM-DD` for one instant, the day key both halves bucket by. */
export function localDayKey(time: number): string {
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The first local day a range covers.
 *
 * The reference counts back from today inclusive: `30d` starts 29 days ago.
 * Both halves need the same bound — the host to total a range, the browser to
 * cut the chart's days — so the rule lives here.
 *
 * @param range - the range switch.
 * @param now - the instant "today" is read from, epoch ms.
 * @returns the first day key, or null when the range has no cutoff.
 */
export function rangeStart(range: StatsRangeId, now: number): string | null {
  const days = STATS_RANGE_DAYS[range];
  if (days === null) return null;
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (days - 1));
  return localDayKey(date.getTime());
}

/** One local calendar day (`YYYY-MM-DD`) and its prompt count. */
export type StatsDay = readonly [string, number];

/** One local hour and its prompt count. */
export type StatsHour = readonly [number, number];

/** One `provider/model` with its tokens: total, input, output. */
export type StatsModelUsage = readonly [string, number, number, number];

/** One `provider/model` and the tokens attributed to it inside a range. */
export type StatsModelTokens = readonly [string, number];

/** One day of one session: local day, index into the value's model table, tokens. */
export type StatsModelDay = readonly [string, number, number];

/** One day of the whole library: local day, `provider/model`, tokens. */
export type StatsModelDayRow = readonly [string, string, number];

/** Lifetime input/output counters for one model, as the legend prints them. */
export type StatsModelIO = readonly [string, number, number];

/**
 * One session's contribution to the aggregate.
 *
 * `models` doubles as the index table for {@link StatsModelDay}: the day rows
 * point at their model's position in this list, which keeps the per-day data
 * from repeating a `provider/model` string for every day it appears on.
 */
export interface StatsSessionUsage {
  /** Human prompts: `user/message` events whose source kind is `user`. */
  readonly prompts: number;
  /** Tokens at the provider's scale, cache hits included. */
  readonly tokens: number;
  /** Per local day, sparse; only days with prompts appear. */
  readonly days: readonly StatsDay[];
  /** Per local hour, sparse; only hours with prompts appear. */
  readonly hours: readonly StatsHour[];
  /** Per model, sparse and sorted by name; the day rows index into this list. */
  readonly models: readonly StatsModelUsage[];
  /** Per day and model, sparse, sorted by day then model index. */
  readonly modelDays: readonly StatsModelDay[];
}

/** What one date range shows in the tiles, and the models the legend draws. */
export interface StatsRangeTotals {
  /** Sessions that did work inside the range. */
  readonly sessions: number;
  /** Human prompts inside the range. */
  readonly messages: number;
  /** Tokens produced inside the range, cache hits included. */
  readonly tokens: number;
  /** Local days with any activity inside the range. */
  readonly activeDays: number;
  /** The range's busiest model by tokens, or null when it saw no tokens. */
  readonly topModel: string | null;
  /** Every model inside the range, busiest first. */
  readonly models: readonly StatsModelTokens[];
}

/** The three ranges, keyed by {@link StatsRangeId}. */
export type StatsRanges = Readonly<Record<StatsRangeId, StatsRangeTotals>>;

/** Everything the card needs, aggregated over every visible stored session. */
export interface StatsSnapshot {
  readonly version: number;
  /** Totals for each range switch; `all` also feeds the heatmap's own scale. */
  readonly ranges: StatsRanges;
  /**
   * Busiest local hour over all time. The reference's tiles read this from its
   * unfiltered statistics while every other tile is range-filtered, so the card
   * does the same: switching range must not move `Peak hour`.
   */
  readonly busyHour: number | null;
  /** Local days and prompt counts, oldest first, capped at {@link STATS_DAY_LIMIT}. */
  readonly days: readonly StatsDay[];
  /** Tokens per day and model, oldest first, capped at {@link STATS_DAY_LIMIT} days. */
  readonly modelDays: readonly StatsModelDayRow[];
  /** Lifetime input/output counters per model, for the legend's middle column. */
  readonly modelIO: readonly StatsModelIO[];
  /** Sessions still being folded; the card polls faster while this is non-zero. */
  readonly pending: number;
  /** Sessions whose logs could not be read and are therefore missing from the totals. */
  readonly missed: number;
  /** When the host computed this snapshot (epoch ms). */
  readonly computedAt: number;
}

/** Compare ordered wire rows without serializing or allocating a second copy. */
function sameRows(left: readonly (readonly (string | number)[])[], right: readonly (readonly (string | number)[])[]): boolean {
  return left === right || (left.length === right.length && left.every((row, index) => {
    const other = right[index]!;
    return row === other || (row.length === other.length && row.every((value, at) => value === other[at]));
  }));
}

/** Projection wrappers can change identity while their effective usage stays the same. */
export function sameStatsUsage(left: StatsSessionUsage | undefined, right: StatsSessionUsage): boolean {
  return left === right || (left !== undefined && left.prompts === right.prompts && left.tokens === right.tokens
    && sameRows(left.days, right.days) && sameRows(left.hours, right.hours)
    && sameRows(left.models, right.models) && sameRows(left.modelDays, right.modelDays));
}

/** Only values the card draws; transport timestamps and fold progress are excluded. */
export function sameStatsDisplay(left: StatsSnapshot, right: StatsSnapshot): boolean {
  if (left === right) return true;
  if (left.version !== right.version || left.busyHour !== right.busyHour
    || !sameRows(left.days, right.days) || !sameRows(left.modelDays, right.modelDays)
    || !sameRows(left.modelIO, right.modelIO)) return false;
  return STATS_RANGES.every(id => {
    const a = left.ranges[id], b = right.ranges[id];
    return a === b || (a.sessions === b.sessions && a.messages === b.messages && a.tokens === b.tokens
      && a.activeDays === b.activeDays && a.topModel === b.topModel && sameRows(a.models, b.models));
  });
}

/** Semantic snapshot equality; computedAt alone must not wake subscribers. */
export function sameStatsSnapshot(left: StatsSnapshot, right: StatsSnapshot): boolean {
  return left === right || (left.pending === right.pending && left.missed === right.missed && sameStatsDisplay(left, right));
}

/** Whether a value is a finite, non-negative count. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Whether a value is a usable `YYYY-MM-DD` key. */
function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Read one `[key, count]` pair list, dropping anything that is not a count.
 *
 * @param value - candidate list.
 * @param key - narrows the first element.
 * @returns the surviving pairs.
 */
function readPairs<K>(value: unknown, key: (raw: unknown) => K | null): readonly (readonly [K, number])[] {
  if (!Array.isArray(value)) return [];
  const pairs: (readonly [K, number])[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [rawKey, count] = entry as [unknown, unknown];
    if (!isCount(count)) continue;
    const parsed = key(rawKey);
    if (parsed === null) continue;
    pairs.push([parsed, count] as const);
  }
  return pairs;
}

/**
 * Read one `[date, model, tokens]` triple list.
 *
 * @param value - candidate list.
 * @returns the surviving triples.
 */
function readModelDays(value: unknown): readonly StatsModelDayRow[] {
  if (!Array.isArray(value)) return [];
  const rows: StatsModelDayRow[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 3) continue;
    const [date, model, tokens] = entry as [unknown, unknown, unknown];
    if (!isDayKey(date) || typeof model !== 'string' || model === '' || !isCount(tokens) || tokens === 0) continue;
    rows.push([date, model, tokens] as const);
  }
  return rows;
}

/**
 * Read one `[model, in, out]` triple list.
 *
 * @param value - candidate list.
 * @returns the surviving triples.
 */
function readModelIO(value: unknown): readonly StatsModelIO[] {
  if (!Array.isArray(value)) return [];
  const rows: StatsModelIO[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 3) continue;
    const [model, input, output] = entry as [unknown, unknown, unknown];
    if (typeof model !== 'string' || model === '' || !isCount(input) || !isCount(output)) continue;
    rows.push([model, input, output] as const);
  }
  return rows;
}

/** An empty range, used for a body that is missing or unreadable. */
function emptyRange(): StatsRangeTotals {
  return { sessions: 0, messages: 0, tokens: 0, activeDays: 0, topModel: null, models: [] };
}

/**
 * Read one range's totals.
 *
 * @param value - candidate object.
 * @returns the totals, or null when the object is not one.
 */
function readRange(value: unknown): StatsRangeTotals | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const { sessions, messages, tokens, activeDays } = raw;
  if (!isCount(sessions) || !isCount(messages) || !isCount(tokens) || !isCount(activeDays)) return null;
  const topModel = raw['topModel'];
  if (topModel !== null && typeof topModel !== 'string') return null;
  return {
    sessions,
    messages,
    tokens,
    activeDays,
    topModel,
    models: readPairs(raw['models'], model => (typeof model === 'string' && model !== '' ? model : null)),
  };
}

/** Read the three ranges; a missing one becomes an empty range. */
function readRanges(value: unknown): StatsRanges {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const ranges = {} as Record<StatsRangeId, StatsRangeTotals>;
  for (const id of STATS_RANGES) ranges[id] = readRange(raw[id]) ?? emptyRange();
  return ranges;
}

/**
 * Read one snapshot from untrusted JSON.
 *
 * The browser half treats the host route as the one data source it does not
 * compile against, so the response is validated structurally before it can
 * reach the card: a body that is not a snapshot at this version is refused and
 * the card simply stays hidden.
 *
 * @param value - parsed response body.
 * @returns the snapshot, or null when the body is not one.
 */
export function readStatsSnapshot(value: unknown): StatsSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw['version'] !== STATS_VERSION) return null;
  const pending = raw['pending'];
  const missed = raw['missed'];
  const computedAt = raw['computedAt'];
  const busyHour = raw['busyHour'];
  if (!isCount(pending) || !isCount(missed) || !isCount(computedAt)) return null;
  if (busyHour !== null && (!isCount(busyHour) || busyHour > 23)) return null;
  return {
    version: STATS_VERSION,
    ranges: readRanges(raw['ranges']),
    busyHour,
    days: readPairs(raw['days'], raw => (isDayKey(raw) ? raw : null)),
    modelDays: readModelDays(raw['modelDays']),
    modelIO: readModelIO(raw['modelIO']),
    pending,
    missed,
    computedAt,
  };
}
