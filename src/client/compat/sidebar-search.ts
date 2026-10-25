import type { Disposer, SearchPaletteOpener } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsIntroduce, recordsTouch } from './mutation-scope.ts';

/** Marks the sidebar column whose Search row this module placed below New Session. */
export const SIDEBAR_SEARCH_PLACED_ATTRIBUTE = 'data-ccd-sidebar-search-placed';

const MODIFIERS: Readonly<Record<string, string>> = { Meta: '⌘', Control: 'Ctrl', Alt: '⌥', Shift: '⇧' };

/**
 * Give Search its own navigation row below New Session, like the reference's
 * sidebar, and open the search palette from it.
 *
 * The host's field belongs to `ui-workspace`'s `WorkspaceBrowser`, and React
 * removes it from the section header whenever the sidebar collapses to its
 * rail, so the node stays where React put it. While the row is placed,
 * `sidebar.css` takes the field out of sight without making it unfocusable: the
 * host's own `session.search` shortcut (⌘K) still focuses it, and that focus is
 * what this module turns into opening the palette. The row itself is the
 * plugin's own button, inserted after New Session's node; React never addresses
 * it, so a re-render only needs it put back.
 */
export function mountSidebarSearch(
  document: Document,
  icon: string,
  palette: SearchPaletteOpener,
  report: (error: unknown) => void,
): Disposer {
  const host = hostSelectors(document);
  let root: HTMLElement | null = null;
  let row: HTMLButtonElement | null = null;
  let label: HTMLSpanElement | null = null;
  let shortcut: HTMLSpanElement | null = null;
  let disposed = false;

  const chinese = () => (document.documentElement.lang || globalThis.navigator?.language || '')
    .toLowerCase().startsWith('zh');

  const build = () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ccd-sidebar-search-row';
    button.setAttribute('data-ccd-nav', 'search');
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    const glyph = document.createElement('span');
    glyph.className = 'ccd-nav-glyph';
    glyph.setAttribute('data-ccd-nav-glyph', '');
    glyph.setAttribute('aria-hidden', 'true');
    // Trusted, bundled SVG constant; no host/user HTML is interpolated.
    glyph.innerHTML = icon;
    label = document.createElement('span');
    label.className = 'ccd-sidebar-search-label';
    shortcut = document.createElement('span');
    shortcut.className = 'ccd-sidebar-search-shortcut';
    shortcut.setAttribute('aria-hidden', 'true');
    button.append(glyph, label, shortcut);
    button.addEventListener('click', () => palette.open());
    return button;
  };

  const decorate = (button: HTMLButtonElement, nextRoot: HTMLElement) => {
    const text = chinese() ? '搜索' : 'Search';
    if (label && label.textContent !== text) label.textContent = text;
    if (button.getAttribute('aria-label') !== text) button.setAttribute('aria-label', text);
    const expanded = String(palette.isOpen());
    if (button.getAttribute('aria-expanded') !== expanded) button.setAttribute('aria-expanded', expanded);
    /* The host's own binding, so a remapped shortcut reads the same here. */
    const aria = nextRoot.querySelector(`${host.browserSearch} [aria-keyshortcuts]`)?.getAttribute('aria-keyshortcuts') ?? null;
    if (aria === null) {
      button.removeAttribute('aria-keyshortcuts');
      shortcut?.replaceChildren();
      return;
    }
    if (button.getAttribute('aria-keyshortcuts') !== aria) button.setAttribute('aria-keyshortcuts', aria);
    const keys = aria.split(' ')[0]!.split('+').map(key => MODIFIERS[key] ?? key.toUpperCase());
    if (shortcut && shortcut.textContent !== keys.join('')) {
      shortcut.replaceChildren(...keys.map(key => {
        const badge = document.createElement('kbd');
        badge.textContent = key;
        return badge;
      }));
    }
  };

  const unplace = () => {
    row?.remove();
    root?.removeAttribute(SIDEBAR_SEARCH_PLACED_ATTRIBUTE);
  };

  const place = () => {
    if (disposed) return;
    const nextRoot = document.querySelector<HTMLElement>(host.sidebarRoot);
    if (nextRoot !== root) { unplace(); root = nextRoot; }
    const newSession = nextRoot?.querySelector<HTMLElement>(host.sidebarNewSession) ?? null;
    const collapsed = nextRoot?.classList.contains(host.sidebarCollapsed.slice(1)) ?? true;
    if (nextRoot === null || newSession === null || collapsed) { unplace(); return; }
    /* New Session's own node, or the wrapper a tooltip may give it. */
    let anchor: Element = newSession;
    while (anchor.parentElement !== null && anchor.parentElement !== nextRoot) anchor = anchor.parentElement;
    if (anchor.parentElement !== nextRoot) { unplace(); return; }
    row ??= build();
    decorate(row, nextRoot);
    if (anchor.nextElementSibling !== row) anchor.after(row);
    if (!nextRoot.hasAttribute(SIDEBAR_SEARCH_PLACED_ATTRIBUTE)) nextRoot.setAttribute(SIDEBAR_SEARCH_PLACED_ATTRIBUTE, '');
  };

  const run = () => { try { place(); } catch (error) { report(error); } };

  /* ⌘K reaches the host's hidden field; hand that focus to the palette instead.
     The field is blurred before the palette opens, so the dialog never records
     it as the element to give focus back to. */
  const redirect = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || root === null || !root.hasAttribute(SIDEBAR_SEARCH_PLACED_ATTRIBUTE)) return;
    if (!root.contains(target) || target.closest(host.browserSearchSlot) === null) return;
    target.blur();
    palette.open();
  };

  let observer: MutationObserver | undefined;
  let language: MutationObserver | undefined;
  let unsubscribe: Disposer = () => {};
  try {
    observer = new MutationObserver(records => {
      if (recordsTouch(records, root) || recordsIntroduce(records, host.sidebarRoot)
        || (row !== null && !row.isConnected)) run();
    });
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-keyshortcuts'],
    });
    language = new MutationObserver(run);
    language.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    unsubscribe = palette.subscribe(run);
    document.addEventListener('focusin', redirect, true);
    place();
  } catch (error) {
    observer?.disconnect();
    language?.disconnect();
    unsubscribe();
    document.removeEventListener('focusin', redirect, true);
    unplace();
    report(error);
    return () => {};
  }

  return () => {
    disposed = true;
    observer?.disconnect();
    language?.disconnect();
    unsubscribe();
    document.removeEventListener('focusin', redirect, true);
    unplace();
    row = null;
    root = null;
  };
}
