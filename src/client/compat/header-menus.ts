import type { Disposer } from '../contracts/ports.ts';
import type { HeaderMenuActions } from './header-menu-actions.ts';
import { hostSelectors } from './host-dom.ts';

const CHEVRON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 6 4.5 4.5L12.5 6"/></svg>';
const LAPTOP = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="8.5" rx="1"/><path d="M1 11h14v2H1z"/></svg>';

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
  const seats = new Map<HTMLElement, Seat>();
  interface Seat { header: HTMLElement; nav: HTMLElement; icon: HTMLElement; trigger: HTMLButtonElement; project: HTMLButtonElement; id: string }

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
    popup.style.top = `${Math.max(8, Math.min(rect.bottom + (anchor.hasAttribute('data-ccd-project-trigger') ? 5 : 6), window.innerHeight - height - 8))}px`;
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
    node.setAttribute('role', 'menu'); node.setAttribute('aria-label', kind === 'session' ? 'Session actions' : kind === 'project' ? 'Project actions' : kind);
    node.setAttribute('popover', 'manual');
    document.body.append(node); node.showPopover();
    return node;
  };
  const notice = (text: string) => {
    close(); dialog?.remove();
    const node = document.createElement('dialog'); dialog = node;
    node.setAttribute('data-ccd-header-dialog', '');
    const copy = document.createElement('p'); copy.textContent = text;
    const done = button('OK'); done.addEventListener('click', () => node.close());
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
    const text = document.createElement('span'); text.textContent = label; node.append(text);
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
    close(); dialog?.remove();
    const node = document.createElement('dialog'); dialog = node; node.setAttribute('data-ccd-header-dialog', '');
    const form = document.createElement('form');
    const label = document.createElement('label'); label.textContent = 'Rename';
    const input = document.createElement('input'); input.value = actions.read(id)?.title ?? ''; input.required = true; label.append(input);
    const cancel = button('Cancel'); cancel.addEventListener('click', () => node.close());
    const save = button('Save'); save.type = 'submit';
    form.append(label, cancel, save); node.append(form); document.body.append(node);
    form.addEventListener('submit', event => {
      event.preventDefault(); const title = input.value.trim(); if (title === '') return;
      save.disabled = true;
      actions.rename(id, title).then(() => { if (!disposed && node.isConnected) node.close(); }).catch(error => {
        report(error); save.disabled = false; input.setCustomValidity(String(error)); input.reportValidity();
      });
    });
    input.addEventListener('input', () => input.setCustomValidity(''));
    node.addEventListener('close', () => { node.remove(); if (dialog === node) dialog = null; if (seat.trigger.isConnected) seat.trigger.focus(); });
    node.showModal(); input.select();
  };
  const show = (seat: Seat, trigger: HTMLButtonElement, kind: 'session' | 'project', keyboard = false) => {
    if (anchor === trigger) { close(true); return; }
    close(); anchor = trigger; owner = seat; trigger.setAttribute('aria-expanded', 'true');
    const id = seat.id;
    const menu = surface(kind); popup = menu;
    if (kind === 'session') {
      sub(menu, 'Open in', content => {
        const target = seat.header.querySelector<HTMLButtonElement>(host.openTargetMain);
        if (target !== null && !target.disabled) row(content, target.getAttribute('aria-label') ?? 'Default application', () => run(() => target.click()));
        else unavailable(content, 'Default application', 'DSH 当前没有可用的外部应用打开入口。');
      });
      separator(menu);
      row(menu, 'Rename', () => rename(seat, id), 'R');
      row(menu, 'Fork', () => run(() => actions.fork(id)), 'F');
      separator(menu);
      sub(menu, 'Transcript view', content => {
        const tabs = seat.header.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        for (const tab of tabs) row(content, tab.getAttribute('aria-label') ?? tab.textContent ?? 'View', () => run(() => tab.click()), tab.getAttribute('aria-selected') === 'true' ? '✓' : '');
        if (tabs.length === 0) unavailable(content, 'Transcript view', 'DSH 当前没有可切换的转录视图。');
      });
      sub(menu, 'Output style', content => { unavailable(content, 'Output style', 'DSH 暂未提供 Claude 的 Output style 接口，此项仅还原菜单外观。'); });
      separator(menu);
      row(menu, 'Archive', () => run(() => actions.archive(id)), 'A');
      const deletion = unavailable(menu, 'Delete', 'DSH 暂未提供删除会话的公开接口；可使用 Archive 归档，此项仅还原外观。', 'D');
      deletion.setAttribute('data-ccd-menu-destructive', '');
    } else {
      unavailable(menu, 'Show in Finder', 'DSH 暂未提供在 Finder／资源管理器中显示目录的公开接口，此项仅还原外观。');
      unavailable(menu, 'Open repository on GitHub', 'DSH 暂未提供当前目录的 Git remote 或仓库地址，无法可靠打开对应 GitHub 仓库。');
      separator(menu);
      sub(menu, 'Copy', content => {
        const copy = (value: string) => run(() => window.navigator.clipboard.writeText(value));
        const current = actions.read(id);
        row(content, 'Folder path', () => copy(current?.path ?? ''));
        row(content, 'Folder name', () => copy(current?.folder ?? ''));
      });
      unavailable(menu, 'Change folder…', 'DSH 暂未提供修改现有会话工作目录的公开接口；请从目标工作区新建会话。');
      separator(menu);
      const terminal = seat.header.querySelector<HTMLButtonElement>('[data-ccd-header-view="terminal"]');
      if (terminal !== null) row(menu, 'Open in terminal', () => run(() => terminal.click()));
      else unavailable(menu, 'Open in terminal', '当前 DSH 构建没有可用的终端入口。');
    }
    // Hovering an ordinary row withdraws the previous submenu; moving into a
    // submenu keeps it open because both cards occupy the native top layer.
    for (const item of menu.querySelectorAll<HTMLButtonElement>('button:not([aria-haspopup])')) item.addEventListener('pointerenter', clearSubmenu);
    position(); if (keyboard) menu.querySelector<HTMLButtonElement>('button')?.focus();
  };
  const releaseSeat = (seat: Seat) => { if (owner === seat) close(); seat.icon.remove(); seat.trigger.remove(); seat.project.remove(); seat.nav.removeAttribute('data-ccd-session-title'); };
  const sync = () => {
    for (const [header, seat] of seats) if (!header.isConnected || !seat.nav.isConnected) { releaseSeat(seat); seats.delete(header); }
    for (const header of document.querySelectorAll<HTMLElement>(host.conversationHeader)) {
      const root = header.closest(host.conversationRoot);
      const id = root?.querySelector<HTMLElement>('[data-conversation-session]')?.getAttribute('data-conversation-session');
      const data = id ? actions.read(id) : null;
      const nav = header.querySelector<HTMLElement>('nav');
      if (!id || data === null || nav === null) { const old = seats.get(header); if (old) { releaseSeat(old); seats.delete(header); } continue; }
      let seat = seats.get(header);
      if (seat === undefined) {
        const icon = document.createElement('span'); icon.setAttribute('data-ccd-session-icon', ''); icon.innerHTML = LAPTOP;
        const trigger = button(''); trigger.innerHTML = CHEVRON; trigger.setAttribute('data-ccd-session-trigger', ''); trigger.setAttribute('aria-label', 'Session actions'); trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
        const project = button(''); project.setAttribute('data-ccd-project-trigger', ''); project.setAttribute('aria-haspopup', 'menu'); project.setAttribute('aria-expanded', 'false');
        seat = { header, nav, icon, trigger, project, id }; const current = seat;
        trigger.addEventListener('click', event => show(current, trigger, 'session', event.detail === 0));
        project.addEventListener('click', event => show(current, project, 'project', event.detail === 0));
        nav.setAttribute('data-ccd-session-title', ''); nav.prepend(icon); nav.append(trigger); nav.after(project); seats.set(header, seat);
      }
      if (seat.id !== id) { if (owner === seat) close(); seat.id = id; }
      if (seat.project.textContent !== data.folder) seat.project.textContent = data.folder;
      if (seat.project.title !== data.path) seat.project.title = data.path;
      seat.project.hidden = data.path === '';
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
  const observer = new MutationObserver(safelySync);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-conversation-session'] });
  const unsubscribe = actions.subscribe(safelySync);
  document.addEventListener('pointerdown', pointer, true); document.addEventListener('keydown', keydown, true);
  window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
  safelySync();
  return () => {
    disposed = true; observer.disconnect(); unsubscribe(); close(); dialog?.remove(); dialog = null;
    for (const seat of seats.values()) releaseSeat(seat); seats.clear();
    document.removeEventListener('pointerdown', pointer, true); document.removeEventListener('keydown', keydown, true);
    window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true);
  };
}
