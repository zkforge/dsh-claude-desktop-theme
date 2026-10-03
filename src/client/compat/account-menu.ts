import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

/** Marks the portalled account menu for the stylesheet. */
export const ACCOUNT_MENU_ATTRIBUTE = 'data-ccd-account-menu';

/**
 * Custom property carrying the signed-in name shown as the menu header.
 *
 * The value is one *quoted* CSS string token (`accountNameToken`); the
 * stylesheet paints it with `content: var(--ccd-account-name, "")`.
 */
export const ACCOUNT_NAME_PROPERTY = '--ccd-account-name';

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
 * tags it: no row is added, renamed or reordered — the stylesheet only reshapes
 * the card and prints the name it was given.
 *
 * The menu is recognised structurally (a fixed-position `[role="menu"]` that is
 * open while the trigger reports `aria-expanded`), so no menu class hash is
 * needed here.
 *
 * @param document - renderer document carrying the sidebar and the portal.
 * @param report - sink for observer failures; the native menu stays untouched.
 * @returns disposer that disconnects the observers and clears every mark.
 */
export function mountAccountMenu(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const marked = new Set<HTMLElement>();
  let trigger: HTMLElement | null = null;
  let scheduled = 0;

  const clear = () => {
    for (const menu of marked) {
      menu.removeAttribute(ACCOUNT_MENU_ATTRIBUTE);
      menu.style.removeProperty(ACCOUNT_NAME_PROPERTY);
    }
    marked.clear();
  };

  const sync = () => {
    scheduled = 0;
    const open = trigger?.getAttribute('aria-expanded') === 'true';
    if (!open) {
      clear();
      return;
    }
    let target: HTMLElement | null = null;
    for (const candidate of document.querySelectorAll<HTMLElement>(host.menu)) {
      if (getComputedStyle(candidate).position === 'fixed') target = candidate;
    }
    if (target === null) return;
    const name = trigger?.querySelector(host.accountLabel)?.textContent?.trim() ?? '';
    target.setAttribute(ACCOUNT_MENU_ATTRIBUTE, '');
    /* The stylesheet reads this back as `content`, so it is written as one
       *quoted* CSS string token even when the name carries spaces or quotes. */
    target.style.setProperty(ACCOUNT_NAME_PROPERTY, accountNameToken(name));
    marked.add(target);
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
  try {
    tree = new MutationObserver(() => {
      const found = document.querySelector<HTMLElement>(host.accountTrigger);
      if (found !== attached) {
        attributes?.disconnect();
        attached = found;
        trigger = found;
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
      attributes = new MutationObserver(schedule);
      attributes.observe(initial, { attributes: true, attributeFilter: ['aria-expanded'] });
    }
    sync();
  } catch (error) {
    tree?.disconnect();
    attributes?.disconnect();
    clear();
    report(error);
    return () => {};
  }

  return () => {
    scheduled = 0;
    tree?.disconnect();
    attributes?.disconnect();
    clear();
  };
}
