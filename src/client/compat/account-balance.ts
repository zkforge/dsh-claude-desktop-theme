import { BALANCE_PATH } from '../../shared/balance.ts';
import type { Disposer } from '../contracts/ports.ts';
import { mountAccountBalanceHint, type AccountBalanceBreakdown } from './account-balance-hint.ts';

/** Last completed display, retained across menu openings for the same account. */
export interface AccountBalanceCache {
  text?: string;
  description?: string;
  balance?: AccountBalanceBreakdown;
}

/** One usage row in the lower-left account menu; polling lives only while open. */
export function mountAccountBalance(menu: HTMLElement, cache: AccountBalanceCache = {}): Disposer {
  const document = menu.ownerDocument;
  const anchor = menu.querySelector('button[role="menuitem"]');
  if (!anchor) return () => {};
  const zh = (document.documentElement.lang || document.defaultView?.navigator?.language || '').toLowerCase().startsWith('zh');
  const row = document.createElement('button');
  row.type = 'button';
  row.setAttribute('role', 'menuitem');
  row.setAttribute('data-ccd-account-balance', '');
  row.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20A10 10 0 0 1 15.8 3.75M21.8 11A10 10 0 0 1 19 20"/><circle cx="12" cy="13" r="2.2"/><path d="m13.56 11.44 5.19-5.19"/></svg>';
  const label = document.createElement('span');
  label.textContent = zh ? '余额' : 'Balance';
  const amount = document.createElement('span');
  amount.setAttribute('data-ccd-balance-amount', '');
  amount.setAttribute('aria-live', 'polite');
  amount.textContent = cache.text ?? '—';
  row.ariaDescription = cache.description ?? (zh ? 'DeepSeek 官方 API 余额（人民币）' : 'DeepSeek API balance (CNY)');
  row.append(label, amount);
  anchor.after(row);
  const hint = mountAccountBalanceHint(menu, row, zh);
  hint.update(cache.balance, cache.description ?? (zh ? '正在查询余额…' : 'Checking balance…'));
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
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
        cache.balance = { total: balance.total, toppedUp: balance.toppedUp, granted: balance.granted };
        amount.textContent = `¥${balance.total}`;
        row.ariaDescription = zh
          ? `DeepSeek 官方 API · 人民币\n总余额 ¥${balance.total}\n充值余额 ¥${balance.toppedUp}\n赠金余额 ¥${balance.granted}\n点击刷新`
          : `DeepSeek API · CNY\nTotal ¥${balance.total}\nTop-up ¥${balance.toppedUp}\nGranted ¥${balance.granted}\nClick to refresh`;
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
        hint.update(cache.balance, cache.description);
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
  };
  document.addEventListener('visibilitychange', visibility);
  void refresh();
  return () => {
    disposed = true;
    clearTimeout(timer);
    clearTimeout(deadline);
    controller?.abort();
    document.removeEventListener('visibilitychange', visibility);
    hint.dispose();
    row.remove();
  };
}
