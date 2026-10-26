import { pricingCountdown, pricingPeriod } from '../../shared/pricing-period.ts';
import type { Disposer } from '../contracts/ports.ts';

export interface AccountBalanceBreakdown {
  total: string;
  toppedUp: string;
  granted: string;
}

/** A successful read plus what this machine has observed of daily spend. */
export interface AccountBalanceView {
  balance: AccountBalanceBreakdown;
  /** Spend observed today, yuan with two decimals. */
  today: string;
  /** Average daily spend, or null before any spend was observed. */
  rate: string | null;
  /** Full days the rate averages; 0 means it is today's spend alone. */
  rateDays: number;
  /** Whole days left at {@link rate}. */
  days: number | null;
}

export interface PeriodLabel {
  peak: boolean;
  label: string;
  /** Wall-clock switch time, prefixed with a day when it is not today. */
  until: string | null;
  countdown: string | null;
  next: string;
}

/** Peak/off-peak wording for the balance card, or null outside the known calendar. */
export function periodLabel(now: number, zh: boolean): PeriodLabel | null {
  const period = pricingPeriod(now);
  if (!period) return null;
  let until: string | null = null;
  if (period.next) {
    const at = new Date(period.next), today = new Date(now);
    const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const gap = Math.round((start(at) - start(today)) / 86_400_000);
    const day = gap === 0 ? '' : gap === 1 ? (zh ? '明天 ' : 'tmrw ')
      : `${(zh ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])[at.getDay()]} `;
    until = `${day}${clock}`;
  }
  return {
    peak: period.peak,
    label: zh ? period.peak ? '峰时' : '谷时' : period.peak ? 'Peak' : 'Off-peak',
    until,
    countdown: period.next ? pricingCountdown(period.next - now, zh) : null,
    next: zh ? period.peak ? '谷时' : '峰时' : period.peak ? 'off-peak' : 'peak',
  };
}

/** The model picker's trend glyph: rising at peak, falling off-peak. */
export function periodGlyph(document: Document, peak: boolean): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 12');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `<g${peak ? ' transform="translate(0 12) scale(1 -1)"' : ''} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 2.5 5.5 6.5 9 3.5 14.5 9.5 M10.5 9.5H14.5V5.5"/></g>`;
  return svg;
}

/** The balance row owns this top-layer hint, including its delayed teardown. */
export function mountAccountBalanceHint(menu: HTMLElement, row: HTMLElement, zh: boolean): {
  update: (view: AccountBalanceView | undefined, message: string, now: number) => void;
  dispose: Disposer;
} {
  const document = menu.ownerDocument;
  const view = document.defaultView;
  if (!view) return { update: () => {}, dispose: () => {} };
  const panel = document.createElement('div');
  panel.setAttribute('data-ccd-balance-hint', '');
  panel.setAttribute('role', 'tooltip');
  panel.id = `ccd-account-balance-hint-${Math.random().toString(36).slice(2, 8)}`;
  panel.popover = 'manual';
  panel.hidden = true;
  const heading = document.createElement('div');
  heading.className = 'ccd-balance-heading';
  const title = document.createElement('span');
  title.textContent = zh ? 'DeepSeek 官方 API' : 'DeepSeek API';
  const currency = document.createElement('span');
  currency.textContent = zh ? '人民币' : 'CNY';
  heading.append(title, currency);
  const summary = document.createElement('p');
  summary.className = 'ccd-balance-summary';
  const list = (labels: string[]) => {
    const rates = document.createElement('dl');
    rates.className = 'ccd-balance-rates';
    const values = labels.map(label => {
      const term = document.createElement('dt');
      term.textContent = label;
      const value = document.createElement('dd');
      rates.append(term, value);
      return [term, value] as const;
    });
    return { rates, values };
  };
  const usage = list([zh ? '今日消耗' : 'Spent today', '', zh ? '预计可用' : 'Lasts about']);
  const funds = list([zh ? '充值余额' : 'Top-up balance', zh ? '赠金余额' : 'Granted balance']);
  funds.rates.classList.add('ccd-balance-funds');
  const period = document.createElement('div');
  period.className = 'ccd-balance-period-row';
  const note = document.createElement('p');
  note.className = 'ccd-balance-note';
  note.textContent = zh ? '消耗由本机记录的余额变动推算。' : 'Spend is inferred from balance changes seen on this device.';
  panel.append(heading, summary, usage.rates, funds.rates, period, note);
  menu.append(panel);
  let opened = false;
  let disposed = false;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const place = () => {
    const a = row.getBoundingClientRect(), p = panel.getBoundingClientRect();
    const right = a.right + 8;
    const left = right + p.width <= view.innerWidth - 12 ? right : a.left - p.width - 8;
    panel.style.left = `${Math.max(12, Math.min(left, view.innerWidth - p.width - 12))}px`;
    // Rows near the bottom grow the hint upwards from their lower edge.
    const top = a.top + p.height <= view.innerHeight - 12 ? a.top : a.bottom - p.height;
    panel.style.top = `${Math.max(12, Math.min(top, view.innerHeight - p.height - 12))}px`;
  };
  const cancel = () => { clearTimeout(pending); pending = undefined; };
  const close = () => {
    cancel();
    if (!opened) return;
    opened = false;
    panel.hidePopover();
    panel.hidden = true;
    row.removeAttribute('aria-describedby');
  };
  const reveal = () => {
    cancel();
    pending = setTimeout(() => {
      if (disposed || opened) return;
      opened = true;
      panel.hidden = false;
      panel.showPopover();
      row.setAttribute('aria-describedby', panel.id);
      place();
    }, 500);
  };
  const leave = () => { cancel(); pending = setTimeout(close, 120); };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && opened) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
  };
  row.addEventListener('pointerenter', reveal);
  row.addEventListener('pointerleave', leave);
  row.addEventListener('focus', reveal);
  row.addEventListener('blur', leave);
  panel.addEventListener('pointerenter', cancel);
  panel.addEventListener('pointerleave', leave);
  view.addEventListener('keydown', onKey, true);
  view.addEventListener('resize', close);
  document.addEventListener('scroll', close, true);
  return {
    update(state, message, now) {
      const balance = state?.balance;
      summary.textContent = balance ? `${zh ? '总余额' : 'Total balance'} ¥${balance.total}` : message;
      usage.rates.hidden = funds.rates.hidden = !balance;
      if (state) {
        const [today, rate, days] = usage.values as [typeof usage.values[0], typeof usage.values[0], typeof usage.values[0]];
        today[1].textContent = `¥${state.today}`;
        rate[0].textContent = state.rateDays
          ? zh ? `近 ${state.rateDays} 天日均` : `${state.rateDays}-day average`
          : zh ? '日均（按今日）' : 'Daily (today)';
        rate[1].textContent = state.rate ? `¥${state.rate}` : '—';
        days[1].textContent = state.days === null ? '—' : zh ? `约 ${state.days} 天` : `${state.days} days`;
        funds.values[0]![1].textContent = `¥${state.balance.toppedUp}`;
        funds.values[1]![1].textContent = `¥${state.balance.granted}`;
      }
      const label = periodLabel(now, zh);
      period.hidden = !label;
      period.replaceChildren();
      if (label) {
        const mark = document.createElement('span');
        mark.className = 'ccd-balance-period';
        mark.dataset['peak'] = String(label.peak);
        mark.append(periodGlyph(document, label.peak), label.label);
        const countdown = document.createElement('span');
        countdown.textContent = label.countdown
          ? zh ? `距${label.next}还有 ${label.countdown}` : `${label.countdown} until ${label.next}`
          : zh ? '下一年度节假日日历待更新' : 'Next year’s holiday calendar pending';
        period.append(mark, countdown);
      }
      if (opened) place();
    },
    dispose() {
      disposed = true;
      close();
      row.removeEventListener('pointerenter', reveal);
      row.removeEventListener('pointerleave', leave);
      row.removeEventListener('focus', reveal);
      row.removeEventListener('blur', leave);
      panel.removeEventListener('pointerenter', cancel);
      panel.removeEventListener('pointerleave', leave);
      view.removeEventListener('keydown', onKey, true);
      view.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
      panel.remove();
    },
  };
}
