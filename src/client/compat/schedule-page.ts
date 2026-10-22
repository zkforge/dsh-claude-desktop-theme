import type { Disposer } from '../contracts/ports.ts';
import { frameScheduler } from './frame.ts';
import { recordsInTranscript } from './mutation-scope.ts';

export interface ScheduleTemplate {
  name: string;
  description: string;
  frequency: string;
  prompt: string;
}

/** Suggestions, not scheduled records: all require review and explicit sending. */
export const SCHEDULE_TEMPLATES: readonly ScheduleTemplate[] = [
  { name: '简报', description: '您的日历、邮件和消息摘要。', frequency: '工作日 09:00', prompt: '每个工作日早上 9 点，整理我可访问的日历、邮件和消息，生成今日简报。请先确认数据来源与时区，再创建定时任务。' },
  { name: '邮件分类处理', description: '为收件箱中的邮件分类并排定优先级，同时为紧急事项起草回复。', frequency: '工作日 17:00', prompt: '每个工作日下午 5 点，对我授权访问的收件箱进行分类、排定优先级，并为紧急事项起草回复，不自动发送。请先确认邮箱与时区，再创建定时任务。' },
  { name: '系统健康检查', description: '监控基础设施和服务中的错误、中断和性能问题。', frequency: '每天 09:00', prompt: '每天早上 9 点，检查当前项目中可访问的服务日志和健康指标，汇总错误、中断和性能问题。请先确认检查范围与时区，再创建定时任务。' },
  { name: '问题分类处理', description: '审查新提交的议题、缺陷和功能请求，并进行分类。', frequency: '工作日 16:00', prompt: '每个工作日下午 4 点，审查当前项目新提交的议题、缺陷和功能请求，给出分类和优先级建议。请先确认仓库与时区，再创建定时任务。' },
  { name: 'PR 审查摘要', description: '概览未关闭的 PR、审查状态以及需要关注的事项。', frequency: '工作日 10:00', prompt: '每个工作日上午 10 点，汇总当前仓库未关闭的 PR、审查状态和需要我关注的事项。请先确认仓库与时区，再创建定时任务。' },
  { name: '依赖项更新检查', description: '扫描过时的软件包、安全补丁和破坏性变更。', frequency: '每星期二 09:00', prompt: '每周二早上 9 点，检查当前项目的过时依赖、安全补丁和破坏性变更，生成更新建议，不自动修改文件。请先确认范围与时区，再创建定时任务。' },
  { name: '发布说明起草器', description: '汇总近期合并的 PR，起草面向用户的发布说明。', frequency: '每星期五 16:00', prompt: '每周五下午 4 点，汇总当前仓库本周合并的 PR，起草面向用户的发布说明。请先确认仓库与时区，再创建定时任务。' },
  { name: '不稳定测试跟踪器', description: '找出近期 CI 运行中时而通过、时而失败的测试。', frequency: '每天 10:00', prompt: '每天上午 10 点，检查当前项目近期的 CI 运行，找出时而通过、时而失败的测试，附上证据和排查建议。请先确认仓库与时区，再创建定时任务。' },
];

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
export function mountSchedulePage(document: Document, report: (error: unknown) => void, prepareNewTask?: () => void): Disposer {
  let page: HTMLElement | null = null;
  let cleanup: Disposer = () => {};
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
    if (next !== page) { cleanup(); cleanup = () => {}; page = next; }
    if (!page) return;
    const heading = page.querySelector('h1');
    const content = heading?.parentElement?.parentElement;
    if (!content || content.children.length < 4) return;
    if (!page.hasAttribute('data-ccd-schedule')) {
      const owner = page;
      const owned: Element[] = [];
      const tagged: Element[] = [];
      const tag = (el: Element, name: string) => { el.setAttribute('data-ccd-schedule-part', name); tagged.push(el); };
      const [headingBlock, filters, search, list] = Array.from(content.children);
      if (!headingBlock || !filters || !search || !list) return;
      owner.setAttribute('data-ccd-schedule', 'mine');
      tag(content, 'content'); tag(headingBlock, 'heading'); tag(filters, 'filters'); tag(search, 'search'); tag(list, 'list');
      let usingTemplate = false;
      const prepare = (event: Event) => {
        if (usingTemplate || !(event.target instanceof Element)) return;
        const button = event.target.closest('button');
        if (button?.matches('[data-ccd-schedule-part="new"], [data-ccd-schedule-part="empty"] button')) prepareNewTask?.();
      };
      owner.addEventListener('click', prepare, true);
      const nativeNew = headingBlock.querySelector('button');
      if (nativeNew) tag(nativeNew, 'new');
      const toolbar = document.createElement('div');
      toolbar.className = 'ccd-schedule-toolbar';
      const tabs = document.createElement('div'); tabs.className = 'ccd-schedule-tabs'; tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '任务视图');
      for (const [id, name] of [['mine', '我的'], ['templates', '模板']]) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = name!;
        button.setAttribute('aria-pressed', String(id === 'mine'));
        button.onclick = () => {
          owner.setAttribute('data-ccd-schedule', id!);
          for (const tab of tabs.children) tab.setAttribute('aria-pressed', String(tab === button));
          owner.removeAttribute('data-ccd-filter-open');
          toolbar.querySelector('[aria-label="筛选任务"]')?.setAttribute('aria-expanded', 'false');
        };
        tabs.append(button);
      }
      toolbar.append(tabs);
      const input = search.querySelector<HTMLInputElement>('input');
      const originalPlaceholder = input?.getAttribute('placeholder') ?? null;
      if (input) input.placeholder = '搜索计划任务…';
      const filterTitle = document.createElement('div');
      filterTitle.className = 'ccd-schedule-filter-title';
      filterTitle.textContent = '状态';
      filters.prepend(filterTitle); owned.push(filterTitle);
      const closeSearch = () => {
        // Use the host's controlled clear action rather than changing its input DOM.
        search.querySelector<HTMLButtonElement>('button:not(.ccd-schedule-search-close)')?.click();
        owner.removeAttribute('data-ccd-search-open');
        const trigger = toolbar.querySelector<HTMLButtonElement>('[aria-label="搜索任务"]');
        trigger?.setAttribute('aria-expanded', 'false'); trigger?.focus();
      };
      const searchClose = document.createElement('button');
      searchClose.type = 'button'; searchClose.className = 'ccd-schedule-search-close';
      searchClose.setAttribute('aria-label', '关闭搜索');
      searchClose.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>';
      searchClose.onclick = closeSearch;
      search.append(searchClose); owned.push(searchClose);
      const originalFilterStyle = filters.getAttribute('style');
      const positionFilter = () => {
        if (!owner.hasAttribute('data-ccd-filter-open')) return;
        const trigger = toolbar.querySelector('[aria-label="筛选任务"]');
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
      for (const [id, name] of [['search', '搜索任务'], ['filter', '筛选任务']] as const) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'ccd-schedule-tool';
        button.setAttribute('aria-label', name); button.title = name; button.setAttribute('aria-expanded', 'false');
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
      const templates = document.createElement('section'); templates.className = 'ccd-schedule-templates'; templates.setAttribute('aria-label', '定时任务模板');
      for (const [index, template] of SCHEDULE_TEMPLATES.entries()) {
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
          const dialog = document.createElement('dialog'); dialog.className = 'ccd-schedule-preview';
          const title = document.createElement('h2'); title.textContent = template.name; title.id = 'ccd-schedule-preview-title'; dialog.setAttribute('aria-labelledby', title.id);
          const hint = document.createElement('p'); hint.textContent = '复制提示词后，在新会话中粘贴并发送，确认范围和时间后创建任务。';
          const prompt = document.createElement('textarea'); prompt.value = template.prompt; prompt.setAttribute('aria-label', '创建任务提示词');
          const use = document.createElement('button'); use.type = 'button'; use.textContent = '复制并新建会话';
          const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; cancel.onclick = () => dialog.close();
          use.onclick = async () => {
            try {
              const clipboard = document.defaultView?.navigator.clipboard;
              if (!clipboard || !nativeNew) throw new Error('Task template clipboard or new-session action unavailable');
              await clipboard.writeText(prompt.value);
              dialog.close();
              usingTemplate = true;
              try { nativeNew.click(); } finally { usingTemplate = false; }
            }
            catch (error) { hint.textContent = '复制失败，请手动复制提示词，再点击页面的新建任务。'; report(error); }
          };
          dialog.append(title, hint, prompt, cancel, use); document.body.append(dialog); owned.push(dialog);
          dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
        };
        templates.append(card);
      }
      content.append(templates); owned.push(templates);
      const dismiss = (event: Event) => {
        if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
        if (event.type === 'pointerdown' && event.target instanceof Node && (filters.contains(event.target) || toolbar.contains(event.target))) return;
        const wasOpen = owner.hasAttribute('data-ccd-filter-open');
        owner.removeAttribute('data-ccd-filter-open');
        if (event instanceof KeyboardEvent && wasOpen) toolbar.querySelector<HTMLButtonElement>('[aria-label="筛选任务"]')?.focus();
        if (event instanceof KeyboardEvent && search.contains(event.target as Node)) closeSearch();
        toolbar.querySelector('[aria-label="筛选任务"]')?.setAttribute('aria-expanded', 'false');
      };
      const filterSelection = (event: Event) => {
        if (!(event.target instanceof Element) || !event.target.closest('button')) return;
        owner.removeAttribute('data-ccd-filter-open');
        const trigger = toolbar.querySelector<HTMLButtonElement>('[aria-label="筛选任务"]');
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
          || event.target.getAttribute('aria-label') !== '筛选任务') return;
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
        if (input?.getAttribute('placeholder') === '搜索计划任务…') {
          if (originalPlaceholder === null) input.removeAttribute('placeholder');
          else input.setAttribute('placeholder', originalPlaceholder);
        }
        owned.forEach(el => el.remove());
        for (const el of decorations) {
          if (el.classList.contains('ccd-schedule-stopwatch')) el.remove();
          else el.removeAttribute('data-ccd-schedule-part');
        }
        decorations.clear(); tagged.forEach(el => el.removeAttribute('data-ccd-schedule-part'));
        for (const name of ['data-ccd-schedule', 'data-ccd-search-open', 'data-ccd-filter-open']) owner.removeAttribute(name);
        for (const [node, { from, to }] of texts) if (node.data === to) node.data = from;
        texts.clear();
      };
    }
    label(heading ?? null, '定时任务');
    label(content.querySelector('[data-ccd-schedule-part="new"]'), '新建任务');
    const empty = content.querySelector('[role="status"]:has(h2):has(button)');
    if (empty && !empty.hasAttribute('data-ccd-schedule-part')) {
      empty.setAttribute('data-ccd-schedule-part', 'empty');
      const art = document.createElement('span'); art.className = 'ccd-schedule-stopwatch'; art.setAttribute('aria-hidden', 'true'); art.innerHTML = STOPWATCH; empty.prepend(art); decorations.add(art); decorations.add(empty);
    }
    const emptyTitle = empty?.querySelector('h2');
    if (emptyTitle?.textContent === '还没有自动化任务，在会话中创建的任务会显示在这里') label(emptyTitle, '暂无计划任务。');
    label(empty?.querySelector('button') ?? null, '新建任务');
    for (const node of texts.keys()) if (!node.isConnected) texts.delete(node);
  };
  const frames = frameScheduler(() => { try { sync(); } catch (error) { report(error); } }, document.defaultView);
  const observer = new MutationObserver(records => { if (!recordsInTranscript(records)) frames.schedule(); });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  try { sync(); } catch (error) { report(error); }
  return () => {
    observer.disconnect(); frames.cancel(); cleanup();
  };
}
