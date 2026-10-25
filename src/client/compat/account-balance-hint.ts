import type { Disposer } from '../contracts/ports.ts';

export interface AccountBalanceBreakdown {
  total: string;
  toppedUp: string;
  granted: string;
}

/** The account menu owns this top-layer hint, including its delayed teardown. */
export function mountAccountBalanceHint(menu: HTMLElement, row: HTMLElement, zh: boolean): {
  update: (balance: AccountBalanceBreakdown | undefined, message: string) => void;
  dispose: Disposer;
} {
  const document = menu.ownerDocument;
  const view = document.defaultView;
  if (!view) return { update: () => {}, dispose: () => {} };
  const panel = document.createElement('div');
  panel.setAttribute('data-ccd-balance-hint', '');
  panel.setAttribute('role', 'tooltip');
  panel.id = 'ccd-account-balance-hint';
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
  const rates = document.createElement('dl');
  rates.className = 'ccd-balance-rates';
  const values = [zh ? '充值余额' : 'Top-up balance', zh ? '赠金余额' : 'Granted balance'].map(label => {
    const term = document.createElement('dt');
    term.textContent = label;
    const value = document.createElement('dd');
    rates.append(term, value);
    return value;
  });
  panel.append(heading, summary, rates);
  menu.append(panel);
  let opened = false;
  let disposed = false;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const place = () => {
    const a = row.getBoundingClientRect(), p = panel.getBoundingClientRect();
    const right = a.right + 8;
    const left = right + p.width <= view.innerWidth - 12 ? right : a.left - p.width - 8;
    panel.style.left = `${Math.max(12, Math.min(left, view.innerWidth - p.width - 12))}px`;
    panel.style.top = `${Math.max(12, Math.min(a.top, view.innerHeight - p.height - 12))}px`;
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
    update(balance, message) {
      summary.textContent = balance ? `${zh ? '总余额' : 'Total balance'} ¥${balance.total}` : message;
      rates.hidden = !balance;
      values[0]!.textContent = balance ? `¥${balance.toppedUp}` : '';
      values[1]!.textContent = balance ? `¥${balance.granted}` : '';
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
