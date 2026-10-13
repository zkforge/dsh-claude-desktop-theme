import type { Disposer } from '../contracts/ports.ts';

/** ui-settings-account's pinned Menu items are Settings, Contact, Sign in/out. */
export function mountAccountMore(menu: HTMLElement): Disposer {
  const document = menu.ownerDocument;
  const view = document.defaultView;
  const contact = menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')[1];
  if (!contact || !view) return () => {};
  // Keep React-owned cells in place; hide them while our More cells are shown.
  const original = [...contact.children];
  const zh = (document.documentElement.lang || view.navigator.language).toLowerCase().startsWith('zh');
  const title = zh ? '更多' : 'More';
  const feedbackLabel = contact.textContent?.trim() || (zh ? '意见反馈' : 'Feedback');
  const panel = document.createElement('div');
  panel.setAttribute('data-ccd-account-more-menu', '');
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', title);
  panel.id = 'ccd-account-more-menu';
  panel.popover = 'manual';
  panel.hidden = true;
  let open = false;
  let forwarding = false;
  let timer = 0;

  const icon = (paths: string) => {
    const span = document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    return span;
  };
  const moreIcon = icon('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>');
  const label = document.createElement('span');
  label.textContent = title;
  const chevron = icon('<path d="m9 6 6 6-6 6"/>');
  chevron.setAttribute('data-ccd-account-more-chevron', '');
  for (const cell of original) cell.setAttribute('data-ccd-account-more-original', '');
  contact.append(moreIcon, label, chevron);
  contact.setAttribute('data-ccd-account-more', '');
  contact.setAttribute('aria-haspopup', 'menu');
  contact.setAttribute('aria-controls', panel.id);
  contact.setAttribute('aria-expanded', 'false');

  const cancel = () => { view.clearTimeout(timer); };
  const close = () => {
    cancel();
    if (!open) return;
    open = false;
    if (panel.contains(document.activeElement) && contact.isConnected) contact.focus();
    panel.hidePopover();
    panel.hidden = true;
    contact.setAttribute('aria-expanded', 'false');
  };
  const place = () => {
    if (!open) return;
    const row = contact.getBoundingClientRect();
    const card = menu.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const right = card.right + 4;
    const left = right + width <= view.innerWidth - 8 ? right : card.left - width - 4;
    panel.style.left = `${Math.max(8, Math.min(left, view.innerWidth - width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(row.top, view.innerHeight - height - 8))}px`;
  };
  const show = (focus = false) => {
    cancel();
    if (!open) {
      open = true;
      panel.hidden = false;
      panel.showPopover();
      contact.setAttribute('aria-expanded', 'true');
    }
    place();
    if (focus) panel.querySelector<HTMLButtonElement>('button')?.focus();
  };
  const leave = () => { cancel(); timer = view.setTimeout(close, 180); };
  const feedback = document.createElement('button');
  feedback.type = 'button';
  feedback.setAttribute('role', 'menuitem');
  feedback.textContent = feedbackLabel;
  feedback.addEventListener('click', () => {
    close();
    forwarding = true;
    try { contact.click(); } finally { forwarding = false; }
  });
  panel.append(feedback);
  const separator = document.createElement('div');
  separator.setAttribute('role', 'separator');
  panel.append(separator);
  for (const [text, url] of [
    [zh ? 'DeepSeek 网页聊天' : 'DeepSeek Chat', 'https://chat.deepseek.com/'],
    ['API Platform', 'https://platform.deepseek.com/'],
    [zh ? '插件 GitHub · 求 Star ☆' : 'Plugin GitHub · Star us ☆', 'https://github.com/zkforge/dsh-claude-desktop-theme'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    const textNode = document.createElement('span');
    textNode.textContent = text ?? '';
    button.append(textNode, icon('<path d="M14 3h7v7M21 3l-10 10M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>'));
    button.addEventListener('click', () => {
      view.open(url, '_blank', 'noopener,noreferrer');
      close();
      contact.focus();
    });
    panel.append(button);
  }
  menu.append(panel);

  const onClick = (event: MouseEvent) => {
    if (forwarding) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    show(true);
  };
  const onEnter = () => show();
  const onFocus = (event: FocusEvent) => {
    if (event.target !== contact && !panel.contains(event.target as Node)) close();
  };
  const onOver = (event: MouseEvent) => {
    const row = (event.target as Element).closest('[role="menuitem"]');
    if (row && row !== contact && !panel.contains(row)) close();
  };
  // Window capture precedes the host's document Escape handler.
  const onKey = (event: KeyboardEvent) => {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const active = document.activeElement;
    const inside = panel.contains(active);
    if (active !== contact && !inside) return;
    if (active === contact && event.key === 'ArrowRight') {
      event.preventDefault(); event.stopImmediatePropagation(); show(true); return;
    }
    if (!open) return;
    if (event.key === 'Escape' || event.key === 'ArrowLeft' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault(); event.stopImmediatePropagation(); close(); contact.focus(); return;
    }
    if (!inside) return;
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button')];
    const index = buttons.indexOf(active as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % buttons.length
      : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length : null;
    if (next !== null) {
      event.preventDefault(); event.stopImmediatePropagation(); buttons[next]?.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault(); event.stopImmediatePropagation(); buttons[index]?.click();
    }
  };
  contact.addEventListener('click', onClick, true);
  contact.addEventListener('pointerenter', onEnter);
  contact.addEventListener('pointerleave', leave);
  panel.addEventListener('pointerenter', cancel);
  panel.addEventListener('pointerleave', leave);
  menu.addEventListener('focusin', onFocus);
  menu.addEventListener('mouseover', onOver);
  view.addEventListener('keydown', onKey, true);
  view.addEventListener('resize', place);
  view.addEventListener('scroll', place, true);
  const resize = new ResizeObserver(place);
  resize.observe(menu);
  return () => {
    close();
    cancel();
    resize.disconnect();
    view.removeEventListener('keydown', onKey, true);
    view.removeEventListener('resize', place);
    view.removeEventListener('scroll', place, true);
    menu.removeEventListener('focusin', onFocus);
    menu.removeEventListener('mouseover', onOver);
    contact.removeEventListener('click', onClick, true);
    contact.removeEventListener('pointerenter', onEnter);
    contact.removeEventListener('pointerleave', leave);
    panel.remove();
    moreIcon.remove();
    label.remove();
    chevron.remove();
    for (const cell of original) cell.removeAttribute('data-ccd-account-more-original');
    for (const name of ['data-ccd-account-more', 'aria-haspopup', 'aria-controls', 'aria-expanded']) contact.removeAttribute(name);
  };
}
