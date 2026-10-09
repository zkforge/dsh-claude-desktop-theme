/**
 * The context-breakdown contract both halves share.
 *
 * The host half re-derives what the host's own three-number breakdown cannot
 * say — per-tool rows, per-file rows, per-skill rows, the autocompaction
 * threshold — and ships it as the `ccdContext` projection; the browser half
 * reads the host's authoritative `contextPressure` / `contextBreakdown` beside
 * it and turns all of it into the panel's rows and bar with the pure functions
 * below. Keeping the arithmetic here is what lets the card be a pure function
 * of its inputs and lets the tests price a real session log without a browser.
 *
 * The pricing constants are the host's own (`@deepseek-ai/dsh-token-meter`
 * `estimate.ts`): four characters per token, four tokens of structural overhead
 * per content block and per message. They are restated rather than imported —
 * that package is not part of this plugin's runtime baseline — and every number
 * they produce is a re-derivation of a value the host also computed, never a
 * second authority beside it.
 */

/** Projection key this plugin owns; it must not collide with a host key. */
export const CONTEXT_KEY = 'ccdContext';

/** Persisted-cache invalidation version for the fold state. */
export const CONTEXT_STATE_VERSION = 1;

/** Characters per token in the host's density heuristic. */
export const CHARS_PER_TOKEN = 4;

/** Structural overhead the host adds per content block and per message. */
export const BLOCK_OVERHEAD = 4;

/** Default autocompaction threshold ratio (`compaction-basic`). */
export const DEFAULT_THRESHOLD_RATIO = 0.8;

/** Default autocompaction headroom, in tokens (`compaction-basic`). */
export const DEFAULT_HEADROOM_TOKENS = 65536;

/** The public-name prefix DSH gives every MCP tool. */
export const MCP_PREFIX = 'mcp__';

/** Distinct entries one fold group keeps before it drops the smallest. */
export const CONTEXT_ENTRY_LIMIT = 200;

/** Detail rows a group renders before its list scrolls. */
export const DETAIL_ROW_LIMIT = 200;

/** The narrowest segment the bar draws; anything under this is left out. */
export const MIN_SEGMENT_PX = 2;

/** One priced row, as it travels on the wire: `[name, tokens]`. */
export type ContextEntry = readonly [name: string, tokens: number];

/** The `ccdContext` projection's client-visible value. */
export interface ContextBreakdownView {
  /** Every assembled tool schema, largest first. */
  readonly tools: readonly ContextEntry[];
  /** Every retained instruction file, largest first. */
  readonly files: readonly ContextEntry[];
  /** Every retained skill-catalog entry, largest first. */
  readonly skills: readonly ContextEntry[];
  /** Tokens every retained skill catalog contributes to the surface. */
  readonly skillTokens: number;
  /** Tokens every retained instruction message contributes to the surface. */
  readonly fileTokens: number;
  /** Effective autocompaction threshold, or null when no policy is readable. */
  readonly compaction: number | null;
}

/** One row of the panel, and one segment of the bar, in the reference's order. */
export type ContextSliceKey =
  | 'mcp' | 'tools' | 'system' | 'skills' | 'memory' | 'messages' | 'autocompact' | 'free';

/** One priced slice of the context window. */
export interface ContextSlice {
  readonly key: ContextSliceKey;
  /** Tokens this slice holds; never negative. */
  readonly tokens: number;
}

/**
 * Everything the panel draws from: the host's two authoritative projections,
 * this plugin's re-derived rows, and the session's capacity.
 */
export interface ContextSource {
  /** `contextPressure.contextWindow`. */
  readonly window: number;
  /** Occupancy: `projectedTokens ?? pressureTokens` — the ring's own number. */
  readonly used: number;
  /** `contextBreakdown.systemTokens`. */
  readonly systemTokens: number;
  /** `contextBreakdown.toolsTokens`. */
  readonly toolsTokens: number;
  /** Per-tool rows, used only to split the authoritative total in two. */
  readonly tools?: readonly ContextEntry[];
  /** `contextBreakdown.messageTokens`. */
  readonly messageTokens: number;
  /** Tokens in every retained skill catalog, re-derived. */
  readonly skillTokens: number;
  /** Tokens in every retained instruction message, re-derived. */
  readonly fileTokens: number;
  /** Effective autocompaction threshold, or null when it is not readable. */
  readonly compaction: number | null;
}

/** The panel's whole reading, ready to draw. */
export interface ContextBreakdown {
  /** The session's capacity. */
  readonly window: number;
  /** Occupancy, exactly as the ring reads it. */
  readonly used: number;
  /** The ring's own integer percentage. */
  readonly percent: number;
  /** Every row, in the bar's own order; `free` is last. */
  readonly slices: readonly ContextSlice[];
  /** The slices the bar draws, without `free` — the track is the remainder. */
  readonly segments: readonly ContextSlice[];
  /** `used − Σ rows`: the sampled reading's distance from the heuristic tree. */
  readonly residual: number;
}

/** A non-negative finite count, or zero. */
function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Read a non-negative integer, or null when the value is not one. */
export function readCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Read one `[name, tokens]` list, dropping everything else. */
export function readEntries(value: unknown): readonly ContextEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ContextEntry[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [name, tokens] = entry as [unknown, unknown];
    if (typeof name !== 'string' || name === '') continue;
    const priced = typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
    if (priced === 0) continue;
    entries.push([name, priced] as const);
  }
  return entries;
}

/**
 * Read one `ccdContext` value, from the wire or from a hand-written fixture.
 *
 * Deliberately lenient — a build that carries no such key, or a value from a
 * later state version, must read as "this plugin's rows are not here" rather
 * than throw into a render — and deliberately strict about *that*: a value that
 * is not an object is null, so the panel can tell "no rows" from "zero rows".
 *
 * @param value - the raw projection value.
 * @returns a usable view, or null when there is nothing to read.
 */
export function readContextView(value: unknown): ContextBreakdownView | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  return {
    tools: readEntries(raw['tools']),
    files: readEntries(raw['files']),
    skills: readEntries(raw['skills']),
    skillTokens: count(typeof raw['skillTokens'] === 'number' ? raw['skillTokens'] : 0),
    fileTokens: count(typeof raw['fileTokens'] === 'number' ? raw['fileTokens'] : 0),
    compaction: readCount(raw['compaction']),
  };
}

/** The empty view, for a build or a state version that carries no rows. */
export function emptyContextView(): ContextBreakdownView {
  return { tools: [], files: [], skills: [], skillTokens: 0, fileTokens: 0, compaction: null };
}

/** One slice, dropping empty rows so the panel never draws a zero-height one. */
function slice(key: ContextSliceKey, tokens: number): ContextSlice | null {
  const priced = count(tokens);
  return priced > 0 ? { key, tokens: priced } : null;
}

/**
 * Split the authoritative tool total across the MCP and built-in groups.
 *
 * The host prices the assembled tool array whole (`ceil(JSON.length / 4) + 4`),
 * so per-tool prices cannot be summed back to it — 37 real tools came to 7657
 * against the array's 7492. The authoritative total is therefore split in the
 * ratio the per-tool prices report, which keeps the two rows summing to the
 * host's own number with the rounding difference absorbed here.
 *
 * @param tools - per-tool rows, `[name, tokens]`.
 * @param total - the host's authoritative `toolsTokens`.
 * @returns the MCP share and the built-in share, summing to `total`.
 */
export function splitTools(
  tools: readonly ContextEntry[],
  total: number,
): { readonly mcp: number; readonly tools: number } {
  const priced = count(total);
  if (priced === 0) return { mcp: 0, tools: 0 };
  let mcp = 0;
  let builtin = 0;
  for (const [name, tokens] of tools) {
    if (name.startsWith(MCP_PREFIX)) mcp += count(tokens);
    else builtin += count(tokens);
  }
  const pricedTotal = mcp + builtin;
  if (pricedTotal === 0) return { mcp: 0, tools: priced };
  const share = Math.round(priced * mcp / pricedTotal);
  return { mcp: share, tools: priced - share };
}

/**
 * The panel's rows, bar segments and residual.
 *
 * @param source - the host's projections plus this plugin's re-derived rows.
 * @returns the whole reading; rows that price at zero are left out.
 */
export function contextBreakdown(source: ContextSource): ContextBreakdown {
  const window = count(source.window);
  const used = count(source.used);
  const skills = count(source.skillTokens);
  const memory = count(source.fileTokens);
  const tools = count(source.toolsTokens);
  const split = splitTools(source.tools ?? [], tools);
  /* `messageTokens` is the host's whole retained surface minus the system
     prompt; the two re-derived shares come out of it, so the four rows still
     sum to the host's own three numbers. */
  const messages = Math.max(0, count(source.messageTokens) - skills - memory);
  const autocompact = autocompactTokens(window, source.compaction, used);
  const slices: ContextSlice[] = [];
  for (const entry of [
    slice('mcp', split.mcp),
    slice('tools', split.tools),
    slice('system', count(source.systemTokens)),
    slice('skills', skills),
    slice('memory', memory),
    slice('messages', messages),
    slice('autocompact', autocompact),
    /* The buffer is reserved out of the window's spare room, not added on top
       of the reading: the reference's own rows come to exactly 100% with it. */
    slice('free', window - used - autocompact),
  ]) if (entry !== null) slices.push(entry);
  return {
    window,
    used,
    percent: window === 0 ? 0 : Math.min(100, Math.round(used / window * 100)),
    slices,
    segments: slices.filter(entry => entry.key !== 'free' && entry.key !== 'autocompact'),
    residual: used - (count(source.systemTokens) + tools + count(source.messageTokens)),
  };
}

/**
 * The autocompaction segment's own height: what the policy holds back.
 *
 * `compaction-basic` resolves `floor(min(window × ratio, window − reserved −
 * headroom))`; the segment is the distance from that threshold to the window,
 * which is the room the window keeps for the summary it will write. A session
 * with no readable policy, or one already past its threshold, draws nothing.
 *
 * @param window - the session's capacity.
 * @param compaction - the resolved threshold, or null when unreadable.
 * @param used - current occupancy, which the segment never overstates.
 * @returns the segment's token height; 0 when it is not drawn.
 */
export function autocompactTokens(window: number, compaction: number | null, used: number): number {
  if (compaction === null || window === 0) return 0;
  return Math.max(0, Math.min(window - count(compaction), window - count(used)));
}

/**
 * The autocompaction threshold a request envelope implies.
 *
 * `reservedCompletionTokens` is the request's own output cap; a route that
 * advertises none leaves the reservation unknown, and the row is then left out
 * rather than guessed at.
 *
 * @param window - the session's capacity.
 * @param reserved - the request's `maxTokens`, or null when it declares none.
 * @param ratio - the policy's threshold ratio.
 * @param headroom - the policy's headroom, in tokens.
 * @returns the threshold, or null when it cannot be resolved.
 */
export function compactionThreshold(
  window: number,
  reserved: number | null,
  ratio: number = DEFAULT_THRESHOLD_RATIO,
  headroom: number = DEFAULT_HEADROOM_TOKENS,
): number | null {
  const capacity = count(window);
  if (capacity === 0 || reserved === null || !Number.isFinite(reserved) || reserved < 0) return null;
  const pressureBudget = capacity - reserved - count(headroom);
  if (pressureBudget <= 0) return null;
  return Math.floor(Math.min(capacity * ratio, pressureBudget));
}

/**
 * The bar's segments and the free weight beside them, all in tokens.
 *
 * The reference drops a category whose share is under 2px instead of drawing a
 * hairline. The bar's weights have to add up to the window for a segment's
 * share to be its share of the window — and the rows deliberately do not, since
 * the sampled reading and the heuristic tree differ — so the remainder is
 * measured against the window rather than summed from the rows.
 *
 * @param breakdown - the panel's reading.
 * @param barWidth - the bar's measured width in CSS pixels.
 * @returns the drawn segments and the free weight, all in tokens.
 */
export function barSegments(
  breakdown: ContextBreakdown,
  barWidth: number,
): { readonly drawn: readonly ContextSlice[]; readonly free: number } {
  const drawn: ContextSlice[] = [];
  for (const entry of breakdown.slices) {
    if (entry.key === 'free') continue;
    if (barWidth > 0 && breakdown.window > 0
      && entry.tokens / breakdown.window * barWidth < MIN_SEGMENT_PX) continue;
    drawn.push(entry);
  }
  const placed = drawn.reduce((sum, entry) => sum + entry.tokens, 0);
  return { drawn, free: Math.max(0, breakdown.window - placed) };
}

/**
 * The reference's compact token count: `342`, `4.6k`, `216.7k`, `1M`.
 *
 * One decimal place, with a trailing `.0` dropped — which is what the
 * reference's own readings show (`48k`, `32.5k`, `216.7k`, `878k`, `1M`). The
 * host's own formatter rounds to a whole number above 100 and would print
 * `217k` where the reference prints `216.7k`; the panel follows the reference,
 * and the header still agrees with the ring because both read the same
 * `contextPressure` value.
 *
 * @param value - token count.
 * @returns the compact reading.
 */
export function formatTokens(value: number): string {
  const tokens = Math.max(0, Math.round(value));
  const scaled = (candidate: number) => candidate.toFixed(1).replace(/\.0$/u, '');
  if (tokens < 1e3) return String(tokens);
  if (tokens < 1e6) return `${scaled(tokens / 1e3)}k`;
  return `${scaled(tokens / 1e6)}M`;
}

/**
 * One row's share of the window, at the reference's one decimal.
 *
 * @param tokens - the row's tokens.
 * @param window - the session's capacity.
 * @returns e.g. `4.8%`.
 */
export function formatPercent(tokens: number, window: number): string {
  if (window <= 0) return '0.0%';
  return `${(Math.max(0, tokens) / window * 100).toFixed(1)}%`;
}

/**
 * An MCP tool's two names, as the reference writes them.
 *
 * DSH gives every MCP tool the public name `mcp__<server>__<tool>`; the panel
 * shows `<server> · <tool>`. A name that does not follow the convention is
 * returned unchanged, so a build that renames the prefix loses the split and
 * nothing else.
 *
 * @param name - the tool's public name.
 * @returns the display label.
 */
export function toolLabel(name: string): string {
  if (!name.startsWith(MCP_PREFIX)) return name;
  const rest = name.slice(MCP_PREFIX.length);
  const at = rest.indexOf('__');
  if (at <= 0) return rest;
  return `${rest.slice(0, at)} · ${rest.slice(at + 2)}`;
}

/** The MCP server one tool name belongs to, or null for a built-in tool. */
export function mcpServer(name: string): string | null {
  if (!name.startsWith(MCP_PREFIX)) return null;
  const rest = name.slice(MCP_PREFIX.length);
  const at = rest.indexOf('__');
  return at > 0 ? rest.slice(0, at) : rest;
}

/**
 * Shorten a path from the middle, keeping its own file name.
 *
 * The reference writes `/Users/zoukai/code/dsh-ccd-…AGENTS.md`: the tail is what
 * identifies the file, so the head gives way first. A path that already fits is
 * returned unchanged.
 *
 * The budget is the panel's own label column: a fixed 360px card leaves about
 * 208px for a detail row's name, which is this many characters of a path at
 * 13px with room to spare. It is deliberately conservative — the row carries
 * the full path in its `title`, and CSS's own ellipsis would eat the tail this
 * function exists to keep.
 *
 * @param path - the path as the instruction message named it.
 * @param budget - characters to keep, the ellipsis included.
 * @returns the shortened path.
 */
export function shortenPath(path: string, budget = 32): string {
  if (path.length <= budget || budget < 8) return path;
  const tail = Math.max(4, Math.floor((budget - 1) * 0.4));
  return `${path.slice(0, budget - 1 - tail)}…${path.slice(-tail)}`;
}
