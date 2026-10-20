export const BALANCE_PATH = '/api/ccd-deepseek-balance';

export interface CnyBalance {
  readonly total: string;
  readonly granted: string;
  readonly toppedUp: string;
}

/** Accept only the official CNY row; USD is never relabelled as RMB. */
export function readCnyBalance(value: unknown): CnyBalance | null {
  if (!value || typeof value !== 'object' || !('balance_infos' in value)
    || !Array.isArray(value.balance_infos)) return null;
  const row = value.balance_infos.find(row => row?.currency === 'CNY');
  const amount = (value: unknown): value is string => typeof value === 'string'
    && /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
  if (!row || !amount(row.total_balance) || !amount(row.granted_balance) || !amount(row.topped_up_balance)) return null;
  return { total: row.total_balance, granted: row.granted_balance, toppedUp: row.topped_up_balance };
}
