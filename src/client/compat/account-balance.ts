import { BALANCE_PATH } from '../../shared/balance.ts';
import type { Disposer } from '../contracts/ports.ts';
import {
  mountAccountBalanceHint, periodGlyph, periodLabel, type AccountBalanceView,
} from './account-balance-hint.ts';
import { dailyRate, loadLedger, recordBalance, remainingDays, saveLedger, toCents } from './balance-ledger.ts';

/** Last completed display, retained across remounts for the same account. */
export interface AccountBalanceCache {
  text?: string;
  description?: string;
  balance?: AccountBalanceView;
}

const yuan = (cents: number) => (cents / 100).toFixed(2);

/** Balance reader shared by the expanded sidebar and collapsed account menu. */
export function mountAccountBalance(
  menu: HTMLElement, cache: AccountBalanceCache = {}, placement: 'menu' | 'sidebar' = 'menu',
): Disposer {
  const document = menu.ownerDocument;
  const sidebar = placement === 'sidebar';
  const anchor = sidebar ? null : menu.querySelector('button[role="menuitem"]');
  if (!sidebar && !anchor) return () => {};
  const zh = (document.documentElement.lang || document.defaultView?.navigator?.language || '').toLowerCase().startsWith('zh');
  const row = document.createElement('button');
  row.type = 'button';
  if (!sidebar) row.setAttribute('role', 'menuitem');
  else row.setAttribute('data-ccd-balance-card', '');
  row.setAttribute('data-ccd-account-balance', '');
  row.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20A10 10 0 0 1 15.8 3.75M21.8 11A10 10 0 0 1 19 20"/><circle cx="12" cy="13" r="2.2"/><path d="m13.56 11.44 5.19-5.19"/></svg>';
  const label = document.createElement('span');
  label.textContent = sidebar ? (zh ? 'API 余额' : 'API balance') : zh ? '余额' : 'Balance';
  const amount = document.createElement('span');
  amount.setAttribute('data-ccd-balance-amount', '');
  amount.setAttribute('aria-live', 'polite');
  amount.textContent = cache.text ?? '—';
  row.ariaDescription = cache.description ?? (zh ? 'DeepSeek 官方 API 余额（人民币），点击刷新' : 'DeepSeek API balance (CNY), click to refresh');
  row.append(label, amount);
  const details = document.createElement('span');
  details.setAttribute('data-ccd-balance-details', '');
  const storage = (() => { try { return document.defaultView?.localStorage; } catch { return undefined; } })();
  // The price period sits below the label; the balance breakdown and spend
  // stay in the hover hint.
  const updateDetails = () => {
    if (!sidebar) return;
    details.replaceChildren();
    const view = cache.balance;
    const label = periodLabel(Date.now(), zh);
    details.hidden = !label;
    if (label) {
      const mark = document.createElement('span');
      mark.className = 'ccd-balance-period';
      mark.dataset['peak'] = String(label.peak);
      mark.append(periodGlyph(document, label.peak), label.label);
      if (label.until) {
        const until = document.createElement('span');
        until.textContent = zh ? `至 ${label.until}` : `→ ${label.until}`;
        mark.append(until);
      }
      details.append(mark);
    }
    row.setAttribute('data-balance-state', view ? 'ready' : 'unavailable');
  };
  if (sidebar) {
    row.append(details);
    menu.append(row);
    updateDetails();
  } else anchor!.after(row);
  const hint = mountAccountBalanceHint(menu, row, zh);
  hint.update(cache.balance, cache.description ?? (zh ? '正在查询余额…' : 'Checking balance…'), Date.now());
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let clock: ReturnType<typeof setTimeout> | undefined;
  // Minute clock for the period badge and countdown; stops while hidden.
  const tick = () => {
    clearTimeout(clock);
    if (disposed || document.hidden) return;
    updateDetails();
    hint.update(cache.balance, cache.description ?? '', Date.now());
    clock = setTimeout(tick, 60_000 - Date.now() % 60_000);
  };
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const refresh = async () => {
    if (disposed || document.hidden || controller) return;
    clearTimeout(timer);
    const read = new AbortController();
    controller = read;
    // Use the same basic AbortController API as the existing statistics reader.
    // Some renderer module realms expose controllers without static signal APIs.
    deadline = setTimeout(() => read.abort(), 12_000);
    row.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(BALANCE_PATH, { signal: read.signal,
        credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      if (!response.ok) {
        if (response.status === 404) throw new Error(zh ? '余额接口未就绪，请重启 DSH' : 'Balance endpoint not ready; restart DSH');
        if (response.status === 401 || response.status === 403) throw new Error(zh ? '应用连接认证失败，请重载 DSH' : 'App authentication failed; reload DSH');
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json().catch(() => {
        throw new Error(zh ? '余额接口响应无效，请重启 DSH' : 'Invalid balance response; restart DSH');
      });
      if (disposed) return;
      const balance = data.balance;
      const validAmount = (value: unknown): value is string => typeof value === 'string'
        && /^-?\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
      if (data.state === 'ready' && balance && [balance.total, balance.granted, balance.toppedUp].every(validAmount)) {
        const total = toCents(balance.total);
        const ledger = recordBalance(loadLedger(storage), total, Date.now());
        saveLedger(storage, ledger);
        const rate = dailyRate(ledger);
        const view: AccountBalanceView = {
          balance: { total: balance.total, toppedUp: balance.toppedUp, granted: balance.granted },
          today: yuan(ledger.spent),
          rate: rate.cents > 0 ? yuan(rate.cents) : null,
          rateDays: rate.days,
          days: remainingDays(total, rate.cents),
        };
        cache.balance = view;
        amount.textContent = `¥${balance.total}`;
        const runway = view.days === null ? '' : zh ? `，约可用 ${view.days} 天` : `, about ${view.days} days left`;
        row.ariaDescription = zh
          ? `DeepSeek 官方 API · 人民币\n总余额 ¥${balance.total}\n今日消耗 ¥${view.today}${runway}\n充值余额 ¥${balance.toppedUp}\n赠金余额 ¥${balance.granted}\n点击刷新`
          : `DeepSeek API · CNY\nTotal ¥${balance.total}\nSpent today ¥${view.today}${runway}\nTop-up ¥${balance.toppedUp}\nGranted ¥${balance.granted}\nClick to refresh`;
      } else {
        delete cache.balance;
        const messages: Record<string, string> = {
          unconfigured: zh ? '未配置 API Key' : 'API key not configured',
          unauthorized: zh ? 'API Key 无效' : 'Invalid API key',
          'no-cny': zh ? '无人民币余额' : 'No CNY balance',
        };
        amount.textContent = messages[data.state] ?? (zh ? '查询失败' : 'Unavailable');
        row.ariaDescription = data.state === 'unconfigured'
          ? (zh ? '请在设置 → 模型中配置 DeepSeek 官方 API Key' : 'Configure the official DeepSeek API key in Settings → Models')
          : (zh ? 'DeepSeek 官方 API 余额 · 点击重试' : 'DeepSeek API balance · Click to retry');
      }
    } catch (error) {
      if (!disposed) {
        delete cache.balance;
        amount.textContent = zh ? '查询失败 · 重试' : 'Unavailable · Retry';
        const reason = read.signal.aborted ? (zh ? '查询超时' : 'Request timed out')
          : error instanceof Error ? error.message : (zh ? '连接失败' : 'Connection failed');
        row.ariaDescription = `${zh ? 'DeepSeek 官方 API 余额' : 'DeepSeek API balance'}\n${reason}\n${zh ? '点击重试' : 'Click to retry'}`;
      }
    } finally {
      clearTimeout(deadline);
      deadline = undefined;
      if (controller === read) controller = undefined;
      if (!disposed) {
        cache.text = amount.textContent ?? '';
        cache.description = row.ariaDescription ?? '';
        updateDetails();
        hint.update(cache.balance, cache.description, Date.now());
        row.removeAttribute('aria-busy');
        if (!document.hidden) timer = setTimeout(() => { void refresh(); }, 60_000);
      }
    }
  };
  row.addEventListener('click', event => { event.stopPropagation(); void refresh(); });
  const visibility = () => {
    clearTimeout(timer);
    if (document.hidden) controller?.abort();
    else void refresh();
    tick();
  };
  document.addEventListener('visibilitychange', visibility);
  void refresh();
  tick();
  return () => {
    disposed = true;
    clearTimeout(timer);
    clearTimeout(clock);
    clearTimeout(deadline);
    controller?.abort();
    document.removeEventListener('visibilitychange', visibility);
    hint.dispose();
    row.remove();
  };
}
