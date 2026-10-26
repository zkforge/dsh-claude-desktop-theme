import { localDayKey } from '../../shared/stats.ts';

/**
 * Daily spend derived from successive balance reads on this machine.
 *
 * DeepSeek's balance endpoint has no usage history, so a drop between two
 * reads on the same local day is counted as spend and a rise (top-up or
 * grant) only moves the baseline. Amounts are integer cents.
 */
export interface BalanceLedger {
  readonly day: string;
  readonly last: number;
  readonly spent: number;
  /** Completed observed days, oldest first, at most {@link HISTORY_DAYS}. */
  readonly history: readonly (readonly [string, number])[];
}

const STORAGE = 'ccd-balance-ledger';
const HISTORY_DAYS = 7;

export const toCents = (amount: string) => Math.round(Number(amount) * 100);

/** Fold one successful read into the ledger. */
export function recordBalance(ledger: BalanceLedger | null, total: number, now: number): BalanceLedger {
  const day = localDayKey(now);
  if (!ledger) return { day, last: total, spent: 0, history: [] };
  if (ledger.day !== day) {
    const history = [...ledger.history, [ledger.day, ledger.spent] as const].slice(-HISTORY_DAYS);
    return { day, last: total, spent: 0, history };
  }
  const drop = ledger.last - total;
  return { ...ledger, last: total, spent: ledger.spent + Math.max(0, drop) };
}

/** Average daily spend: recent full days, or today alone before any exist. */
export function dailyRate(ledger: BalanceLedger): { cents: number; days: number } {
  if (!ledger.history.length) return { cents: ledger.spent, days: 0 };
  const sum = ledger.history.reduce((total, [, spent]) => total + spent, 0);
  return { cents: sum / ledger.history.length, days: ledger.history.length };
}

/** Whole days the balance lasts at the given rate, or null with no spend. */
export function remainingDays(total: number, rate: number): number | null {
  if (!(rate > 0)) return null;
  return Math.max(0, Math.floor(total / rate));
}

function valid(value: unknown): value is BalanceLedger {
  if (!value || typeof value !== 'object') return false;
  const { day, last, spent, history } = value as Record<string, unknown>;
  return typeof day === 'string' && Number.isFinite(last) && Number.isFinite(spent) && Array.isArray(history)
    && history.every(entry => Array.isArray(entry) && typeof entry[0] === 'string' && Number.isFinite(entry[1]));
}

export function loadLedger(storage: Storage | undefined): BalanceLedger | null {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE) ?? 'null');
    return valid(value) ? value : null;
  } catch { return null; }
}

export function saveLedger(storage: Storage | undefined, ledger: BalanceLedger): void {
  try { storage?.setItem(STORAGE, JSON.stringify(ledger)); } catch { /* Keep the in-memory ledger. */ }
}
