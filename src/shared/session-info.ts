/** Read-only information for the current Session's right-hand cards. */
export const SESSION_ENVIRONMENT_PATH = '/api/ccd-session-environment';
export const SESSION_INFO_KEY = 'ccdSessionInfo';

export interface SessionEnvironment {
  readonly cwd: string;
  readonly branch: string | null;
  readonly detached: boolean;
  readonly git: 'ready' | 'not-repo' | 'error';
  readonly worktree: boolean | null;
}

export interface SessionMetrics {
  /** All prompt input, including cache reads and writes; provider buckets are disjoint. */
  readonly input: number | null;
  readonly output: number | null;
  readonly cacheHit: number | null;
  readonly prompts: number | null;
  /** Whole-session weighted decode rate, updated when a model step settles. */
  readonly tps: number | null;
}

export function infoRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Native whole-log projections, never DOM labels or the global statistics snapshot. */
export function sessionMetrics(values: Readonly<Record<string, unknown>>): SessionMetrics {
  const usage = infoRecord(values['tokenUsage']);
  const stats = infoRecord(values['sessionStats']);
  const info = infoRecord(values[SESSION_INFO_KEY]);
  const uncached = count(usage['uncachedInputTokens']);
  const read = count(usage['cacheReadTokens']);
  const write = count(usage['cacheWriteTokens']);
  const input = uncached === null || read === null || write === null ? null : uncached + read + write;
  const ms = count(stats['decodeMs']);
  const tokens = count(stats['decodeTokens']);
  return {
    input,
    output: count(usage['outputTokens']),
    cacheHit: input === null || input === 0 || read === null ? null : Math.min(1, read / input),
    prompts: count(info['prompts']),
    tps: ms === null || ms === 0 || tokens === null || tokens === 0 ? null : tokens * 1000 / ms,
  };
}

/** Rail mode reserves readable chat space; overlays need only their own width. */
export function showSessionInfo(width: number, height: number, shown: boolean, overlay = false): boolean {
  const minWidth = overlay ? (shown ? 296 : 320) : (shown ? 900 : 924);
  return Number.isFinite(width) && Number.isFinite(height)
    && width >= minWidth && height >= (shown ? 400 : 424);
}

export const SESSION_CARD_IDS = ['context', 'environment', 'usage'] as const;
export type SessionCardId = typeof SESSION_CARD_IDS[number];

export interface SessionCardPreferences {
  readonly order: readonly SessionCardId[];
  readonly collapsed: readonly SessionCardId[];
}

export function readCardPreferences(value: unknown): SessionCardPreferences {
  const raw = infoRecord(value);
  const valid = (item: unknown): item is SessionCardId => SESSION_CARD_IDS.includes(item as SessionCardId);
  const order = Array.isArray(raw['order']) ? [...new Set(raw['order'].filter(valid))] : [];
  return {
    order: [...order, ...SESSION_CARD_IDS.filter(id => !order.includes(id))],
    collapsed: Array.isArray(raw['collapsed']) ? [...new Set(raw['collapsed'].filter(valid))] : ['context'],
  };
}
