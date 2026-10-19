/** Official reference prices, CNY / million tokens; checked 2026-10-20.
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * The directory exposes route ids, not endpoints. Only the built-in DeepSeek
 * route is eligible; these are reference prices, never a billing estimate.
 */
export interface ModelPrice { readonly hit: number; readonly input: number; readonly output: number; }
const FLASH: ModelPrice = { hit: .02, input: 1, output: 4 };
const PRO: ModelPrice = { hit: .15, input: 4.5, output: 13.5 };
export function officialPrice(provider: string | undefined, model: string | undefined): ModelPrice | null {
  // Verified in the installed host: dsh-llm-deepseek-api-key registers
  // `deepseek-official`; account login registers `deepseek-account`.
  // Keep the legacy `deepseek` route; never match provider display names.
  if (provider !== 'deepseek-official' && provider !== 'deepseek-account' && provider !== 'deepseek') return null;
  switch (model) {
    case 'deepseek-flash':
    case 'deepseek-v4-flash':
    case 'deepseek-v4-flash-vision-exp': return FLASH;
    case 'deepseek-v4-pro': return PRO;
    default: return null;
  }
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 2026 State Council holiday breaks (Beijing dates); weekends stay off-peak
 * even on compensating workdays, per DeepSeek's explicit Mon–Fri rule.
 * https://www.gov.cn/zhengce/content/202511/content_7047090.htm
 * Do not extrapolate an unknown year's lunar/public holiday calendar.
 */
const HOLIDAYS = [
  ['01-01', '01-03'], ['02-15', '02-23'], ['04-04', '04-06'],
  ['05-01', '05-05'], ['06-19', '06-21'], ['09-25', '09-27'], ['10-01', '10-07'],
];
function peakAt(time: number): boolean | null {
  const date = new Date(time + 8 * HOUR);
  if (date.getUTCFullYear() !== 2026) return null;
  const day = date.toISOString().slice(5, 10);
  if ([0, 6].includes(date.getUTCDay()) || HOLIDAYS.some(([start, end]) => day >= start! && day <= end!)) return false;
  const hour = date.getUTCHours();
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}
export interface PricingPeriod { readonly peak: boolean; readonly next: number | null; }
/** Use absolute wall time, including after sleep; never decrement a counter. */
export function pricingPeriod(time: number): PricingPeriod | null {
  if (!Number.isFinite(time)) return null;
  const peak = peakAt(time);
  if (peak === null) return null;
  const midnight = Math.floor((time + 8 * HOUR) / DAY) * DAY - 8 * HOUR;
  for (let day = 0; day < 16; day += 1) {
    for (const hour of [9, 12, 14, 18]) {
      const next = midnight + day * DAY + hour * HOUR;
      if (next <= time) continue;
      const following = peakAt(next);
      if (following === null) return { peak, next: null };
      if (following !== peak) return { peak, next };
    }
  }
  return { peak, next: null };
}

export function pricingCountdown(remaining: number, zh: boolean): string {
  const minutes = Math.max(1, Math.ceil(remaining / 60_000));
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return zh ? `${hours ? `${hours} 小时` : ''}${rest ? `${hours ? ' ' : ''}${rest} 分钟` : ''}`
    : `${hours ? `${hours}h` : ''}${rest ? `${hours ? ' ' : ''}${rest}m` : ''}`;
}
