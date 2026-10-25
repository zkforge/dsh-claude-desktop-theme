import type { Disposer } from '../contracts/ports.ts';
import type { HeaderMenuActions } from './header-menu-actions.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsIntroduce, recordsTouch } from './mutation-scope.ts';

const CHEVRON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 6 4.5 4.5L12.5 6"/></svg>';
// Reference: rounded screen above a wider, shallow base with rounded ends.
const LAPTOP = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5v-6A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v6"/><rect x="1.5" y="10.5" width="13" height="2.5" rx=".65"/></svg>';

/** Static artwork for session menu actions. */
const HEADER_MENU_ICONS: Readonly<Record<string, string>> = {
  '打开方式': '<rect x="5" y="2" width="9" height="9" rx="1"/><path d="M11 11v3H2V5h3"/>',
  '重命名': '<path d="M3 10.5 2.5 14l3.5-.5L14 5.5 10.5 2 3 10.5ZM9 3.5l3.5 3.5"/>',
  '创建分支': '<circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="4" r="1.5"/><circle cx="5" cy="13" r="1.5"/><path d="M5 4.5v7M11 5.5V7a3 3 0 0 1-3 3H5"/>',
  '归档': '<rect x="1.5" y="2.5" width="13" height="3" rx=".75"/><path d="M2.5 5.5v8h11v-8M6 8h4"/>',
};

/** Add reference menus beside the native title without moving React-owned nodes. */
export function mountHeaderMenus(document: Document, actions: HeaderMenuActions, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const window = document.defaultView;
  if (window == null) return () => {};
  let disposed = false;
  let popup: HTMLElement | null = null;
  let anchor: HTMLElement | null = null;
  let owner: Seat | null = null;
  let submenu: HTMLElement | null = null;
  let subAnchor: HTMLButtonElement | null = null;
  let dialog: HTMLDialogElement | null = null;
  let editing: { seat: Seat; input: HTMLInputElement; finish: (restoreFocus?: boolean) => void } | null = null;
  const seats = new Map<HTMLElement, Seat>();
  let headers: HTMLElement[] = [];
  interface Seat { header: HTMLElement; nav: HTMLElement; icon: HTMLElement; trigger: HTMLButtonElement; id: string; releaseTitle: () => void }

  const button = (label: string) => {
    const node = document.createElement('button');
    node.type = 'button'; node.textContent = label;
    return node;
  };
  const clearSubmenu = () => {
    subAnchor?.setAttribute('aria-expanded', 'false');
    submenu?.remove(); submenu = null; subAnchor = null;
  };
  const close = (restoreFocus = false) => {
    const previous = anchor;
    clearSubmenu(); popup?.remove(); popup = null;
    previous?.setAttribute('aria-expanded', 'false');
    anchor = null; owner = null;
    if (restoreFocus && previous?.isConnected) previous.focus();
  };
  const position = () => {
    if (popup === null || anchor === null) return;
    if (!anchor.isConnected) { close(); return; }
    const rect = anchor.getBoundingClientRect();
    const width = popup.getBoundingClientRect().width;
    const height = popup.getBoundingClientRect().height;
    popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8))}px`;
    if (submenu !== null && subAnchor !== null) {
      const row = subAnchor.getBoundingClientRect();
      const menu = popup.getBoundingClientRect();
      const size = submenu.getBoundingClientRect();
      const right = menu.right + 1;
      submenu.style.left = `${Math.max(8, right + size.width <= window.innerWidth - 8 ? right : menu.left - size.width - 1)}px`;
      submenu.style.top = `${Math.max(8, Math.min(row.top - 5, window.innerHeight - size.height - 8))}px`;
    }
  };
  const surface = (kind: string) => {
    const node = document.createElement('div');
    node.setAttribute('data-ccd-header-menu', kind);
    node.setAttribute('role', 'menu'); node.setAttribute('aria-label', kind === 'session' ? '会话操作' : kind);
    node.setAttribute('popover', 'manual');
    document.body.append(node); node.showPopover();
    return node;
  };
  const notice = (text: string) => {
    close(); dialog?.remove();
    const node = document.createElement('dialog'); dialog = node;
    node.setAttribute('data-ccd-header-dialog', '');
    const copy = document.createElement('p'); copy.textContent = text;
    const done = button('确定'); done.addEventListener('click', () => node.close());
    node.append(copy, done); document.body.append(node);
    node.addEventListener('close', () => { node.remove(); if (dialog === node) dialog = null; });
    node.showModal();
  };
  const run = (action: () => void | Promise<void>) => {
    close();
    try { Promise.resolve(action()).catch(error => { report(error); if (!disposed) notice(`操作失败：${error instanceof Error ? error.message : String(error)}`); }); }
    catch (error) { report(error); notice(`操作失败：${error instanceof Error ? error.message : String(error)}`); }
  };
  const row = (menu: HTMLElement, label: string, act: () => void, mark = '', unavailable = '') => {
    const node = button(''); node.setAttribute('role', 'menuitem');
    const artwork = HEADER_MENU_ICONS[label];
    if (artwork !== undefined) {
        const icon = document.createElement('span');
        icon.setAttribute('data-ccd-header-row-icon', '');
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round">${artwork}</svg>`;
        node.append(icon);
    }
    const text = document.createElement('span'); text.setAttribute('data-ccd-header-row-label', ''); text.textContent = label; node.append(text);
    if (mark !== '') {
      const end = document.createElement('span'); end.setAttribute('data-ccd-menu-mark', '');
      if (mark === '›') end.innerHTML = CHEVRON;
      else end.textContent = mark;
      node.append(end);
      if (/^[A-Z]$/u.test(mark)) node.setAttribute('aria-keyshortcuts', mark);
    }
    if (unavailable !== '') { node.setAttribute('aria-disabled', 'true'); node.title = unavailable; }
    node.addEventListener('click', act); menu.append(node); return node;
  };
  const unavailable = (menu: HTMLElement, label: string, explanation: string, mark = '') => row(menu, label, () => notice(explanation), mark, explanation);
  const separator = (menu: HTMLElement) => { const line = document.createElement('hr'); line.setAttribute('role', 'separator'); menu.append(line); };
  const sub = (menu: HTMLElement, label: string, fill: (node: HTMLElement) => void) => {
    let node: HTMLButtonElement;
    const open = () => {
      if (subAnchor === node) return;
      clearSubmenu(); subAnchor = node; node.setAttribute('aria-expanded', 'true');
      submenu = surface(label); fill(submenu); position();
    };
    node = row(menu, label, open, '›'); node.setAttribute('aria-haspopup', 'menu'); node.setAttribute('aria-expanded', 'false');
    node.addEventListener('pointerenter', open);
    return node;
  };
  const rename = (seat: Seat, id: string) => {
    close(); editing?.finish();
    const original = actions.read(id)?.title ?? '';
    const input = document.createElement('input');
    input.setAttribute('data-ccd-session-rename', ''); input.setAttribute('aria-label', '重命名');
    input.value = original;
    // Keep React's title mounted; only the plugin's temporary input is removed.
    const width = seat.nav.getBoundingClientRect().width - seat.icon.getBoundingClientRect().width - seat.trigger.getBoundingClientRect().width - 12;
    input.style.width = `${Math.max(32, width)}px`;
    const finish = (restoreFocus = false) => {
      if (editing?.input !== input) return;
      const focused = document.activeElement === input;
      editing = null; input.remove(); seat.nav.removeAttribute('data-ccd-session-editing');
      if (restoreFocus && focused && seat.trigger.isConnected) seat.trigger.focus();
    };
    editing = { seat, input, finish };
    let saving = false;
    const save = async (restoreFocus: boolean) => {
      if (editing?.input !== input || saving || seat.id !== id) return;
      const title = input.value.trim();
      if (title === '' || title === original) { finish(restoreFocus); return; }
      saving = true; input.readOnly = true;
      try {
        await actions.rename(id, title);
        finish(restoreFocus);
      } catch (error) {
        report(error);
        if (disposed || editing?.input !== input || !input.isConnected) return;
        saving = false; input.readOnly = false;
        input.setCustomValidity(String(error)); input.focus(); input.reportValidity();
      }
    };
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); if (!saving) finish(true); }
      else if (event.key === 'Enter') { event.preventDefault(); void save(true); }
    });
    input.addEventListener('input', () => input.setCustomValidity(''));
    input.addEventListener('blur', () => { void save(false); });
    seat.nav.setAttribute('data-ccd-session-editing', ''); seat.nav.insertBefore(input, seat.trigger);
    input.focus(); input.select();
  };
  const show = (seat: Seat, trigger: HTMLButtonElement, keyboard = false) => {
    if (anchor === trigger) { close(true); return; }
    close(); anchor = trigger; owner = seat; trigger.setAttribute('aria-expanded', 'true');
    const id = seat.id;
    const menu = surface('session'); popup = menu;
    sub(menu, '打开方式', content => {
      const target = seat.header.querySelector<HTMLButtonElement>(host.openTargetMain);
      if (target !== null && !target.disabled) row(content, target.getAttribute('aria-label') ?? '默认应用', () => run(() => target.click()));
      else unavailable(content, '默认应用', 'DSH 当前没有可用的外部应用打开入口。');
    });
    separator(menu);
    row(menu, '重命名', () => rename(seat, id), 'R');
    row(menu, '创建分支', () => run(() => actions.fork(id)), 'F');
    separator(menu);
    row(menu, '归档', () => run(() => actions.archive(id)), 'A');
    // Hovering an ordinary row withdraws the previous submenu; moving into a
    // submenu keeps it open because both cards occupy the native top layer.
    for (const item of menu.querySelectorAll<HTMLButtonElement>('button:not([aria-haspopup])')) item.addEventListener('pointerenter', clearSubmenu);
    position(); if (keyboard) menu.querySelector<HTMLButtonElement>('button')?.focus();
  };
  const releaseSeat = (seat: Seat) => { if (editing?.seat === seat) editing.finish(); if (owner === seat) close(); seat.releaseTitle(); seat.icon.remove(); seat.trigger.remove(); seat.nav.removeAttribute('data-ccd-session-title'); };
  const sync = () => {
    for (const [header, seat] of seats) if (!header.isConnected || !seat.nav.isConnected) { releaseSeat(seat); seats.delete(header); }
    headers = [...document.querySelectorAll<HTMLElement>(host.conversationHeader)];
    for (const header of headers) {
      const root = header.closest(host.conversationRoot);
      const id = root?.querySelector<HTMLElement>('[data-conversation-session]')?.getAttribute('data-conversation-session');
      const data = id ? actions.read(id) : null;
      const nav = header.querySelector<HTMLElement>('nav');
      if (!id || data === null || nav === null) { const old = seats.get(header); if (old) { releaseSeat(old); seats.delete(header); } continue; }
      let seat = seats.get(header);
      if (seat === undefined) {
        const icon = document.createElement('span'); icon.setAttribute('data-ccd-session-icon', ''); icon.innerHTML = LAPTOP;
        const trigger = button(''); trigger.innerHTML = CHEVRON; trigger.setAttribute('data-ccd-session-trigger', ''); trigger.setAttribute('aria-label', '会话操作'); trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
        seat = { header, nav, icon, trigger, id, releaseTitle: () => {} }; const current = seat;
        const title = [...nav.querySelectorAll<HTMLElement>(host.conversationCrumb)].at(-1);
        if (title) {
          const attributes = ['role', 'tabindex', 'title'] as const;
          const original = attributes.map(name => title.getAttribute(name));
          title.setAttribute('role', 'button'); title.setAttribute('tabindex', '0'); title.setAttribute('title', '重命名会话');
          const activate = (event: Event) => {
            event.preventDefault(); event.stopPropagation();
            if (editing?.seat !== current) rename(current, current.id);
          };
          const key = (event: KeyboardEvent) => {
            if (event.key === 'Enter' || event.key === ' ') activate(event);
          };
          title.addEventListener('click', activate, true);
          title.addEventListener('keydown', key, true);
          current.releaseTitle = () => {
            title.removeEventListener('click', activate, true); title.removeEventListener('keydown', key, true);
            attributes.forEach((name, index) => { const value = original[index]; if (value == null) title.removeAttribute(name); else title.setAttribute(name, value); });
          };
        }
        trigger.addEventListener('click', event => show(current, trigger, event.detail === 0));
        nav.setAttribute('data-ccd-session-title', ''); nav.prepend(icon); nav.append(trigger); seats.set(header, seat);
      }
      if (seat.id !== id) { if (editing?.seat === seat) editing.finish(); if (owner === seat) close(); seat.id = id; }
      if (editing?.seat === seat && !editing.input.isConnected) editing.finish();
    }
  };
  const safelySync = () => { try { sync(); } catch (error) { report(error); } };
  const pointer = (event: PointerEvent) => {
    const target = event.target as Node;
    if (popup && !popup.contains(target) && !submenu?.contains(target) && !anchor?.contains(target)) close();
  };
  const keydown = (event: KeyboardEvent) => {
    if (popup === null || event.ctrlKey || event.metaKey || event.altKey) return;
    const active = document.activeElement as HTMLButtonElement;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (submenu) { const prior = subAnchor; clearSubmenu(); prior?.focus(); } else close(true); return; }
    if (event.key === 'Tab') { close(); return; }
    const menu = submenu?.contains(active) ? submenu : popup;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    const index = items.indexOf(active);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
    if (next >= 0) { event.preventDefault(); items[next]?.focus(); return; }
    if (event.key === 'ArrowRight' && active?.hasAttribute('aria-haspopup')) { event.preventDefault(); active.click(); submenu?.querySelector<HTMLButtonElement>('button')?.focus(); return; }
    if (event.key === 'ArrowLeft' && submenu) { event.preventDefault(); const prior = subAnchor; clearSubmenu(); prior?.focus(); return; }
    const shortcut = popup.querySelector<HTMLButtonElement>(`button[aria-keyshortcuts="${event.key.length === 1 && /^[a-z]$/iu.test(event.key) ? event.key.toUpperCase() : 'none'}"]`);
    if (shortcut) { event.preventDefault(); shortcut.click(); }
  };
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === 'attributes' && record.attributeName === 'data-conversation-session')
      || headers.some(header => recordsTouch(records, header))
      || recordsIntroduce(records, host.conversationHeader)) safelySync();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-conversation-session'] });
  const unsubscribe = actions.subscribe(safelySync);
  document.addEventListener('pointerdown', pointer, true); document.addEventListener('keydown', keydown, true);
  window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
  safelySync();
  return () => {
    disposed = true; observer.disconnect(); unsubscribe(); close(); dialog?.remove(); dialog = null;
    for (const seat of seats.values()) releaseSeat(seat); seats.clear();
    headers = [];
    document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('keydown', keydown, true);
    window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true);
  };
}
