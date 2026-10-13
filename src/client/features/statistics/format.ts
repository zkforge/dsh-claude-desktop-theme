/**
 * Number and date formatting for the statistics card.
 *
 * The card uses Simplified Chinese dates and a 24-hour clock. Compact token
 * units stay unchanged so the metrics and chart labels fit the card.
 * They live in their own module because both the data layer (`view.ts`) and the
 * DOM layer (`card.ts`) need them, and neither should import the other.
 */

/** Match the Chinese card copy. */
const LOCALE = 'zh-CN';

const COUNT = new Intl.NumberFormat(LOCALE);
const HOUR = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/* The day key is a local calendar day, so it is read back in UTC: parsing
   `YYYY-MM-DD` yields UTC midnight and formatting it in the local zone could
   shift the label by a day. */
const DAY = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * One metric as the reference writes it: `1,556`.
 *
 * @param value - the raw count.
 * @returns the display string.
 */
export function formatCount(value: number): string {
  return COUNT.format(Math.round(value));
}

/**
 * Token totals, scaled the way the reference scales them.
 *
 * @param value - raw token total.
 * @returns `493.1M`, `12k`, or a plain count below a thousand.
 */
export function formatTokens(value: number): string {
  const total = Math.max(0, value);
  const units: readonly (readonly [number, string])[] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
  for (const [scale, suffix] of units) {
    if (total < scale) continue;
    const scaled = Math.round((total / scale) * 10) / 10;
    return `${String(scaled)}${suffix}`;
  }
  return formatCount(total);
}

/**
 * One hour of the day in the 24-hour clock (`11:00`).
 *
 * @param hour - local hour, 0-23.
 * @returns the label.
 */
export function formatHour(hour: number): string {
  return HOUR.format(new Date(2000, 0, 1, hour));
}

/**
 * One `YYYY-MM-DD` key as a Chinese chart date (`9月30日`).
 *
 * @param date - local day key.
 * @returns the short label.
 */
export function formatDayLabel(date: string): string {
  return DAY.format(new Date(`${date}T00:00:00Z`));
}
