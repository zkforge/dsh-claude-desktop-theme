import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import { officialPrice, pricingCountdown, pricingPeriod } from './pricing.ts';

// All visible labels share one minute clock. Hidden windows stop the timer.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
function refresh() {
  clearTimeout(timer);
  now = Date.now();
  listeners.forEach(listener => listener());
  if (!document.hidden && listeners.size) timer = setTimeout(refresh, 60_000 - now % 60_000);
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    refresh();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    }
  };
}
const snapshot = () => now;
const noopSubscribe = () => () => {};
function chinese() { return (document.documentElement.lang || globalThis.navigator?.language || '').toLowerCase().startsWith('zh'); }

/** Menu badges spell out the period; the Composer keeps its compact trend glyph. */
export function PriceMark({ provider, model, compact = false, badge = false }: { provider: string | undefined; model: string | undefined; compact?: boolean; badge?: boolean }) {
  const price = officialPrice(provider, model);
  const time = useSyncExternalStore(price ? subscribe : noopSubscribe, snapshot);
  const period = price && pricingPeriod(time);
  if (!period) return null;
  const label = chinese() ? period.peak ? '峰时' : '谷时' : period.peak ? 'Peak' : 'Off-peak';
  return <span className={`ccd-price-mark${badge ? ' ccd-price-badge' : compact ? ' ccd-price-trend' : ''}`} data-peak={period.peak} aria-label={label}>
    {badge ? <><svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" /><path d="M7 7h1v4h1" /><circle cx="8" cy="4.75" r=".75" fill="currentColor" stroke="none" />
    </svg>{label}</> : compact ? <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <g transform={period.peak ? 'translate(0 12) scale(1 -1)' : undefined}>
        <path d="M1.5 2.5 5.5 6.5 9 3.5 14.5 9.5 M10.5 9.5H14.5V5.5" />
      </g>
    </svg> : label}
  </span>;
}

/** Native top layer avoids clipping inside the model list and Composer. */
export function PricingHint({ provider, model, compact = false, enabled = true, ignoreFocus, children }: {
  provider: string | undefined; model: string | undefined; compact?: boolean; enabled?: boolean;
  ignoreFocus?: () => boolean;
  children: ReactElement<{ 'aria-describedby'?: string | undefined }>;
}) {
  const price = officialPrice(provider, model);
  const time = useSyncExternalStore(price ? subscribe : noopSubscribe, snapshot);
  const period = price && pricingPeriod(time);
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null), tooltip = useRef<HTMLDivElement>(null);
  const pending = useRef<ReturnType<typeof setTimeout>>();
  const pressed = useRef(false);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const show = enabled && visible && !!period;
  useEffect(() => () => clearTimeout(pending.current), []);
  useEffect(() => { if (!enabled) { clearTimeout(pending.current); setVisible(false); } }, [enabled]);
  useLayoutEffect(() => {
    const surface = tooltip.current, target = anchor.current;
    if (!show || !surface || !target) return;
    surface.setAttribute('popover', 'manual');
    surface.showPopover();
    const place = () => {
      const a = target.getBoundingClientRect(), p = surface.getBoundingClientRect();
      const beside = !compact && (a.right + p.width + 20 <= innerWidth || a.left >= p.width + 20);
      const preferredLeft = beside ? a.right + p.width + 20 <= innerWidth ? a.right + 8 : a.left - p.width - 8 : a.left;
      const left = Math.max(12, Math.min(preferredLeft, innerWidth - p.width - 12));
      const top = beside ? Math.min(a.top, innerHeight - p.height - 12)
        : a.top >= p.height + 20 ? a.top - p.height - 8 : Math.min(a.bottom + 8, innerHeight - p.height - 12);
      setPosition({ left, top: Math.max(12, top) });
    };
    place();
    const dismiss = () => setVisible(false);
    window.addEventListener('resize', dismiss);
    document.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('scroll', dismiss, true);
      if (surface.matches(':popover-open')) surface.hidePopover();
    };
  }, [show, compact]);
  const reveal = (delay: number) => {
    clearTimeout(pending.current);
    if (enabled) pending.current = setTimeout(() => setVisible(true), delay);
  };
  const hide = () => { clearTimeout(pending.current); pending.current = setTimeout(() => setVisible(false), 120); };
  const dismiss = () => { clearTimeout(pending.current); setVisible(false); };
  const zh = chinese();
  const label = zh ? period?.peak ? '峰时' : '谷时' : period?.peak ? 'Peak' : 'Off-peak';
  const nextLabel = zh ? period?.peak ? '谷时' : '峰时' : period?.peak ? 'off-peak' : 'peak';
  const multiplier = period?.peak ? 2 : 1;
  if (!price || !period) return children;
  return <div ref={anchor} className={`ccd-price-anchor${compact ? ' ccd-price-anchor-compact' : ' ccd-price-anchor-row'}`}
    onPointerEnter={() => { pressed.current = false; reveal(500); }} onPointerLeave={hide}
    onPointerDownCapture={() => { pressed.current = true; dismiss(); }}
    onFocusCapture={event => {
      if (!pressed.current && !ignoreFocus?.() && event.target.matches(':focus-visible')) reveal(500);
    }}
    onBlurCapture={() => { pressed.current = false; hide(); }}
    onClickCapture={dismiss}
    onKeyDownCapture={event => { if (event.key === 'Escape' && show) { event.preventDefault(); event.stopPropagation(); setVisible(false); } }}>
    {cloneElement(children, { 'aria-describedby': show ? id : undefined })}
    {show && <div ref={tooltip} id={id} role="tooltip" className="ccd-price-tooltip" style={position}>
      <div className="ccd-price-heading"><span>{zh ? 'DeepSeek 官方参考价' : 'DeepSeek official reference'}</span><span className="ccd-price-mark" data-peak={period.peak}>{label}</span></div>
      <p className="ccd-price-countdown">{period.next
        ? zh ? `距${nextLabel}还有 ${pricingCountdown(period.next - time, zh)}` : `${pricingCountdown(period.next - time, zh)} until ${nextLabel}`
        : zh ? '下一年度节假日日历待更新' : 'Next year’s holiday calendar pending'}</p>
      <div className="ccd-price-unit">{zh ? '元 / 百万 tokens' : 'CNY / million tokens'}</div>
      <dl className="ccd-price-rates">
        <dt>{zh ? '输入 · 缓存命中' : 'Input · cache hit'}</dt><dd>¥{price.hit * multiplier}</dd>
        <dt>{zh ? '输入 · 缓存未命中' : 'Input · cache miss'}</dt><dd>¥{price.input * multiplier}</dd>
        <dt>{zh ? '输出' : 'Output'}</dt><dd>¥{price.output * multiplier}</dd>
      </dl>
    </div>}
  </div>;
}
