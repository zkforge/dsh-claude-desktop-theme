import type { Disposer } from '../contracts/ports.ts';
import { taskForMetadata, type ScheduleDetailPort, type ScheduleTask } from './schedule-detail-port.ts';
import { scheduleCopy } from './schedule-locales.ts';

const ROWS = '[data-ccd-schedule-part="list"] > ul > li > button:not(.ccd-schedule-card-more)';

/** Wall-clock label relative to today: 今天 9:51 / 明天 9:51 / 10月25日 9:51. */
export function scheduleTimeLabel(iso: string, now = new Date(), language: 'zh' | 'en' = 'zh'): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const time = `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`;
  const day = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const offset = Math.round((day(at) - day(now)) / 86_400_000);
  if (language === 'en') {
    const relative = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : offset === -1 ? 'Yesterday' : null;
    const date = relative ?? new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } as const : {}),
    }).format(at);
    return `${date} ${time}`;
  }
  if (offset === 0) return `今天 ${time}`;
  if (offset === 1) return `明天 ${time}`;
  if (offset === -1) return `昨天 ${time}`;
  const year = at.getFullYear() === now.getFullYear() ? '' : `${at.getFullYear()}年`;
  return `${year}${at.getMonth() + 1}月${at.getDate()}日 ${time}`;
}

/** The native summary's frequency is the one metadata span without a <time>;
 * an ended task puts its status span first. */
function frequencyOf(row: Element): string {
  const spans = Array.from(row.querySelectorAll(':scope > span > span + span > span')).filter(span => !span.querySelector('time'));
  return spans.at(-1)?.textContent?.trim() ?? '';
}

/** Replace the native side panel with a full-page task view: card clicks are
 * taken in the capture phase, so React never selects the row. The view is a
 * sibling the plugin owns; the native list pane is only hidden by CSS. */
export function mountScheduleDetail(document: Document, port: ScheduleDetailPort, report: (error: unknown) => void): Disposer {
  let records: readonly ScheduleTask[] = [];
  let view: { page: Element; root: HTMLElement; task: ScheduleTask; row: HTMLElement; token: number; localize(): void } | undefined;
  let token = 0;
  let active = true;
  const prompts = new Set<HTMLElement>();

  const close = (focus = true) => {
    if (!view) return;
    const { page, root, row } = view;
    view = undefined;
    root.remove(); page.removeAttribute('data-ccd-schedule-detail');
    if (focus && row.isConnected) row.focus();
  };

  const section = (title: string, body: Node) => {
    const block = document.createElement('section'); block.className = 'ccd-schedule-detail-field';
    const heading = document.createElement('h2'); heading.textContent = title;
    block.append(heading, body);
    return block;
  };

  const renderHistory = async (list: HTMLElement, task: ScheduleTask, mine: number) => {
    try {
      const history = await port.history(task);
      if (!active || view?.token !== mine) return;
      list.replaceChildren();
      if (history.records.length === 0) {
        const empty = document.createElement('p'); empty.className = 'ccd-schedule-detail-empty'; empty.textContent = scheduleCopy(document).emptyHistory;
        empty.setAttribute('data-ccd-history-state', 'empty');
        list.append(empty); return;
      }
      for (const record of history.records) {
        const item = document.createElement('li');
        const time = document.createElement('time'); time.dateTime = record.deliveredAt;
        time.textContent = scheduleTimeLabel(record.deliveredAt, new Date(), document.documentElement.lang.toLowerCase().startsWith('zh') ? 'zh' : 'en');
        item.append(time); list.append(item);
      }
    } catch (error) {
      if (!active || view?.token !== mine) return;
      report(error);
      const failure = document.createElement('p'); failure.className = 'ccd-schedule-detail-empty'; failure.setAttribute('role', 'alert');
      failure.textContent = error instanceof Error ? error.message : scheduleCopy(document).historyError;
      list.replaceChildren(failure);
    }
  };

  const open = (row: HTMLElement, task: ScheduleTask) => {
    const page = row.closest('[data-testid="task-manager-page"]');
    if (!page) return;
    close(false);
    const mine = ++token;
    const root = document.createElement('div'); root.className = 'ccd-schedule-detail';
    root.setAttribute('role', 'region'); root.setAttribute('aria-label', task.title);

    const crumbs = document.createElement('nav'); crumbs.className = 'ccd-schedule-detail-crumbs';
    const back = document.createElement('button'); back.type = 'button'; back.onclick = () => close();
    const divider = document.createElement('span'); divider.textContent = '/'; divider.setAttribute('aria-hidden', 'true');
    const current = document.createElement('span'); current.textContent = task.title; current.setAttribute('aria-current', 'page');
    crumbs.append(back, divider, current);

    const header = document.createElement('header'); header.className = 'ccd-schedule-detail-header';
    const title = document.createElement('h1'); title.textContent = task.title; title.tabIndex = -1;
    const next = document.createElement('p');
    header.append(title, next);

    const body = document.createElement('div'); body.className = 'ccd-schedule-detail-body';
    const history = document.createElement('ul'); history.className = 'ccd-schedule-detail-history';
    const loading = document.createElement('p'); loading.className = 'ccd-schedule-detail-empty';
    loading.setAttribute('data-ccd-history-state', 'loading');
    history.append(loading);
    const historyBlock = section('', history); historyBlock.classList.add('ccd-schedule-detail-records');
    const aside = document.createElement('div'); aside.className = 'ccd-schedule-detail-aside';
    const prompt = document.createElement('p'); prompt.className = 'ccd-schedule-detail-prompt'; prompt.textContent = task.prompt;
    const frequency = document.createElement('p'); frequency.textContent = frequencyOf(row);
    const promptBlock = section('', prompt), frequencyBlock = section('', frequency);
    aside.append(promptBlock, frequencyBlock);
    body.append(historyBlock, aside);

    root.append(crumbs, header, body);
    page.append(root); page.setAttribute('data-ccd-schedule-detail', '');
    const text = (element: Element, value: string) => { if (element.textContent !== value) element.textContent = value; };
    const localize = () => {
      const copy = scheduleCopy(document);
      const language = document.documentElement.lang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
      crumbs.setAttribute('aria-label', copy.location);
      text(back, copy.title);
      text(next, task.status === 'active' ? copy.nextRun(scheduleTimeLabel(task.scheduledAt, new Date(), language)) : copy.ended);
      text(historyBlock.querySelector('h2')!, copy.history);
      text(promptBlock.querySelector('h2')!, copy.prompt);
      text(frequencyBlock.querySelector('h2')!, copy.frequency);
      text(frequency, frequencyOf(row));
      for (const status of history.querySelectorAll('[data-ccd-history-state]')) {
        text(status, status.getAttribute('data-ccd-history-state') === 'loading' ? copy.loadingHistory : copy.emptyHistory);
      }
      for (const time of history.querySelectorAll('time')) text(time, scheduleTimeLabel(time.dateTime, new Date(), language));
    };
    localize();
    view = { page, root, task, row, token: mine, localize };
    title.focus();
    void renderHistory(history, task, mine);
  };

  const intercept = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>(ROWS);
    if (!row || row.closest('[data-ccd-schedule-native]')) return;
    event.preventDefault(); event.stopPropagation();
    const metadata = row.getAttribute('aria-describedby') ?? '';
    const task = taskForMetadata(records, metadata);
    if (task) { open(row, task); return; }
    // The catalog may not have arrived yet; resolve once, never guess by title.
    void port.list().then(list => {
      records = list;
      const found = taskForMetadata(list, metadata);
      if (active && found && row.isConnected) open(row, found);
    }, report);
  };

  const keys = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !view || event.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault(); event.stopPropagation(); close();
  };

  const decorate = () => {
    for (const prompt of prompts) if (!prompt.isConnected) prompts.delete(prompt);
    for (const row of document.querySelectorAll<HTMLElement>(ROWS)) {
      if (row.closest('[data-ccd-schedule-native]')) continue;
      const heading = row.querySelector<HTMLElement>(':scope > span > span:first-child');
      if (!heading) continue;
      const task = taskForMetadata(records, row.getAttribute('aria-describedby') ?? '');
      let line = heading.nextElementSibling as HTMLElement | null;
      if (!line?.classList.contains('ccd-schedule-card-prompt')) {
        if (!task) continue;
        line = document.createElement('span'); line.className = 'ccd-schedule-card-prompt';
        heading.after(line); prompts.add(line);
      }
      const text = task?.prompt.replace(/\s+/g, ' ').trim() ?? '';
      if (line.textContent !== text) line.textContent = text;
    }
    if (view) {
      const fresh = records.find(task => task.id === view!.task.id);
      if (!view.page.isConnected || !view.row.isConnected || (records.length > 0 && !fresh)) close(false);
      else view.localize();
    }
  };

  const refresh = () => {
    port.list().then(list => { if (active) { records = list; decorate(); } }, report);
  };

  const observer = new MutationObserver(decorate);
  observer.observe(document.body, { childList: true, subtree: true });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  document.addEventListener('click', intercept, true);
  document.addEventListener('keydown', keys, true);
  let unsubscribe: () => void = () => {};
  try { unsubscribe = port.subscribe(refresh); } catch (error) { report(error); }
  refresh();
  return () => {
    active = false; observer.disconnect(); unsubscribe(); close(false);
    document.removeEventListener('click', intercept, true);
    document.removeEventListener('keydown', keys, true);
    for (const prompt of prompts) prompt.remove();
    prompts.clear();
  };
}
