import type { Disposer, ThemePreferencePort } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { mountAccountMore } from './account-more.ts';
import { mountAccountTheme } from './account-theme.ts';
import { mountAccountBalance, type AccountBalanceCache } from './account-balance.ts';
import { recordsInTranscript } from './mutation-scope.ts';
import { openPluginFeedback } from './plugin-feedback.ts';

/** Marks the portalled account menu for the stylesheet. */
export const ACCOUNT_MENU_ATTRIBUTE = 'data-ccd-account-menu';

/**
 * Custom property carrying the signed-in name shown as the menu header.
 *
 * The value is one *quoted* CSS string token (`accountNameToken`); the
 * stylesheet paints it with `content: var(--ccd-account-name, "")`.
 */
export const ACCOUNT_NAME_PROPERTY = '--ccd-account-name';
const MENU_GEOMETRY_PROPERTIES = ['--ccd-account-menu-width', '--ccd-account-menu-left'] as const;

/**
 * One account name as a complete CSS string token.
 *
 * The quotes are part of the value, not decoration: `content` has no production
 * that takes a bare word, so after `var()` substitution the value is matched
 * against the property's grammar, and a name that is not exactly one `<string>`
 * leaves the declaration invalid at computed-value time. `content` is not
 * inherited, so that behaves as `unset` — the initial `normal`, which computes
 * to `none` on `::before`. The pseudo-element is then never generated, and the
 * header disappears whole, its padding with it. CSS's own custom-property
 * examples keep the quotes for the same reason (`--external-link: "external
 * link"` feeding `content: " (" var(--external-link) ")"`).
 *
 * Inside the quotes a name travels as written, except for the three things CSS
 * string syntax cannot carry raw: the quote and the backslash take a preceding
 * backslash, and a control character takes a hex escape padded to six digits
 * followed by one space (`\00000a `) — the form CSS serializes strings in. That
 * space terminates the escape while the value is tokenized, so it is consumed
 * rather than painted, and the six digits leave no room for a hex digit of the
 * following character to be swallowed by the escape.
 *
 * @param name - the signed-in name as read from the trigger.
 * @returns the name as one quoted CSS string token for the custom property.
 */
export function accountNameToken(name: string): string {
  let token = '"';
  for (const character of name) {
    /* Astral characters arrive as one pair and are painted as they stand. */
    const code = character.codePointAt(0) ?? 0;
    if (character === '"' || character === '\\') token += `\\${character}`;
    else if (code < 0x20 || code === 0x7f) token += `\\${code.toString(16).padStart(6, '0')} `;
    else token += character;
  }
  return `${token}"`;
}

/**
 * The reference draws the signed-in account menu as a card whose first block is
 * the account itself (the account name over a workspace line). DSH's account
 * menu is a portalled `Menu` of plain rows and the signed-in name only exists on
 * the sidebar trigger, so this mirrors that real value onto the open menu and
 * tags it. The contact row becomes a More submenu whose feedback action still
 * invokes the original host button.
 *
 * The menu is recognised structurally (a fixed-position `[role="menu"]` that is
 * open while the trigger reports `aria-expanded`), so no menu class hash is
 * needed here.
 *
 * @param document - renderer document carrying the sidebar and the portal.
 * @param report - sink for observer failures; the native menu stays untouched.
 * @returns disposer that disconnects the observers and clears every mark.
 */
export function mountAccountMenu(
  document: Document, report: (error: unknown) => void, theme: ThemePreferencePort | null = null,
): Disposer {
  const host = hostSelectors(document);
  const marked = new Set<HTMLElement>();
  const additions = new Map<HTMLElement, Disposer>();
  let balanceAccount = '';
  let balanceCache: AccountBalanceCache = {};
  let trigger: HTMLElement | null = null;
  let scheduled = 0;
  let closeFeedback = () => {};
  const bug = document.createElement('button');
  bug.type = 'button';
  bug.setAttribute('data-ccd-plugin-feedback', '');
  const zh = (document.documentElement.lang || document.defaultView?.navigator.language || '').toLowerCase().startsWith('zh');
  const bugLabel = zh ? '插件 UI Bug 反馈' : 'Report a plugin UI bug';
  bug.setAttribute('aria-label', bugLabel);
  bug.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(45 12 12)"><path d="M8 9h8v7a4 4 0 0 1-8 0V9Zm2 0V6a2 2 0 0 1 4 0v3M12 10v9M6 4l3 3m6 0 3-3M4 10l4 2m8 0 4-2M3 16h5m8 0h5M6 22l3-3m6 0 3 3"/></g></svg>';
  bug.addEventListener('click', event => {
    event.stopPropagation();
    closeFeedback();
    closeFeedback = openPluginFeedback(document);
  });

  const clear = () => {
    for (const dispose of additions.values()) dispose();
    additions.clear();
    for (const menu of marked) {
      menu.removeAttribute(ACCOUNT_MENU_ATTRIBUTE);
      menu.style.removeProperty(ACCOUNT_NAME_PROPERTY);
      for (const property of MENU_GEOMETRY_PROPERTIES) menu.style.removeProperty(property);
    }
    marked.clear();
  };

  const sync = () => {
    scheduled = 0;
    if (trigger?.parentElement && bug.previousElementSibling !== trigger) trigger.after(bug);
    const open = trigger?.getAttribute('aria-expanded') === 'true';
    if (!open) {
      clear();
      return;
    }
    let target: HTMLElement | null = null;
    for (const candidate of document.querySelectorAll<HTMLElement>(host.menu)) {
      if (candidate.hasAttribute('data-ccd-account-more-menu')) continue;
      if (getComputedStyle(candidate).position === 'fixed') target = candidate;
    }
    if (target === null) return;
    const sidebar = trigger?.closest<HTMLElement>(host.sidebarRoot);
    const expanded = sidebar && !sidebar.matches(host.sidebarCollapsed);
    const rect = (expanded ? sidebar : trigger)?.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    if (rect && viewportWidth > 0) {
      // The compact account button must not determine the expanded card width.
      const width = Math.min(expanded ? rect.width : 236, viewportWidth - 16);
      target.style.setProperty('--ccd-account-menu-width', `${width}px`);
      target.style.setProperty('--ccd-account-menu-left', `${Math.max(8, Math.min(rect.left, viewportWidth - width - 8))}px`);
    }
    for (const [menu, dispose] of additions) {
      if (menu === target) continue;
      dispose();
      additions.delete(menu);
      menu.removeAttribute(ACCOUNT_MENU_ATTRIBUTE);
      menu.style.removeProperty(ACCOUNT_NAME_PROPERTY);
      for (const property of MENU_GEOMETRY_PROPERTIES) menu.style.removeProperty(property);
      marked.delete(menu);
    }
    const name = trigger?.querySelector(host.accountLabel)?.textContent?.trim() ?? '';
    if (name !== balanceAccount) {
      balanceAccount = name;
      balanceCache = {};
    }
    target.setAttribute(ACCOUNT_MENU_ATTRIBUTE, '');
    /* The stylesheet reads this back as `content`, so it is written as one
       *quoted* CSS string token even when the name carries spaces or quotes. */
    target.style.setProperty(ACCOUNT_NAME_PROPERTY, accountNameToken(name));
    marked.add(target);
    if (!additions.has(target)) {
      const disposeMore = mountAccountMore(target);
      const disposeTheme = mountAccountTheme(target, theme);
      const disposeBalance = mountAccountBalance(target, balanceCache);
      additions.set(target, () => { disposeBalance(); disposeTheme(); disposeMore(); });
    }
  };

  /* Observer callbacks are batched into one microtask, and the tag has to land
     even while the window is occluded and animation frames are throttled. */
  const schedule = () => {
    if (scheduled !== 0) return;
    scheduled = 1;
    try {
      sync();
    } finally {
      scheduled = 0;
    }
  };

  let tree: MutationObserver | undefined;
  let attributes: MutationObserver | undefined;
  let attached: HTMLElement | null = null;
  const resize = new ResizeObserver(schedule);
  try {
    tree = new MutationObserver(records => {
      if (recordsInTranscript(records)) return;
      const found = document.querySelector<HTMLElement>(host.accountTrigger);
      if (found !== attached) {
        attributes?.disconnect();
        attached = found;
        trigger = found;
        resize.disconnect();
        if (found !== null) {
          resize.observe(found);
          const sidebar = found.closest(host.sidebarRoot);
          if (sidebar) resize.observe(sidebar);
        }
        if (found !== null) {
          attributes = new MutationObserver(schedule);
          attributes.observe(found, { attributes: true, attributeFilter: ['aria-expanded'] });
        }
      }
      schedule();
    });
    tree.observe(document.body, { childList: true, subtree: true });
    const initial = document.querySelector<HTMLElement>(host.accountTrigger);
    if (initial !== null) {
      attached = initial;
      trigger = initial;
      resize.observe(initial);
      const sidebar = initial.closest(host.sidebarRoot);
      if (sidebar) resize.observe(sidebar);
      attributes = new MutationObserver(schedule);
      attributes.observe(initial, { attributes: true, attributeFilter: ['aria-expanded'] });
    }
    sync();
    document.defaultView?.addEventListener('resize', schedule);
  } catch (error) {
    tree?.disconnect();
    attributes?.disconnect();
    resize.disconnect();
    clear();
    bug.remove();
    closeFeedback();
    report(error);
    return () => {};
  }

  return () => {
    scheduled = 0;
    tree?.disconnect();
    attributes?.disconnect();
    resize.disconnect();
    document.defaultView?.removeEventListener('resize', schedule);
    clear();
    bug.remove();
    closeFeedback();
  };
}
