import assert from 'node:assert/strict';
import { test } from 'node:test';
import { officialPrice, pricingCountdown, pricingPeriod } from '../src/client/features/model-controls/pricing.ts';

const at = (date: string) => Date.parse(`${date}+08:00`);
test('peak windows include the opening instant and exclude the closing instant', () => {
  for (const [clock, peak, next] of [
    ['08:59:59', false, '09:00:00'], ['09:00:00', true, '12:00:00'],
    ['11:59:59', true, '12:00:00'], ['12:00:00', false, '14:00:00'],
    ['14:00:00', true, '18:00:00'], ['18:00:00', false, '09:00:00'],
  ] as const) {
    const day = clock === '18:00:00' ? '2026-10-21' : '2026-10-20';
    assert.deepEqual(pricingPeriod(at(`2026-10-20T${clock}`)), { peak, next: at(`${day}T${next}`) });
  }
});
test('weekends and public holiday breaks are skipped when finding the next peak', () => {
  assert.deepEqual(pricingPeriod(at('2026-10-23T18:00:00')), { peak: false, next: at('2026-10-26T09:00:00') });
  assert.deepEqual(pricingPeriod(at('2026-09-30T18:00:00')), { peak: false, next: at('2026-10-08T09:00:00') });
  assert.deepEqual(pricingPeriod(at('2026-02-13T18:00:00')), { peak: false, next: at('2026-02-24T09:00:00') });
  assert.equal(pricingPeriod(at('2026-10-10T10:00:00'))?.peak, false, 'Saturday makeup workday is still off-peak');
});
test('unknown holiday years do not produce a made-up period or countdown', () => {
  assert.equal(pricingPeriod(at('2027-01-04T10:00:00')), null);
  assert.deepEqual(pricingPeriod(at('2026-12-31T18:00:00')), { peak: false, next: null });
  assert.equal(pricingPeriod(Number.NaN), null);
});
test('official references only match exact built-in routes and supported aliases', () => {
  assert.deepEqual(officialPrice('deepseek', 'deepseek-flash'), { hit: .02, input: 1, output: 4 });
  assert.deepEqual(officialPrice('deepseek', 'deepseek-v4-pro'), { hit: .15, input: 4.5, output: 13.5 });
  assert.deepEqual(officialPrice('deepseek-account', 'deepseek-flash'), officialPrice('deepseek', 'deepseek-flash'));
  assert.deepEqual(officialPrice('deepseek-account', 'deepseek-v4-pro'), officialPrice('deepseek', 'deepseek-v4-pro'));
  assert.deepEqual(officialPrice('deepseek-official', 'deepseek-flash'), { hit: .02, input: 1, output: 4 });
  assert.deepEqual(officialPrice('deepseek-official', 'deepseek-v4-pro'), { hit: .15, input: 4.5, output: 13.5 });
  assert.deepEqual(officialPrice('deepseek', 'deepseek-v4-flash'), officialPrice('deepseek', 'deepseek-flash'));
  assert.equal(officialPrice('openrouter', 'deepseek-flash'), null);
  assert.equal(officialPrice('custom-deepseek', 'deepseek-flash'), null);
  assert.equal(officialPrice('magpie', 'deepseek-flash'), null);
  assert.equal(officialPrice('deepseek', 'deepseek-chat'), null);
  assert.equal(officialPrice('deepseek', 'future-pro'), null);
});
test('countdowns round up to a minute without showing zero before a switch', () => {
  assert.equal(pricingCountdown(1, true), '1 分钟');
  assert.equal(pricingCountdown(3_600_000, true), '1 小时');
  assert.equal(pricingCountdown(8_280_000, true), '2 小时 18 分钟');
  assert.equal(pricingCountdown(8_280_000, false), '2h 18m');
});
