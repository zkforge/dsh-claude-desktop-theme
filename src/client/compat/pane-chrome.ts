import { mountBrowserMenus, type BrowserPopupLayout } from './browser-menu.ts';
import { paneIcon, type PaneIcon } from './pane-icons.ts';
import { relativeFilePath } from './relative-file-path.ts';

export interface PaneChromeOptions {
  readonly kind: string;
  readonly title: string;
  readonly filesRoot: HTMLElement | null;
  readonly zoomed: boolean;
  readonly onZoom: () => void;
  readonly onNew: () => void;
  readonly onSelect: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly closeTabs: readonly string[];
  readonly terminals: readonly { id: string; title: string; selected: boolean }[];
  readonly files: readonly { id: string; title: string; selected: boolean }[];
  readonly panel: HTMLElement;
}
export interface PaneChrome {
  update(options: PaneChromeOptions): void;
  release(): void;
}

/** Claude's toolbar beside host controls. Page picking keeps its reference
 * silhouette and explains the host limitation; pane windows are omitted. */
export function mountPaneChrome(node: HTMLElement): PaneChrome | null {
  const document = node.ownerDocument;
  const grip = node.querySelector<HTMLElement>('[data-dockkit-float-grip]');
  const title = grip?.querySelector<HTMLElement>('[data-dockkit-float-title]');
  const close = grip?.querySelector<HTMLButtonElement>('[data-dockkit-float-close]');
  if (!grip || !title || !close) return null;
  let options: PaneChromeOptions;
  let signature = '';
  let menu: HTMLElement | null = null;
  let form: HTMLFormElement | null = null;
  let wait: HTMLElement | null = null;
  let menuAnchor: HTMLElement | null = null;
  let addressSlot: HTMLElement | null = null;
  const paths = new Map<HTMLElement, HTMLElement>();
  const headerFill = title.nextElementSibling instanceof HTMLElement ? title.nextElementSibling : null;
  headerFill?.setAttribute('data-ccd-browser-header-fill', '');
  const caption = document.createElement('span');
  caption.setAttribute('data-ccd-pane-caption', '');
  const controls = document.createElement('span');
  controls.setAttribute('data-ccd-pane-controls', '');
  const closeIcon = document.createElement('span');
  closeIcon.setAttribute('data-ccd-pane-close-icon', '');
  closeIcon.innerHTML = paneIcon('X');
  grip.querySelector('[data-ccd-pane-controls]')?.remove();
  grip.querySelector('[data-ccd-pane-caption]')?.remove();
  close.querySelector('[data-ccd-pane-close-icon]')?.remove();
  grip.insertBefore(caption, title);
  grip.insertBefore(controls, close);
  close.append(closeIcon);
  node.setAttribute('data-ccd-pane-chrome', '');

  const closeGroup = (event: MouseEvent) => {
    if (close.hasAttribute('data-ccd-close-tab') || !options) return;
    // Files owns both its tree and every retained preview. Closing the card
    // must remove the whole group, otherwise the previous file resurfaces.
    if (!options.filesRoot && (options.kind !== 'terminal' || options.terminals.length < 2)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const { closeTabs, onClose } = options;
    for (const id of closeTabs) onClose(id);
  };
  close.addEventListener('click', closeGroup, true);

  const dismiss = () => { menuAnchor?.setAttribute('aria-expanded', 'false'); menuAnchor = null; menu?.remove(); menu = null; };
  const popup = (anchor: HTMLElement, content: HTMLElement, layout: BrowserPopupLayout = { width: 200, align: 'end' }) => {
    dismiss();
    menu = content; menuAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    content.addEventListener('toggle', () => { if (!content.matches(':popover-open') && menu === content) anchor.setAttribute('aria-expanded', 'false'); });
    content.setAttribute('data-ccd-pane-menu', '');
    content.setAttribute('popover', 'auto');
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(layout.width, window.innerWidth - 16);
    content.style.setProperty('--ccd-menu-width', `${width}px`);
    content.style.setProperty('--ccd-menu-left', `${Math.max(8, Math.min(window.innerWidth - width - 8, layout.align === 'start' ? rect.left : rect.right - width))}px`);
    content.style.setProperty('--ccd-menu-top', `${rect.bottom + 6}px`);
    document.body.append(content);
    content.showPopover();
    const height = content.getBoundingClientRect().height;
    if (rect.bottom + 6 + height > window.innerHeight - 8) content.style.setProperty('--ccd-menu-top', `${Math.max(8, rect.top - height - 6)}px`);
  };
  const button = (parent: HTMLElement, label: string, attribute: string, icon: PaneIcon, action: (button: HTMLButtonElement) => void) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.setAttribute(attribute, '');
    element.setAttribute('aria-label', label);
    element.title = label;
    element.innerHTML = paneIcon(icon);
    element.addEventListener('pointerdown', event => event.stopPropagation());
    element.addEventListener('click', () => action(element));
    parent.append(element);
    return element;
  };
  const notice = (anchor: HTMLElement, text: string) => {
    const content = document.createElement('p');
    content.setAttribute('role', 'status');
    content.textContent = text;
    popup(anchor, content);
  };
  const openMenu = (anchor: HTMLElement) => {
    const content = document.createElement('div');
    content.setAttribute('role', 'menu');
    content.addEventListener('keydown', event => {
      const items = [...content.querySelectorAll<HTMLButtonElement>('button')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
    });
    const item = (label: string, action: () => void) => {
      const row = document.createElement('button');
      row.type = 'button'; row.setAttribute('role', 'menuitem'); row.textContent = label;
      row.addEventListener('click', () => { dismiss(); action(); }); content.append(row);
    };
    const files = options.filesRoot;
    if (files) {
      item(files.hasAttribute('data-ccd-files-tree') ? 'Show file tree' : 'Hide file tree', () => files.querySelector<HTMLButtonElement>('[data-ccd-files-toggle]')?.click());
      item('Refresh files', () => files.querySelector<HTMLButtonElement>('[data-files-reload]')?.click());
      const open = files.querySelector<HTMLButtonElement>('[data-slot="sidebar.right.tab.files.actions"] button');
      if (open) item(open.getAttribute('aria-label') ?? 'Open folder in app', () => open.click());
    }
    for (const file of options.files) item(`${file.selected ? '✓ ' : ''}${file.title}`, () => options.onSelect(file.id));
    item(options.zoomed ? 'Restore pane' : 'Expand pane', options.onZoom);
    const collapse = options.panel.querySelector<HTMLButtonElement>('[data-sidebar-right-toggle]');
    if (collapse) item('Hide sidebar', () => collapse.click());
    item('Close', () => close.click());
    popup(anchor, content);
    content.querySelector('button')?.focus();
  };
  const addressProperties = ['--ccd-address-left', '--ccd-address-top', '--ccd-address-width', '--ccd-address-height'];
  const clearAddress = (element: HTMLFormElement | null) => {
    if (!element) return;
    if (element.hasAttribute('popover') && element.matches(':popover-open')) element.hidePopover();
    element.removeAttribute('popover');
    element.removeAttribute('data-ccd-browser-toolbar');
    element.removeAttribute('data-ccd-browser-address-hidden');
    for (const property of addressProperties) element.style.removeProperty(property);
  };
  const syncAddress = () => {
    if (!form || !addressSlot) return;
    const rect = addressSlot.getBoundingClientRect();
    form.toggleAttribute('data-ccd-browser-address-hidden', rect.width <= 0 || rect.height <= 0);
    for (const [property, value] of [
      ['--ccd-address-left', rect.left], ['--ccd-address-top', rect.top],
      ['--ccd-address-width', rect.width], ['--ccd-address-height', rect.height],
    ] as const) {
      const text = `${value}px`;
      if (form.style.getPropertyValue(property) !== text) form.style.setProperty(property, text);
    }
  };
  const addressResize = typeof ResizeObserver === 'function' ? new ResizeObserver(syncAddress) : null;
  const address = () => {
    dismiss(); syncAddress();
    const input = form?.querySelector('input'); input?.focus(); input?.select();
  };
  const browserMenus = mountBrowserMenus(node, { popup, dismiss, notice });
  const nativeNavigation = (index: number) => form?.querySelectorAll<HTMLButtonElement>(':scope > button')[index] ?? null;
  const refreshNative = () => {
    if (options?.kind === 'text') {
      const cwd = options.filesRoot?.getAttribute('data-files-root')
        ?? options.panel.querySelector('[data-files-root]')?.getAttribute('data-files-root');
      const live = new Set(node.querySelectorAll<HTMLElement>('[data-textpreview-path]'));
      for (const [source, label] of paths) {
        if (!live.has(source)) { source.removeAttribute('data-ccd-preview-path-source'); label.remove(); paths.delete(source); }
      }
      for (const source of live) {
        let label = paths.get(source);
        if (!label) {
          label = document.createElement('span');
          label.setAttribute('data-ccd-preview-path', '');
          source.setAttribute('data-ccd-preview-path-source', '');
          paths.set(source, label);
        }
        const path = source.title;
        const value = cwd ? relativeFilePath(path, cwd) : path;
        if (label.textContent !== value) label.textContent = value;
        if (label.title !== value) label.title = value;
        if (label.previousElementSibling !== source) source.after(label);
      }
      const reload = controls.querySelector<HTMLButtonElement>('[data-ccd-preview-reload]');
      const original = node.querySelector<HTMLButtonElement>('[data-textpreview-tool="reload"]');
      if (reload && reload.disabled !== (original?.disabled ?? true)) reload.disabled = original?.disabled ?? true;
    }
    if (!options || options.kind !== 'browser') return;
    const next = node.querySelector<HTMLFormElement>('form:has(input)');
    if (next !== form) {
      clearAddress(form);
      form = next;
      if (form) {
        form.setAttribute('data-ccd-browser-toolbar', '');
        const input = form.querySelector('input');
        if (input && !input.placeholder) input.placeholder = 'Enter server address';
      }
    }
    syncAddress();
    for (const [attribute, index] of [['data-ccd-browser-back', 0], ['data-ccd-browser-forward', 1], ['data-ccd-browser-reload', 2]] as const) {
      const control = controls.querySelector<HTMLButtonElement>(`[${attribute}]`);
      const original = nativeNavigation(index);
      if (control && control.disabled !== (original?.disabled ?? true)) control.disabled = original?.disabled ?? true;
    }
    const area = node.querySelector<HTMLElement>('[aria-busy]');
    const loaded = area?.querySelector('iframe, webview') !== null;
    if (!area || loaded) { wait?.remove(); wait = null; return; }
    if (wait?.parentElement !== area) {
      wait?.remove();
      wait = document.createElement('div');
      wait.setAttribute('data-ccd-browser-wait', '');
      const mark = document.createElement('span');
      mark.setAttribute('data-ccd-browser-wait-mark', '');
      mark.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M12 17v4m-4 0h8" stroke="currentColor" stroke-width="1.4"/></svg>';
      const text = document.createElement('span'); text.textContent = 'Awaiting server…';
      wait.append(mark, text); area.append(wait);
    }
    wait.setAttribute('data-ccd-browser-wait', area.getAttribute('aria-busy') === 'true' ? 'loading' : 'idle');
  };
  const observer = new MutationObserver(refreshNative);
  observer.observe(node, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'aria-busy', 'title'] });

  const terminalText = (element: HTMLElement, text: string) => {
    const match = /^(Terminal(?: \d+)?)(?: (.*))?$/u.exec(text);
    element.textContent = match?.[1] ?? text;
    if (match?.[2]) { const workspace = document.createElement('span'); workspace.setAttribute('data-ccd-terminal-workspace', ''); workspace.textContent = ` ${match[2]}`; element.append(workspace); }
  };
  const update = (next: PaneChromeOptions) => {
    options = next;
    const hidden = next.filesRoot?.hasAttribute('data-ccd-files-tree') ?? false;
    const value = `${next.kind}|${next.title}|${next.zoomed}|${hidden}|${next.files.map(file => `${file.id}:${file.selected}`).join(',')}|${next.terminals.map(tab => `${tab.id}:${tab.title}:${tab.selected}`).join(',')}`;
    if (value === signature) { refreshNative(); return; }
    signature = value;
    dismiss(); addressResize?.disconnect(); addressSlot = null; caption.replaceChildren(); controls.replaceChildren();
    node.setAttribute('data-ccd-pane-kind', next.kind);
    if (next.kind === 'browser') {
      const globe = button(caption, '编辑地址', 'data-ccd-browser-address', 'Globe', address);
      globe.title = '编辑地址';
      globe.addEventListener('contextmenu', event => { event.preventDefault(); dismiss(); address(); });
      addressSlot = document.createElement('span');
      addressSlot.setAttribute('data-ccd-browser-address-slot', '');
      caption.append(addressSlot);
      addressResize?.observe(addressSlot);
      button(controls, 'Back', 'data-ccd-browser-back', 'CaretLeft', () => nativeNavigation(0)?.click());
      button(controls, 'Forward', 'data-ccd-browser-forward', 'CaretRight', () => nativeNavigation(1)?.click());
      const pick = button(controls, 'Select element — DSH does not support page picking', 'data-ccd-browser-pick', 'Cursor', anchor => notice(anchor, 'DSH 暂不支持选取浏览器页面元素。'));
      pick.setAttribute('aria-disabled', 'true');
      button(controls, 'Reload', 'data-ccd-browser-reload', 'ArrowClockwise', () => nativeNavigation(2)?.click());
    } else {
      if (next.filesRoot) {
        const toggle = button(caption, hidden ? 'Show file tree' : 'Hide file tree', 'data-ccd-files-switch', 'Files', () => next.filesRoot?.querySelector<HTMLButtonElement>('[data-ccd-files-toggle]')?.click());
        toggle.setAttribute('data-ccd-files-mark', '');
        toggle.setAttribute('aria-expanded', String(!hidden));
      }
      if (next.kind === 'terminal' && next.terminals.length > 1) {
        const tabs = document.createElement('span'); tabs.setAttribute('data-ccd-terminal-tabs', '');
        tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Terminals'); caption.append(tabs);
        for (const tab of next.terminals) {
          const cell = document.createElement('span'); cell.setAttribute('data-ccd-terminal-tab', '');
          if (tab.selected) cell.setAttribute('data-selected', '');
          const select = document.createElement('button'); select.type = 'button'; terminalText(select, tab.title);
          select.setAttribute('role', 'tab'); select.setAttribute('aria-selected', String(tab.selected));
          select.tabIndex = tab.selected ? 0 : -1;
          select.addEventListener('pointerdown', event => event.stopPropagation());
          select.addEventListener('click', () => next.onSelect(tab.id));
          select.addEventListener('keydown', event => {
            const index = next.terminals.indexOf(tab);
            const target = event.key === 'ArrowRight' ? (index + 1) % next.terminals.length : event.key === 'ArrowLeft' ? (index + next.terminals.length - 1) % next.terminals.length : event.key === 'Home' ? 0 : event.key === 'End' ? next.terminals.length - 1 : -1;
            if (target < 0) return;
            event.preventDefault(); next.onSelect(next.terminals[target]!.id);
            document.querySelector<HTMLButtonElement>(`[data-dockkit-content="${next.terminals[target]!.id}"] [role="tab"][aria-selected="true"]`)?.focus();
          });
          cell.append(select);
          const remove = button(cell, `Close ${tab.title}`, 'data-ccd-terminal-close', 'X', () => next.onClose(tab.id));
          remove.tabIndex = -1; tabs.append(cell);
        }
      } else {
        const name = document.createElement('span'); if (next.kind === 'terminal') terminalText(name, next.title); else name.textContent = next.title; caption.append(name);
      }
      if (next.kind === 'terminal') button(caption, 'New terminal', 'data-ccd-terminal-add', 'Add', next.onNew);
      else if (next.filesRoot || next.kind === 'text') button(controls, 'Search files', 'data-ccd-pane-search', 'Search', () => {
        const toggle = next.filesRoot?.querySelector<HTMLButtonElement>('[data-ccd-files-toggle]');
        if (hidden) toggle?.click();
        next.filesRoot?.querySelector<HTMLInputElement>('[data-ccd-files-filter] input')?.focus();
      });
      if (next.kind === 'text') button(controls, 'Reload', 'data-ccd-preview-reload', 'ArrowClockwise', () => node.querySelector<HTMLButtonElement>('[data-textpreview-tool="reload"]')?.click());
    }
    const more = button(controls, 'More', 'data-ccd-pane-more', 'DotsVertical', next.kind === 'browser' ? browserMenus.more : openMenu);
    more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-expanded', 'false');
    button(controls, next.zoomed ? 'Restore pane' : 'Expand pane', 'data-ccd-pane-zoom', next.zoomed ? 'Collapse' : 'Expand', next.onZoom);
    refreshNative();
  };
  return { update, release() {
    close.removeEventListener('click', closeGroup, true);
    observer.disconnect(); addressResize?.disconnect(); browserMenus.release(); dismiss(); wait?.remove(); caption.remove(); controls.remove(); closeIcon.remove();
    for (const attribute of ['data-ccd-pane-chrome', 'data-ccd-pane-kind']) node.removeAttribute(attribute);
    clearAddress(form);
    for (const [source, label] of paths) { source.removeAttribute('data-ccd-preview-path-source'); label.remove(); }
    paths.clear();
    headerFill?.removeAttribute('data-ccd-browser-header-fill');
  } };
}
