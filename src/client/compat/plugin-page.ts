import type { Disposer } from '../contracts/ports.ts';
import { frameScheduler } from './frame.ts';
import { recordsIntroduce, recordsTouch } from './mutation-scope.ts';
import type { PluginCatalogEntry, PluginCatalogPort } from './plugin-catalog.ts';

const PANEL = '[data-plugin-panel]';
const PART = 'data-ccd-plugin-part';
const MANAGER_PARTS = new Set([
  'pageHead', 'pageHeading', 'pageTitle', 'pageIntro', 'toolbar', 'pageTabs',
  'pageTabList', 'installedPanel', 'tabPanel', 'group', 'groupHead', 'groupTitle',
  'cards', 'card', 'cardHead', 'cardIcon', 'cardMain', 'titleRow', 'cardTitle',
  'cardDesc', 'cardEnd', 'addGroup', 'addPrimary', 'addMore', 'addButton',
  'detail', 'detailTop', 'detailHead', 'detailMain', 'detailActions', 'crumb', 'crumbIcon',
  'detailTitle', 'detailDescription', 'moreHead', 'groupMore',
]);
const MARKET_PARTS = new Set([
  'toolbar', 'marketButton', 'search', 'categories', 'cards', 'card', 'icon',
  'main', 'titleRow', 'cardOpen', 'description', 'meta', 'cardEnd', 'detail',
  'detailTitle', 'detailDescription', 'empty', 'more',
]);

/**
 * Style the host's real plugin manager and Discover without moving React nodes.
 * The stable panel markers identify each CSS module; only that module's exact
 * class tokens are annotated. A missing/changed module falls back to native UI.
 * Installation, pagination, menus, tabs and configuration remain host-owned.
 */
export function mountPluginPage(document: Document, report: (error: unknown) => void, catalog?: PluginCatalogPort): Disposer {
  let page: HTMLElement | null = null;
  let search: HTMLLabelElement | null = null;
  let empty: HTMLParagraphElement | null = null;
  let query = '';
  let released = false;
  const headings = new Map<Element, HTMLElement>();
  const versions = new Map<Element, HTMLElement>();
  const breadcrumbs = new Map<Element, HTMLElement>();
  let entries: readonly PluginCatalogEntry[] = [];
  let loaded = false;
  let loading = false;
  const loadCatalog = async () => {
    if (!catalog || loading || released) return;
    loading = true;
    try { entries = await catalog.read(); loaded = true; }
    catch (error) { loaded = true; report(error); }
    finally { loading = false; if (!released) scheduler.schedule(); }
  };
  const attributes = new Map<Element, Map<string, { from: string | null; to: string }>>();
  const texts = new Map<Text, { from: string; to: string }>();
  const attribute = (node: Element, key: string, value: string) => {
    if (node.getAttribute(key) === value) return;
    let saved = attributes.get(node);
    if (!saved) { saved = new Map(); attributes.set(node, saved); }
    const prior = saved.get(key);
    saved.set(key, { from: prior?.to === node.getAttribute(key) ? prior.from : node.getAttribute(key), to: value });
    node.setAttribute(key, value);
  };
  const label = (node: Element | null, value: string) => {
    if (!node) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      if (!text.data.trim()) continue;
      if (text.data !== value) {
        const prior = texts.get(text);
        texts.set(text, { from: prior?.to === text.data ? prior.from : text.data, to: value });
        text.data = value;
      }
      break;
    }
  };
  const restore = () => {
    for (const breadcrumb of breadcrumbs.values()) breadcrumb.remove();
    breadcrumbs.clear();
    for (const version of versions.values()) version.remove();
    versions.clear();
    for (const heading of headings.values()) heading.remove();
    headings.clear();
    search?.remove(); empty?.remove(); search = null; empty = null;
    for (const [node, saved] of attributes) for (const [key, { from, to }] of saved) {
      if (node.getAttribute(key) !== to) continue;
      if (from === null) node.removeAttribute(key); else node.setAttribute(key, from);
    }
    for (const [node, { from, to }] of texts) if (node.data === to) node.data = from;
    attributes.clear(); texts.clear();
  };
  const annotate = (root: Element, suffix: string, family: string, names: ReadonlySet<string>) => {
    const token = Array.from(root.classList).find(name => name.endsWith(`_${suffix}`));
    if (!token) return;
    const prefix = token.slice(0, -suffix.length);
    for (const node of root.querySelectorAll('[class]')) {
      const name = Array.from(node.classList).find(value => value.startsWith(prefix) && names.has(value.slice(prefix.length)));
      if (name) attribute(node, PART, `${family}-${name.slice(prefix.length)}`);
    }
  };
  const sync = () => {
    const next = document.querySelector<HTMLElement>(PANEL);
    if (next !== page) { restore(); page = next; }
    if (!page) return;
    if (!Array.from(page.classList).some(name => name.endsWith('_page'))) return;
    // Drop replaced host nodes instead of retaining old catalogs and form trees.
    for (const node of attributes.keys()) if (!page.contains(node)) attributes.delete(node);
    for (const node of texts.keys()) if (!page.contains(node)) texts.delete(node);
    annotate(page, 'page', 'manager', MANAGER_PARTS);
    const discover = page.querySelector('[data-plugin-tab="discover"]');
    if (discover) annotate(discover, 'section', 'market', MARKET_PARTS);
    const heading = page.querySelector(`[${PART}="manager-pageHeading"] h1`);
    const mode = discover ? 'discover' : heading ? 'mine' : 'detail';
    attribute(page, 'data-ccd-plugin-page', mode);
    for (const [top, breadcrumb] of breadcrumbs) if (!page.contains(top)) {
      breadcrumb.remove(); breadcrumbs.delete(top);
    }
    for (const top of page.querySelectorAll(`[${PART}="manager-detailTop"]`)) {
      const title = top.parentElement?.querySelector(`[${PART}="manager-detailTitle"]`)?.textContent?.trim();
      if (!title) { breadcrumbs.get(top)?.remove(); breadcrumbs.delete(top); continue; }
      let breadcrumb = breadcrumbs.get(top);
      if (!breadcrumb) {
        breadcrumb = document.createElement('span');
        breadcrumb.className = 'ccd-plugin-detail-current';
        const separator = document.createElement('span');
        separator.textContent = '/'; separator.setAttribute('aria-hidden', 'true');
        const current = document.createElement('span'); current.setAttribute('aria-current', 'page');
        breadcrumb.append(separator, current);
        breadcrumbs.set(top, breadcrumb);
      }
      const current = breadcrumb.lastElementChild!;
      if (current.textContent !== title) current.textContent = title;
      if (breadcrumb.parentElement !== top) top.append(breadcrumb);
    }
    const zh = document.documentElement.lang.toLowerCase().startsWith('zh');
    if (catalog && !loaded && !loading) void loadCatalog();
    for (const [card, version] of versions) if (!page.contains(card)) { version.remove(); versions.delete(card); }
    for (const card of page.querySelectorAll('[data-plugin-group="bundles"] [data-plugin-package]')) {
      const entry = entries.find(item => item.name === card.getAttribute('data-plugin-package'));
      const title = card.querySelector(`[${PART}="manager-titleRow"]`);
      if (!entry?.version || !title) continue;
      let version = versions.get(card);
      if (!version) { version = document.createElement('span'); version.className = 'ccd-plugin-version'; versions.set(card, version); }
      if (version.textContent !== `v${entry.version}`) version.textContent = `v${entry.version}`;
      if (version.parentElement !== title) title.append(version);
    }
    for (const button of page.querySelectorAll(`[${PART}="manager-groupMore"]`)) {
      label(button, zh ? '更多' : 'More');
    }
    for (const [list, heading] of headings) if (!page.contains(list)) {
      heading.remove(); headings.delete(list);
    }
    for (const list of page.querySelectorAll(`[${PART}="manager-cards"], [${PART}="market-cards"]`)) {
      let header = headings.get(list);
      if (!header) {
        header = document.createElement('div');
        header.className = 'ccd-plugin-list-heading';
        header.setAttribute('aria-hidden', 'true');
        header.append(document.createElement('span'), document.createElement('span'), document.createElement('span'));
        headings.set(list, header);
      }
      const basic = list.closest('[data-plugin-group]')?.getAttribute('data-plugin-group') === 'basic';
      const labels = zh ? ['插件', '说明', basic ? '' : '状态'] : ['Plugin', 'Description', basic ? '' : 'Status'];
      header.classList.toggle('ccd-plugin-list-heading-basic', basic);
      for (const [index, cell] of Array.from(header.children).entries()) {
        if (cell.textContent !== labels[index]) cell.textContent = labels[index]!;
      }
      if (list.previousElementSibling !== header) list.before(header);
    }
    label(heading, zh ? '自定义' : 'Customize');
    for (const tab of page.querySelectorAll('[role="tab"]')) {
      // Only the native Installed tab; other contributed tabs keep their labels.
      if (tab.id.endsWith('-installed')) label(tab, zh ? '我的' : 'My plugins');
    }
    const toolbar = page.querySelector(`[${PART}="market-toolbar"]`);
    if (toolbar) {
      const menus = Array.from(toolbar.querySelectorAll('button[aria-haspopup="menu"]'))
        .filter(button => button.getAttribute(PART) !== 'market-marketButton');
      for (const [index, button] of menus.entries()) {
        attribute(button, 'data-ccd-plugin-tool', index === menus.length - 1 ? 'sort' : 'filter');
        const title = button.textContent?.trim();
        if (title) { attribute(button, 'aria-label', title); attribute(button, 'title', title); }
      }
    }
    for (const button of page.querySelectorAll(`[${PART}="market-cardEnd"] button`)) {
      attribute(button, 'data-ccd-plugin-install', String(/^(安装 |Install )/u.test(button.getAttribute('aria-label') ?? '')));
      attribute(button, 'data-ccd-plugin-installed', String(/^(?:[✓✔]\s*)?(?:已安装|Installed)$/iu.test(button.textContent?.trim() ?? '')));
    }
    // Search only the installed/configuration cards already loaded by the host.
    if (!search) {
      search = document.createElement('label'); search.className = 'ccd-plugin-search';
      search.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>';
      const input = document.createElement('input'); input.type = 'search'; input.value = query;
      input.addEventListener('input', () => { query = input.value; scheduler.schedule(); });
      search.append(input);
      empty = document.createElement('p'); empty.className = 'ccd-plugin-search-empty'; empty.setAttribute('role', 'status');
    }
    if (search.parentElement !== page) page.append(search);
    if (empty && empty.parentElement !== page) page.append(empty);
    search.hidden = mode !== 'mine';
    const input = search.querySelector('input')!;
    input.placeholder = zh ? '搜索插件' : 'Search plugins';
    input.setAttribute('aria-label', input.placeholder);
    const needle = query.trim().toLocaleLowerCase();
    let count = 0;
    const cards = page.querySelectorAll('[data-plugin-group] [data-plugin-package], [data-plugin-group] [data-plugin-item]');
    for (const card of cards) {
      const hidden = mode === 'mine' && needle !== '' && !`${card.getAttribute('data-plugin-package') ?? ''} ${card.getAttribute('data-plugin-item') ?? ''} ${card.textContent}`.toLocaleLowerCase().includes(needle);
      attribute(card, 'data-ccd-plugin-search-hidden', String(hidden));
      if (!hidden) count++;
    }
    for (const group of page.querySelectorAll('[data-plugin-group]')) {
      const members = group.querySelectorAll('[data-plugin-package], [data-plugin-item]');
      const hidden = members.length > 0 && Array.from(members).every(card => card.getAttribute('data-ccd-plugin-search-hidden') === 'true');
      attribute(group, 'data-ccd-plugin-search-hidden', String(hidden));
    }
    if (empty) {
      empty.hidden = mode !== 'mine' || needle === '' || count > 0 || page.getAttribute('aria-busy') === 'true';
      const message = zh ? '没有匹配的插件' : 'No plugins match';
      if (empty.textContent !== message) empty.textContent = message;
    }
  };
  const scheduler = frameScheduler(() => { if (!released) try { sync(); } catch (error) { report(error); } }, document.defaultView);
  const observer = new MutationObserver(records => {
    if ((page && recordsTouch(records, page)) || recordsIntroduce(records, PANEL)) scheduler.schedule();
  });
  const locale = new MutationObserver(() => scheduler.schedule());
  const unsubscribe = catalog?.subscribe(() => { loaded = false; void loadCatalog(); });
  try {
    sync();
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    locale.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  } catch (error) { observer.disconnect(); locale.disconnect(); restore(); report(error); }
  return () => {
    released = true; unsubscribe?.(); observer.disconnect(); locale.disconnect(); scheduler.cancel(); restore();
  };
}
