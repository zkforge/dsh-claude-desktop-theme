import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyRate, recordBalance, remainingDays, toCents } from '../src/client/compat/balance-ledger.ts';

const at = (time: string) => new Date(`2026-10-20T${time}`).getTime();
const next = (time: string) => new Date(`2026-10-21T${time}`).getTime();

test('drops count as spend, top-ups only move the baseline', () => {
  let ledger = recordBalance(null, toCents('100.00'), at('09:00'));
  assert.equal(ledger.spent, 0);
  ledger = recordBalance(ledger, toCents('98.80'), at('10:00'));
  ledger = recordBalance(ledger, toCents('148.80'), at('11:00'));
  ledger = recordBalance(ledger, toCents('148.00'), at('12:00'));
  assert.equal(ledger.spent, 200);
  assert.deepEqual(dailyRate(ledger), { cents: 200, days: 0 }, 'today alone before any full day');
  assert.equal(remainingDays(ledger.last, 200), 74);
});

test('a new local day archives the previous total and averages recent days', () => {
  let ledger = recordBalance(null, 10_000, at('09:00'));
  ledger = recordBalance(ledger, 9_700, at('20:00'));
  ledger = recordBalance(ledger, 9_600, next('08:00'));
  assert.equal(ledger.spent, 0, 'overnight change is not attributed to the new day');
  assert.deepEqual(ledger.history, [['2026-10-20', 300]]);
  ledger = recordBalance(ledger, 9_500, next('09:00'));
  assert.deepEqual(dailyRate(ledger), { cents: 300, days: 1 });
  assert.equal(remainingDays(9_500, 0), null);
});
