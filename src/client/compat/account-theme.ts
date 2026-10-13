import type { Disposer, ThemePreference, ThemePreferencePort } from '../contracts/ports.ts';

/** A compact theme row sharing the settings page's native preference service. */
export function mountAccountTheme(menu: HTMLElement, theme: ThemePreferencePort | null): Disposer {
  const more = menu.querySelector('[data-ccd-account-more]');
  // The pinned account list ends with Sign in/out, immediately after More.
  const anchor = more?.parentElement?.nextElementSibling;
  if (theme === null || !anchor?.parentElement) return () => {};
  const document = menu.ownerDocument;
  const zh = (document.documentElement.lang || document.defaultView?.navigator.language || '').toLowerCase().startsWith('zh');
  const row = document.createElement('div');
  row.setAttribute('data-ccd-account-theme', '');
  const label = document.createElement('span');
  label.textContent = zh ? '主题' : 'Theme';
  const group = document.createElement('span');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label.textContent);
  row.append(label, group);

  const options: readonly { id: ThemePreference; label: string; artwork: string }[] = [
    { id: 'system', label: zh ? '跟随系统' : 'System', artwork: '<rect x="2.3" y="3.1" width="11.4" height="7.9" rx="1.5"/><path d="M8 11v1.4M6.3 12.9h3.4"/>' },
    { id: 'light', label: zh ? '浅色' : 'Light', artwork: '<circle cx="8" cy="8" r="3.2"/><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1"/>' },
    { id: 'dark', label: zh ? '深色' : 'Dark', artwork: '<path d="M13.9 8.5A6 6 0 1 1 7.5 2a4.7 4.7 0 0 0 6.4 6.5Z"/>' },
  ];
  const buttons = options.map(option => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-label', option.label);
    button.title = option.label;
    button.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${option.artwork}</svg>`;
    button.addEventListener('click', event => {
      event.stopPropagation();
      theme.set(option.id);
    });
    group.append(button);
    return button;
  });
  const sync = () => {
    const selected = theme.preference();
    buttons.forEach((button, index) => {
      const value = String(options[index]?.id === selected);
      if (button.getAttribute('aria-checked') !== value) button.setAttribute('aria-checked', value);
    });
  };
  // The host walks all menu buttons with Up/Down; Left/Right stay within this row.
  group.addEventListener('keydown', event => {
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      event.stopPropagation();
      const next = buttons[(index + step + buttons.length) % buttons.length];
      next?.focus();
      next?.click();
    } else if (event.key === 'Tab' && !event.shiftKey) {
      // Match the host's Tab-to-activate behavior, which only knows menuitem.
      event.preventDefault();
      event.stopPropagation();
      buttons[index]?.click();
    }
  });
  sync();
  const unsubscribe = theme.subscribe(sync);
  anchor.parentElement.insertBefore(row, anchor);
  return () => {
    unsubscribe();
    row.remove();
  };
}
