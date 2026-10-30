/** Producer-owned user messages can be persisted between model turns. */
export const CLEAR_MARKER = 'ccd-clear:';
export const CLEAR_TEXT = '对话已清空。';

export interface ClearBoundary {
  readonly seq: number | null;
  readonly turn: number;
  readonly lastTurn: number;
}

/** Validate a cached projection or an incoming wire value. */
export function readClearBoundary(value: unknown): ClearBoundary {
  const raw = value as Partial<ClearBoundary> | null;
  if (raw === null || typeof raw !== 'object'
    || !(raw.seq === null || (Number.isSafeInteger(raw.seq) && raw.seq! >= 0))
    || !Number.isSafeInteger(raw.turn) || raw.turn! < 0
    || !Number.isSafeInteger(raw.lastTurn) || raw.lastTurn! < raw.turn!) {
    throw new Error('Invalid clear boundary');
  }
  return raw as ClearBoundary;
}
