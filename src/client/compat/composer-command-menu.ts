import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsInTranscript } from './mutation-scope.ts';

const MENU = '[data-trigger-menu]';
const COMMAND = '[role="option"][id^="dsh-slash-option-command-"]';
// Reference: a continuous paperclip, a square slash key, and a two-pin plug
// angled toward the upper right. Keep the geometry independent of host icons.
const GLYPHS = {
  file: '<path d="m20 10-8.5 8.5a5 5 0 0 1-7-7L13 3a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 6"/>',
  slash: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="m14.5 7.5-5 9"/>',
  plugin: '<g transform="rotate(45 12 12)"><path d="M9 3v5m6-5v5M6 8h12m-11 0v4a5 5 0 0 0 10 0V8m-5 9v4"/></g>',
};

/** Split the add launcher from the native command picker without replacing its
 * candidates, filtering, selection, or command dispatch. */
export function mountComposerCommandMenu(document: Document, report: (error: unknown) => void, openSlash?: (id: string) => void): Disposer {
  const host = hostSelectors(document);
  const view = document.defaultView;
  if (!view) return () => {};
  const drawn = new Map<HTMLElement, HTMLSpanElement>();
  const suppressed = new Set<Element>();
  let popup: HTMLDivElement | null = null;
  let anchor: HTMLButtonElement | null = null;
  let previousExpanded: string | null = null;
  let previousControls: string | null = null;
  let previousPopup: string | null = null;
  let session: Element | null = null;
  let sessionId: string | null = null;
  let bypass = false;

  const restoreAttribute = (node: Element, name: string, value: string | null) => {
    if (value === null) node.removeAttribute(name);
    else node.setAttribute(name, value);
  };
  const close = (focus = false) => {
    popup?.remove();
    popup = null;
    if (anchor) {
      restoreAttribute(anchor, 'aria-expanded', previousExpanded);
      restoreAttribute(anchor, 'aria-controls', previousControls);
      restoreAttribute(anchor, 'aria-haspopup', previousPopup);
      if (focus && anchor.isConnected) anchor.focus();
    }
    anchor = null;
    session = null;
  };
  const nativeMenu = (button: HTMLButtonElement) => {
    bypass = true;
    try { button.click(); } finally { bypass = false; }
  };
  const pluginButton = () => document.querySelector<HTMLElement>('[data-ccd-nav="plugins"]')
    ?? [...document.querySelectorAll<HTMLElement>(`${host.sidebarRoot} button`)].find(button =>
      ['插件', 'Plugins', '自定义', 'Customize'].includes(button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''));

  const open = (button: HTMLButtonElement, keyboard: boolean) => {
    close();
    const card = button.closest(host.composerCard);
    const file = card?.querySelector<HTMLInputElement>('input[type="file"]');
    const plugin = pluginButton();
    const zh = document.documentElement.lang.toLowerCase().startsWith('zh');
    const entries: { label: string; glyph: keyof typeof GLYPHS; run(): void }[] = [];
    if (file && !file.disabled) entries.push({
      label: zh ? '添加文件或照片' : 'Add files or photos', glyph: 'file', run: () => file.click(),
    });
    entries.push({ label: zh ? '斜杠命令' : 'Slash commands', glyph: 'slash', run: () => {
      const id = card?.closest('[data-conversation-session]')?.getAttribute('data-conversation-session');
      if (id && openSlash) openSlash(id);
      else nativeMenu(button);
    } });
    if (plugin) entries.push({ label: zh ? '添加插件' : 'Add plugins', glyph: 'plugin', run: () => plugin.click() });

    anchor = button;
    previousExpanded = button.getAttribute('aria-expanded');
    previousControls = button.getAttribute('aria-controls');
    previousPopup = button.getAttribute('aria-haspopup');
    session = button.closest('[data-conversation-session]');
    sessionId = session?.getAttribute('data-conversation-session') ?? null;
    popup = document.createElement('div');
    popup.id = 'ccd-composer-add-menu';
    popup.setAttribute('data-ccd-add-menu', '');
    popup.setAttribute('data-menu-material', '');
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', zh ? '添加' : 'Add');
    popup.setAttribute('popover', 'manual');
    popup.tabIndex = -1;
    for (const entry of entries) {
      const row = document.createElement('button');
      row.type = 'button';
      row.setAttribute('role', 'menuitem');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      // Bundled icon paths only; labels are assigned as text.
      icon.innerHTML = GLYPHS[entry.glyph];
      const label = document.createElement('span');
      label.textContent = entry.label;
      row.append(icon, label);
      row.addEventListener('click', () => {
        close(true);
        try { entry.run(); } catch (error) { report(error); }
      });
      popup.append(row);
    }
    document.body.append(popup);
    popup.showPopover();
    const rect = button.getBoundingClientRect();
    const bounds = popup.getBoundingClientRect();
    const top = rect.top - bounds.height - 6;
    popup.style.left = `${Math.max(12, Math.min(rect.left, view.innerWidth - bounds.width - 12))}px`;
    popup.style.top = `${Math.max(12, top >= 12 ? top : Math.min(rect.bottom + 6, view.innerHeight - bounds.height - 12))}px`;
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', popup.id);
    button.setAttribute('aria-haspopup', 'menu');
    if (keyboard) popup.querySelector<HTMLButtonElement>('button')?.focus();
    else popup.focus();
  };

  const click = (event: MouseEvent) => {
    if (bypass) return;
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(host.composerAdd);
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (anchor === button) { close(true); return; }
    // A previously launched native command menu closes through its own toggle.
    if (button.getAttribute('aria-expanded') === 'true') nativeMenu(button);
    else if (button.closest(host.composerCard)?.querySelector(MENU)) {
      button.closest(host.composerCard)?.querySelector<HTMLElement>('[contenteditable="true"], textarea')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }
    try { open(button, event.detail === 0); } catch (error) { close(); report(error); }
  };
  const pointer = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (popup && target && !popup.contains(target) && !anchor?.contains(target)) close();
  };
  const key = (event: KeyboardEvent) => {
    if (!popup || event.isComposing) return;
    const rows = [...popup.querySelectorAll<HTMLButtonElement>('button')];
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape' || event.key === 'Tab') {
      close(true);
      if (event.key === 'Tab') return;
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
        : current < 0 ? event.key === 'ArrowDown' ? 0 : rows.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      rows[index]?.focus();
    } else return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const sync = () => {
    if (anchor && (!anchor.isConnected || anchor.disabled
      || (session && session.getAttribute('data-conversation-session') !== sessionId))) close();
    for (const tip of suppressed) if (!tip.isConnected) suppressed.delete(tip);
    // Host tooltips need not carry data-portal, even when rendered outside the composer.
    for (const tip of document.querySelectorAll('[role="tooltip"]')) {
      if (!['添加文件或调用指令', 'Add files or run commands'].includes(tip.textContent?.trim() ?? '')) continue;
      if (!tip.hasAttribute('data-ccd-add-tooltip')) tip.setAttribute('data-ccd-add-tooltip', '');
      suppressed.add(tip);
    }
    for (const [row, label] of drawn) if (!row.isConnected) { label.remove(); drawn.delete(row); }
    for (const menu of document.querySelectorAll<HTMLElement>(MENU)) {
      for (const row of menu.querySelectorAll<HTMLElement>(COMMAND)) {
        const token = row.querySelector('[class$="_itemAlias"]')?.textContent?.trim()
          ?? row.querySelector('[class$="_itemName"]')?.textContent?.trim().toLowerCase();
        if (!token) continue;
        let label = drawn.get(row);
        if (!label) {
          label = document.createElement('span');
          label.setAttribute('data-ccd-command-token', '');
          drawn.set(row, label);
        }
        if (!row.contains(label)) row.append(label);
        if (label.textContent !== token) label.textContent = token;
      }
    }
  };
  const observer = new MutationObserver(records => {
    if (recordsInTranscript(records)) return;
    try { sync(); } catch (error) { report(error); }
  });
  observer.observe(document.body, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['disabled', 'data-conversation-session'],
  });
  const language = new MutationObserver(() => close());
  language.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  const resize = () => close();
  document.addEventListener('click', click, true);
  document.addEventListener('pointerdown', pointer, true);
  document.addEventListener('keydown', key, true);
  view.addEventListener('resize', resize);
  sync();
  return () => {
    observer.disconnect();
    language.disconnect();
    document.removeEventListener('click', click, true);
    document.removeEventListener('pointerdown', pointer, true);
    document.removeEventListener('keydown', key, true);
    view.removeEventListener('resize', resize);
    close();
    for (const label of drawn.values()) label.remove();
    for (const tip of suppressed) tip.removeAttribute('data-ccd-add-tooltip');
    drawn.clear();
  };
}
