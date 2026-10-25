import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsIntroduce, recordsTouch } from './mutation-scope.ts';

/** Marks the sidebar More card this module places beside its row. */
export const SIDEBAR_MORE_MENU_ATTRIBUTE = 'data-ccd-sidebar-more-menu';

/** Gap and viewport fit of the `Menu` primitive's own side=right geometry. */
const GAP = 4;
const MARGIN = 12;

/** `ui-entry-customization`'s two rows, host copy → this plugin's copy. */
const LABELS = new Map([
  ['浏览更多插件', '浏览插件…'],
  ['创建你的插件', '创建插件…'],
  ['Browse other plugins', 'Browse plugins…'],
  ['Create your plugin', 'Create plugin…'],
]);

/**
 * Open the sidebar panel list's More card to the right of its row, like the
 * reference's sidebar menu, and shorten its two entry-customization rows.
 *
 * `SidebarRoot` renders the card with the primitive's default bottom side and
 * rewrites `left`/`top` on every frame, so the position is published as two
 * custom properties the stylesheet applies with `!important`; React keeps
 * owning the inline coordinates and the rows keep their host handlers.
 */
export function mountSidebarMoreMenu(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const view = document.defaultView;
  const texts = new Map<Text, { from: string; to: string }>();
  let menu: HTMLElement | null = null;

  const release = (node: HTMLElement) => {
    node.removeAttribute(SIDEBAR_MORE_MENU_ATTRIBUTE);
    node.style.removeProperty('--ccd-sidebar-more-left');
    node.style.removeProperty('--ccd-sidebar-more-top');
  };
  const restoreTexts = () => {
    for (const [node, { from, to }] of texts) if (node.data === to) node.data = from;
    texts.clear();
  };
  const write = (node: HTMLElement, name: string, value: string) => {
    if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
  };

  const sync = () => {
    const trigger = document.querySelector<HTMLElement>(`${host.sidebarPanelList} [aria-haspopup="menu"][aria-expanded="true"]`);
    const next = trigger ? document.querySelector<HTMLElement>(host.sidebarMoreMenu) : null;
    if (next !== menu) {
      if (menu) release(menu);
      restoreTexts();
      menu = next;
    }
    if (!menu || !trigger || !view) return;
    if (menu.getAttribute(SIDEBAR_MORE_MENU_ATTRIBUTE) !== '') menu.setAttribute(SIDEBAR_MORE_MENU_ATTRIBUTE, '');
    for (const row of menu.querySelectorAll('[role="menuitem"]')) {
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode as Text;
        const label = LABELS.get(text.data.trim());
        if (label === undefined) continue;
        texts.set(text, { from: text.data, to: label });
        text.data = label;
      }
    }
    const row = trigger.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const left = Math.max(MARGIN, Math.min(row.right + GAP, view.innerWidth - width - MARGIN));
    const top = Math.max(MARGIN, Math.min(row.top, view.innerHeight - height - MARGIN));
    write(menu, '--ccd-sidebar-more-left', `${Math.round(left)}px`);
    write(menu, '--ccd-sidebar-more-top', `${Math.round(top)}px`);
  };
  const run = () => { try { sync(); } catch (error) { report(error); } };

  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === 'attributes' && record.attributeName === 'aria-expanded')
      || (menu !== null && recordsTouch(records, menu))
      || recordsIntroduce(records, host.sidebarMoreMenu)) run();
  });
  try {
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['style', 'aria-expanded'],
    });
    view?.addEventListener('resize', run);
    view?.addEventListener('scroll', run, true);
    sync();
  } catch (error) {
    observer.disconnect();
    view?.removeEventListener('resize', run);
    view?.removeEventListener('scroll', run, true);
    report(error);
    return () => {};
  }
  return () => {
    observer.disconnect();
    view?.removeEventListener('resize', run);
    view?.removeEventListener('scroll', run, true);
    if (menu) release(menu);
    restoreTexts();
    menu = null;
  };
}
