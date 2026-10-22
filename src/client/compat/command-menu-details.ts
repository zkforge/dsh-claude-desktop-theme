import type { Disposer } from '../contracts/ports.ts';
import { recordsInTranscript } from './mutation-scope.ts';

const MENU = '[data-trigger-menu]';
const ROW = `${MENU} [role="option"]`;
const COPY: Readonly<Record<string, string>> = {
  file: '添加文件或照片', goal: '为当前会话设定目标', plan: '创建计划任务，发送后执行',
  feedback: '发送反馈', compact: '压缩当前会话的上下文', permission: '调整当前会话的权限',
  permissions: '调整当前会话的权限', model: '选择当前会话使用的模型', export: '下载会话日志',
  effort: '调整模型的思考强度',
};

export function commandMenuDescription(token: string, source: string, description: string): string {
  // The native skill candidate carries its catalog/frontmatter description.
  // Preserve it in any language instead of replacing English metadata.
  if (source === 'skill' && description.trim()) return description.trim();
  if (source === 'command' && COPY[token]) return COPY[token];
  if (/[\u3400-\u9fff]/u.test(description)) return description;
  return source === 'skill' ? `运行「${token}」技能` : `执行 /${token} 命令`;
}

/** Native rows remain in their original order and retain their event handlers.
 * Group headings and the floating explanation are independent display nodes. */
export function mountCommandMenuDetails(document: Document, report: (error: unknown) => void): Disposer {
  const view = document.defaultView;
  if (!view) return () => {};
  const headings = new Map<HTMLElement, HTMLElement>();
  const marked = new Set<HTMLElement>();
  let tooltip: HTMLDivElement | null = null;
  let owner: HTMLElement | null = null;
  let describedBy: string | null = null;
  let timer: number | undefined;
  const sourceOf = (row: HTMLElement) => /^dsh-slash-option-(command|skill)-\d+$/u.exec(row.id)?.[1];
  const hide = () => {
    if (timer !== undefined) view.clearTimeout(timer);
    timer = undefined;
    tooltip?.remove(); tooltip = null;
    if (owner) {
      if (describedBy === null) owner.removeAttribute('aria-describedby');
      else owner.setAttribute('aria-describedby', describedBy);
    }
    owner = null;
  };
  const explain = (row: HTMLElement) => {
    const token = row.querySelector('[data-ccd-command-token]')?.textContent?.trim()
      ?? row.querySelector('[class$="_itemAlias"]')?.textContent?.trim()
      ?? row.querySelector('[class$="_itemName"]')?.textContent?.trim() ?? '';
    const source = sourceOf(row);
    if (!source) return '';
    return commandMenuDescription(token, source, row.querySelector('[class$="_itemDescription"]')?.textContent?.trim() ?? '');
  };
  const show = (row: HTMLElement) => {
    if (owner === row) return;
    hide(); owner = row; describedBy = row.getAttribute('aria-describedby');
    timer = view.setTimeout(() => {
      timer = undefined;
      if (!row.isConnected) { hide(); return; }
      const text = explain(row);
      if (!text) { hide(); return; }
      tooltip = document.createElement('div');
      tooltip.id = 'ccd-command-description';
      tooltip.setAttribute('data-ccd-command-tooltip', '');
      tooltip.setAttribute('role', 'tooltip');
      tooltip.setAttribute('popover', 'manual');
      tooltip.textContent = text;
      document.body.append(tooltip);
      tooltip.showPopover();
      row.setAttribute('aria-describedby', [describedBy, tooltip.id].filter(Boolean).join(' '));
      const rect = row.getBoundingClientRect(), bounds = tooltip.getBoundingClientRect();
      const right = rect.right + 8;
      tooltip.style.left = `${Math.max(8, right + bounds.width <= view.innerWidth - 8 ? right : rect.left - bounds.width - 8)}px`;
      tooltip.style.top = `${Math.max(8, Math.min(rect.top + (rect.height - bounds.height) / 2, view.innerHeight - bounds.height - 8))}px`;
    }, 250);
  };
  const enter = (event: Event) => {
    const row = (event.target as Element | null)?.closest<HTMLElement>(ROW);
    if (row) show(row);
  };
  const leave = (event: Event) => {
    const next = (event as MouseEvent).relatedTarget as Node | null;
    if (owner && (!next || !owner.contains(next))) hide();
  };
  const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
  const sync = () => {
    if (owner && !owner.isConnected) hide();
    for (const [row, heading] of headings) if (!row.isConnected) { heading.remove(); headings.delete(row); }
    for (const menu of marked) if (!menu.isConnected) marked.delete(menu);
    for (const menu of document.querySelectorAll<HTMLElement>(MENU)) {
      const first = new Map<string, HTMLElement>();
      for (const row of menu.querySelectorAll<HTMLElement>('[role="option"]')) {
        const source = sourceOf(row);
        if (source && !first.has(source)) first.set(source, row);
      }
      if (!first.size) {
        if (marked.delete(menu)) menu.removeAttribute('data-ccd-command-menu');
        for (const [row, heading] of headings) if (menu.contains(row)) {
          heading.remove(); headings.delete(row);
        }
        continue;
      }
      if (!menu.hasAttribute('data-ccd-command-menu')) {
        menu.setAttribute('data-ccd-command-menu', ''); marked.add(menu);
      }
      for (const [row, heading] of headings) if (menu.contains(row) && ![...first.values()].includes(row)) {
        heading.remove(); headings.delete(row);
      }
      for (const [source, row] of first) {
        let heading = headings.get(row);
        if (!heading) {
          heading = document.createElement('div');
          heading.setAttribute('role', 'presentation');
          heading.setAttribute('data-ccd-command-heading', '');
          headings.set(row, heading);
        }
        const label = source === 'command' ? '命令' : '技能';
        if (heading.textContent !== label) heading.textContent = label;
        if (row.previousElementSibling !== heading) row.before(heading);
      }
    }
  };
  const observer = new MutationObserver(records => {
    if (recordsInTranscript(records)) return;
    try { sync(); } catch (error) { report(error); }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener('mouseover', enter);
  document.addEventListener('mouseout', leave);
  document.addEventListener('focusin', enter);
  document.addEventListener('focusout', leave);
  document.addEventListener('keydown', key, true);
  document.addEventListener('scroll', hide, true);
  view.addEventListener('resize', hide);
  sync();
  return () => {
    observer.disconnect(); hide();
    document.removeEventListener('mouseover', enter);
    document.removeEventListener('mouseout', leave);
    document.removeEventListener('focusin', enter);
    document.removeEventListener('focusout', leave);
    document.removeEventListener('keydown', key, true);
    document.removeEventListener('scroll', hide, true);
    view.removeEventListener('resize', hide);
    for (const heading of headings.values()) heading.remove();
    for (const menu of marked) menu.removeAttribute('data-ccd-command-menu');
  };
}
