import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

export interface SidebarNavigationIcons {
  readonly newSession: string;
  readonly plugins: string;
  readonly routines: string;
}

type Kind = keyof SidebarNavigationIcons;
export const SIDEBAR_NAV_ATTRIBUTE = 'data-ccd-nav';

/** Native PanelRow exposes its identity only through its localized name.
 * Source: ui-sidebar/SidebarRoot.tsx, ui-plugin-manager and ui-schedule locales.
 * Unknown/third-party panels keep their own glyphs and labels. */
function panelKind(name: string): Kind | null {
  if (name === '插件' || name === 'Plugins') return 'plugins';
  if (name === '自动化任务' || name === 'Automation tasks' || name === '例程' || name === 'Routines') return 'routines';
  return null;
}

/** Rename and decorate the native buttons without replacing React-owned nodes
 * or handlers. Every write is conditional and reversible, including delayed
 * mounts, locale changes, wide/rail rerenders and the native tooltip portals. */
export function mountSidebarNavigation(
  document: Document, icons: SidebarNavigationIcons, report: (error: unknown) => void,
): Disposer {
  const added = new Set<HTMLElement>();
  const texts = new Map<Text, { original: string; drawn: string }>();
  const attributes = new Map<Element, Map<string, { original: string | null; drawn: string }>>();
  let root: HTMLElement | null = null;
  let observer: MutationObserver | undefined;
  let language: MutationObserver | undefined;

  const copy = () => (document.documentElement.lang || globalThis.navigator?.language || '').toLowerCase().startsWith('zh')
    ? { newSession: '新建会话', routines: '例程' }
    : { newSession: 'New session', routines: 'Routines' };

  const attribute = (element: Element, name: string, value: string) => {
    const current = element.getAttribute(name);
    if (current === value) return;
    let entries = attributes.get(element);
    if (!entries) { entries = new Map(); attributes.set(element, entries); }
    const previous = entries.get(name);
    const original = previous?.drawn === current ? previous.original : current;
    entries.set(name, { original, drawn: value });
    element.setAttribute(name, value);
  };

  const label = (element: Element | null, value: string) => {
    if (!element) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let found = walker.nextNode(); found !== null; found = walker.nextNode()) {
      const node = found as Text;
      if (!node.data.trim() || node.data.trim() === value) continue;
      const previous = texts.get(node);
      const original = previous?.drawn === node.data ? previous.original : node.data;
      const drawn = node.data.replace(node.data.trim(), value);
      texts.set(node, { original, drawn });
      node.data = drawn;
      break;
    }
  };

  const decorate = (button: HTMLElement, seat: Element | null, kind: Kind) => {
    if (!seat) return;
    attribute(button, SIDEBAR_NAV_ATTRIBUTE, kind);
    if (!seat.querySelector(':scope > [data-ccd-nav-glyph]')) {
      const glyph = document.createElement('span');
      glyph.className = 'ccd-nav-glyph';
      glyph.setAttribute('data-ccd-nav-glyph', '');
      glyph.setAttribute('aria-hidden', 'true');
      // Trusted, bundled SVG constants; no host/user HTML is interpolated.
      glyph.innerHTML = icons[kind];
      seat.prepend(glyph);
      added.add(glyph);
    }
  };

  const sync = () => {
    const host = hostSelectors(document);
    root = document.querySelector<HTMLElement>(host.sidebarRoot);
    const names = copy();
    const button = root?.querySelector<HTMLElement>(host.sidebarNewSession);
    if (button) {
      decorate(button, button.querySelector(host.sidebarNewSessionContent), 'newSession');
      label(button.querySelector(host.sidebarNewSessionLabel), names.newSession);
      attribute(button, 'aria-label', names.newSession);
    }
    for (const row of root?.querySelectorAll<HTMLElement>(host.sidebarPanelRow) ?? []) {
      const kind = panelKind(row.getAttribute('aria-label') ?? row.querySelector(host.sidebarPanelTitle)?.textContent?.trim() ?? '');
      if (!kind) continue;
      decorate(row, row.querySelector(host.sidebarPanelGlyph), kind);
      if (kind === 'routines') {
        label(row.querySelector(host.sidebarPanelTitle), names.routines);
        attribute(row, 'aria-label', names.routines);
      }
    }
    // Tooltip uses the host's original localized label, independent of aria-label.
    const tooltipOwner = root?.querySelector<HTMLElement>('[data-ccd-nav]:hover, [data-ccd-nav]:focus-visible');
    const tooltipKind = tooltipOwner?.getAttribute(SIDEBAR_NAV_ATTRIBUTE);
    for (const tooltip of tooltipOwner ? document.querySelectorAll('[role="tooltip"]') : []) {
      const name = tooltip.textContent?.trim();
      if (tooltipKind === 'routines' && (name === '自动化任务' || name === 'Automation tasks')) label(tooltip, names.routines);
      if (tooltipKind === 'newSession' && (name === '新会话' || name === '新建会话' || name === 'New session')) label(tooltip, names.newSession);
    }
    for (const node of added) if (!node.isConnected) added.delete(node);
    for (const node of texts.keys()) if (!node.isConnected) texts.delete(node);
    for (const node of attributes.keys()) if (!node.isConnected) attributes.delete(node);
  };

  const restore = () => {
    for (const node of added) node.remove();
    for (const [node, record] of texts) if (node.data === record.drawn) node.data = record.original;
    for (const [element, entries] of attributes) for (const [name, record] of entries) {
      if (element.getAttribute(name) !== record.drawn) continue;
      if (record.original === null) element.removeAttribute(name);
      else element.setAttribute(name, record.original);
    }
    added.clear(); texts.clear(); attributes.clear();
  };

  const safelySync = () => {
    try { sync(); } catch (error) { report(error); }
  };
  try {
    observer = new MutationObserver(records => {
      const host = hostSelectors(document);
      const current = document.querySelector(host.sidebarRoot);
      if (current !== root || records.some(record => root?.contains(record.target)
        || (record.target instanceof Element && (record.target.closest('[role="tooltip"]')
          || Array.from(record.addedNodes).some(node => node instanceof Element
            && (node.matches('[role="tooltip"]') || node.querySelector('[role="tooltip"]'))))))) safelySync();
    });
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label'],
    });
    language = new MutationObserver(safelySync);
    language.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    sync();
  } catch (error) {
    observer?.disconnect(); language?.disconnect(); restore(); report(error);
    return () => {};
  }
  return () => { observer?.disconnect(); language?.disconnect(); restore(); };
}
