import type { Disposer } from '../contracts/ports.ts';
import { frameScheduler } from './frame.ts';
import { recordsInTranscript } from './mutation-scope.ts';
import { scheduleCopy } from './schedule-locales.ts';
export { SCHEDULE_TEMPLATES, type ScheduleTemplate } from './schedule-locales.ts';

const TEMPLATE_ICONS = [
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  '<path d="M4 8h10a4 4 0 0 1 4 4v7H4Zm10 0V4h6M10 8v14M7 12h3"/>',
  '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M7 3v4m10-4v4M6 16l4-5 4 3 4-5"/>',
  '<path d="m3 5 1 1 2-2M9 5h12M3 11l1 1 2-2M9 11h12M3 17l1 1 2-2M9 17h12"/>',
  '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10m12 0v-5c0-4-6-2-6-6V3m0 0 3 3m-3-3L9 6"/>',
  '<path d="m12 2 8 4v7c0 4-8 9-8 9S4 17 4 13V6Z"/><circle cx="12" cy="10" r="3"/>',
  '<path d="M5 3h13v14H7V3M5 3a2 2 0 0 0-2 2v2h4m11 10h3v2a2 2 0 0 1-2 2H8a1 1 0 0 1-1-1v-3h11"/><path d="M10 7h5m-5 4h5"/>',
  '<path d="M8 3h8m-6 0v7L4 20c0 1 16 1 16 0l-6-10V3M7 15h10"/>',
];

const STOPWATCH = '<svg viewBox="0 0 100 110" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M35 5h30v9H56v7H44v-7h-9Z" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="50" cy="65" r="41" fill="var(--ccd-hover)" stroke="currentColor" stroke-width="2.4"/><path d="M50 35v30l21-12" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FREQUENCY_CLOCK = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke="currentColor" stroke-width="1.5"/><path d="M10 5.5V10l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICONS = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  filter: '<path d="M7 3v7m0 4v7M17 3v11m0 4v3"/><circle cx="7" cy="12" r="2"/><circle cx="17" cy="16" r="2"/>',
} as const;

/** Host TaskManagerPage has a stable test id; its four direct content blocks
 * are heading, filters, search and list (verified in shipped ui-schedule).
 * Add siblings and annotations, never move or replace React-owned elements. */
export function mountSchedulePage(document: Document, report: (error: unknown) => void, prepareNewTask?: (prompt?: string) => void): Disposer {
  let page: HTMLElement | null = null;
  let cleanup: Disposer = () => {};
  let localize: () => void = () => {};
  let renderedCopy: ReturnType<typeof scheduleCopy> | undefined;
  const decorations = new Set<Element>();
  const texts = new Map<Text, { from: string; to: string }>();
  const label = (element: Element | null, value: string) => {
    if (!element) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      if (!node.data.trim()) continue;
      if (node.data !== value) {
        const old = texts.get(node);
        texts.set(node, { from: old?.to === node.data ? old.from : node.data, to: value });
        node.data = value;
      }
      break;
    }
  };
  const sync = () => {
    const next = document.querySelector<HTMLElement>('[data-testid="task-manager-page"]');
    if (next !== page) { cleanup(); cleanup = () => {}; page = next; renderedCopy = undefined; localize = () => {}; }
    if (!page) return;
    const copy = scheduleCopy(document);
    const heading = page.querySelector('h1');
    const content = heading?.parentElement?.parentElement;
    if (!content || content.children.length < 4) return;
    if (!page.hasAttribute('data-ccd-schedule')) {
      const owner = page;
      const owned: Element[] = [];
      const tagged: Element[] = [];
      const tag = (el: Element, name: string) => { el.setAttribute('data-ccd-schedule-part', name); tagged.push(el); };
      const [headingBlock, filters, searchTools, list] = Array.from(content.children);
      const modern = filters?.querySelectorAll('[role="group"] > button').length === 4;
      const search = modern ? searchTools?.firstElementChild : searchTools;
      if (!headingBlock || !filters || !search || !list) return;
      owner.setAttribute('data-ccd-schedule', 'mine');
      if (modern) {
        owner.setAttribute('data-ccd-schedule-native', '');
        tag(searchTools!, 'search-tools');
        const actions = headingBlock.querySelector(':scope > div');
        if (actions) {
          tag(actions, 'new-group');
          const split = actions.querySelector(':scope > [role="group"]');
          if (split) {
            tag(split, 'new-split');
            const method = split.querySelector('button[aria-haspopup="menu"]');
            if (method) tag(method, 'new-method');
          }
        }
      }
      tag(content, 'content'); tag(headingBlock, 'heading'); tag(filters, 'filters'); tag(search, 'search'); tag(list, 'list');
      let usingTemplate = false;
      const prepare = (event: Event) => {
        if (usingTemplate || !(event.target instanceof Element)) return;
        const button = event.target.closest('button');
        if ((button?.matches('[data-ccd-schedule-part="new"]') || (!modern && button?.matches('[data-ccd-schedule-part="empty"] button')))) prepareNewTask?.(scheduleCopy(document).defaultPrompt);
      };
      owner.addEventListener('click', prepare, true);
      const nativeNew = headingBlock.querySelector('button');
      if (nativeNew) tag(nativeNew, 'new');
      const toolbar = document.createElement('div');
      toolbar.className = 'ccd-schedule-toolbar';
      const tabs = document.createElement('div'); tabs.className = 'ccd-schedule-tabs'; tabs.setAttribute('role', 'group');
      for (const [id, name] of [['mine', copy.mine], ['templates', copy.templates]]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = name!;
        button.setAttribute('aria-pressed', String(id === 'mine'));
        button.onclick = () => {
          owner.setAttribute('data-ccd-schedule', id!);
          for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab === button));
          owner.removeAttribute('data-ccd-filter-open');
          toolbar.querySelector('[data-ccd-schedule-tool="filter"]')?.setAttribute('aria-expanded', 'false');
        };
        tabs.append(button);
      }
      toolbar.append(tabs);
      const input = search.querySelector<HTMLInputElement>('input');
      const originalPlaceholder = input?.getAttribute('placeholder') ?? null;
      let appliedPlaceholder = copy.searchPlaceholder as string;
      const filterTitle = document.createElement('div');
      filterTitle.className = 'ccd-schedule-filter-title';
      filters.prepend(filterTitle); owned.push(filterTitle);
      const closeSearch = () => {
        // Use the host's controlled clear action rather than changing its input DOM.
        search.querySelector<HTMLButtonElement>(':scope > button:not(.ccd-schedule-search-close)')?.click();
        owner.removeAttribute('data-ccd-search-open');
        const trigger = toolbar.querySelector<HTMLButtonElement>('[data-ccd-schedule-tool="search"]');
        trigger?.setAttribute('aria-expanded', 'false'); trigger?.focus();
      };
      const searchClose = document.createElement('button');
      searchClose.type = 'button'; searchClose.className = 'ccd-schedule-search-close';
      searchClose.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>';
      searchClose.onclick = closeSearch;
      search.append(searchClose); owned.push(searchClose);
      const originalFilterStyle = filters.getAttribute('style');
      const positionFilter = () => {
        if (!owner.hasAttribute('data-ccd-filter-open')) return;
        const trigger = toolbar.querySelector('[data-ccd-schedule-tool="filter"]');
        if (!trigger) return;
        const anchor = trigger.getBoundingClientRect();
        const menu = filters.getBoundingClientRect();
        const width = document.documentElement.clientWidth;
        const height = document.documentElement.clientHeight;
        const left = Math.max(8, Math.min(anchor.right - menu.width, width - menu.width - 8));
        const top = anchor.bottom + 7 + menu.height <= height - 8
          ? anchor.bottom + 7 : Math.max(8, anchor.top - menu.height - 7);
        (filters as HTMLElement).style.left = `${left}px`;
        (filters as HTMLElement).style.top = `${top}px`;
      };
      for (const id of ['search', 'filter'] as const) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'ccd-schedule-tool';
        button.setAttribute('data-ccd-schedule-tool', id); button.setAttribute('aria-expanded', 'false');
        button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${ICONS[id]}</svg>`;
        button.onclick = () => {
          const attribute = `data-ccd-${id}-open`;
          const open = !owner.hasAttribute(attribute);
          owner.toggleAttribute(attribute, open); button.setAttribute('aria-expanded', String(open));
          if (open && id === 'search') input?.focus();
          if (open && id === 'filter') positionFilter();
        };
        toolbar.append(button);
      }
      content.append(toolbar); owned.push(toolbar);
      const templates = document.createElement('section'); templates.className = 'ccd-schedule-templates';
      for (const [index, template] of copy.suggestions.entries()) {
        const card = document.createElement('button'); card.type = 'button'; card.className = 'ccd-schedule-template';
        const icon = document.createElement('span'); icon.className = 'ccd-schedule-template-icon'; icon.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${TEMPLATE_ICONS[index]}</svg>`; icon.setAttribute('aria-hidden', 'true');
        const body = document.createElement('span'); body.className = 'ccd-schedule-template-body';
        for (const [part, value] of [['name', template.name], ['description', template.description], ['frequency', template.frequency]]) {
          const span = document.createElement('span'); span.className = `ccd-schedule-template-${part}`; span.textContent = value!;
          if (part === 'frequency') {
            const clock = document.createElement('span');
            clock.className = 'ccd-schedule-frequency-clock';
            clock.setAttribute('aria-hidden', 'true');
            clock.innerHTML = FREQUENCY_CLOCK;
            span.prepend(clock);
          }
          body.append(span);
        }
        card.append(icon, body);
        card.onclick = () => {
          try {
            if (!nativeNew || !prepareNewTask) throw new Error('Task template new-session action unavailable');
            prepareNewTask(scheduleCopy(document).suggestions[index]!.prompt);
            usingTemplate = true;
            try { nativeNew.click(); } finally { usingTemplate = false; }
          } catch (error) { report(error); }
        };
        templates.append(card);
      }
      content.append(templates); owned.push(templates);
      localize = () => {
        const current = scheduleCopy(document);
        tabs.setAttribute('aria-label', current.view);
        tabs.children[0]!.textContent = current.mine;
        tabs.children[1]!.textContent = current.templates;
        filterTitle.textContent = current.status;
        searchClose.setAttribute('aria-label', current.closeSearch);
        appliedPlaceholder = current.searchPlaceholder;
        if (input) input.placeholder = appliedPlaceholder;
        for (const id of ['search', 'filter'] as const) {
          const button = toolbar.querySelector<HTMLButtonElement>(`[data-ccd-schedule-tool="${id}"]`)!;
          button.setAttribute('aria-label', current[id]); button.title = current[id];
        }
        templates.setAttribute('aria-label', current.templateRegion);
        current.suggestions.forEach((template, index) => {
          const card = templates.children[index]!;
          card.querySelector('.ccd-schedule-template-name')!.textContent = template.name;
          card.querySelector('.ccd-schedule-template-description')!.textContent = template.description;
          const frequency = card.querySelector('.ccd-schedule-template-frequency')!;
          // Keep the decorative clock while changing the trailing text node.
          frequency.lastChild!.textContent = template.frequency;
        });
      };
      const dismiss = (event: Event) => {
        if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
        if (event.type === 'pointerdown' && event.target instanceof Node && (filters.contains(event.target) || toolbar.contains(event.target))) return;
        const wasOpen = owner.hasAttribute('data-ccd-filter-open');
        owner.removeAttribute('data-ccd-filter-open');
        if (event instanceof KeyboardEvent && wasOpen) toolbar.querySelector<HTMLButtonElement>('[data-ccd-schedule-tool="filter"]')?.focus();
        if (event instanceof KeyboardEvent && search.contains(event.target as Node)) closeSearch();
        toolbar.querySelector('[data-ccd-schedule-tool="filter"]')?.setAttribute('aria-expanded', 'false');
      };
      const filterSelection = (event: Event) => {
        if (!(event.target instanceof Element) || !event.target.closest('button')) return;
        owner.removeAttribute('data-ccd-filter-open');
        const trigger = toolbar.querySelector<HTMLButtonElement>('[data-ccd-schedule-tool="filter"]');
        trigger?.setAttribute('aria-expanded', 'false'); trigger?.focus();
      };
      const filterKeys = (event: KeyboardEvent) => {
        const buttons = Array.from(filters.querySelectorAll<HTMLButtonElement>('button'));
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      };
      const triggerKeys = (event: KeyboardEvent) => {
        if (event.key !== 'ArrowDown' || !(event.target instanceof Element)
          || event.target.getAttribute('data-ccd-schedule-tool') !== 'filter') return;
        event.preventDefault();
        owner.setAttribute('data-ccd-filter-open', '');
        event.target.setAttribute('aria-expanded', 'true');
        positionFilter(); filters.querySelector<HTMLButtonElement>('button')?.focus();
      };
      filters.addEventListener('click', filterSelection);
      filters.addEventListener('keydown', filterKeys as EventListener);
      toolbar.addEventListener('keydown', triggerKeys);
      document.addEventListener('scroll', positionFilter, true);
      document.defaultView?.addEventListener('resize', positionFilter);
      document.addEventListener('pointerdown', dismiss); owner.addEventListener('keydown', dismiss);
      cleanup = () => {
        document.removeEventListener('pointerdown', dismiss); owner.removeEventListener('keydown', dismiss);
        owner.removeEventListener('click', prepare, true);
        filters.removeEventListener('click', filterSelection);
        filters.removeEventListener('keydown', filterKeys as EventListener);
        toolbar.removeEventListener('keydown', triggerKeys);
        document.removeEventListener('scroll', positionFilter, true);
        document.defaultView?.removeEventListener('resize', positionFilter);
        if (originalFilterStyle === null) filters.removeAttribute('style');
        else filters.setAttribute('style', originalFilterStyle);
        if (input?.getAttribute('placeholder') === appliedPlaceholder) {
          if (originalPlaceholder === null) input.removeAttribute('placeholder');
          else input.setAttribute('placeholder', originalPlaceholder);
        }
        owned.forEach(el => el.remove());
        for (const el of decorations) {
          if (el.classList.contains('ccd-schedule-stopwatch')) el.remove();
          else el.removeAttribute('data-ccd-schedule-part');
        }
        decorations.clear(); tagged.forEach(el => el.removeAttribute('data-ccd-schedule-part'));
        for (const name of ['data-ccd-schedule', 'data-ccd-schedule-native', 'data-ccd-search-open', 'data-ccd-filter-open']) owner.removeAttribute(name);
        for (const [node, { from, to }] of texts) if (node.data === to) node.data = from;
        texts.clear();
      };
    }
    if (renderedCopy !== copy) { renderedCopy = copy; localize(); }
    label(heading ?? null, copy.title);
    label(content.querySelector('[data-ccd-schedule-part="new"]'), copy.newTask);
    const empty = content.querySelector('[role="status"]:has(h2):has(button)');
    if (empty && !empty.hasAttribute('data-ccd-schedule-part')) {
      empty.setAttribute('data-ccd-schedule-part', 'empty');
      const art = document.createElement('span'); art.className = 'ccd-schedule-stopwatch'; art.setAttribute('aria-hidden', 'true'); art.innerHTML = STOPWATCH; empty.prepend(art); decorations.add(art); decorations.add(empty);
    }
    const emptyTitle = empty?.querySelector('h2');
    if (emptyTitle && (texts.has(emptyTitle.firstChild as Text)
      || ['还没有自动化任务，在会话中创建的任务会显示在这里', 'No tasks yet. Tasks created in your sessions appear here.'].includes(emptyTitle.textContent ?? ''))) label(emptyTitle, copy.empty);
    if (!page.hasAttribute('data-ccd-schedule-native')) label(empty?.querySelector('button') ?? null, copy.newTask);
    for (const node of texts.keys()) if (!node.isConnected) texts.delete(node);
  };
  const frames = frameScheduler(() => { try { sync(); } catch (error) { report(error); } }, document.defaultView);
  const observer = new MutationObserver(records => { if (!recordsInTranscript(records)) frames.schedule(); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  try { sync(); } catch (error) { report(error); }
  return () => {
    observer.disconnect(); frames.cancel(); cleanup();
  };
}
