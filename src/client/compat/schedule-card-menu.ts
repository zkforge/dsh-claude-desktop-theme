import type { Disposer } from '../contracts/ports.ts';
import { prepareScheduleDeletion, type ScheduleDeletePort } from './schedule-delete-port.ts';

/** Add sibling controls without nesting buttons or replacing React-owned rows. */
export function mountScheduleCardMenus(document: Document, port: ScheduleDeletePort, report: (error: unknown) => void): Disposer {
  const controls = new Map<HTMLButtonElement, HTMLButtonElement>();
  let anchor: HTMLButtonElement | undefined;
  let selected: HTMLButtonElement | undefined;
  let dismissDialog: (() => void) | undefined;
  let active = true;
  const menu = document.createElement('div');
  menu.className = 'ccd-schedule-card-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '任务操作');
  menu.hidden = true;
  const remove = document.createElement('button');
  remove.type = 'button'; remove.setAttribute('role', 'menuitem');
  remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></svg><span>删除任务</span>';
  menu.append(remove);
  const close = (focus = false) => {
    menu.hidden = true;
    anchor?.setAttribute('aria-expanded', 'false');
    if (focus) anchor?.focus();
    anchor = undefined; selected = undefined;
  };
  remove.onclick = () => {
    const row = selected;
    if (!row || dismissDialog) return;
    const metadata = row.getAttribute('aria-describedby');
    const trigger = controls.get(row);
    close();
    const dialog = document.createElement('dialog');
    dialog.className = 'ccd-schedule-delete-dialog';
    dialog.setAttribute('aria-label', '删除定时任务？');
    const title = document.createElement('h2'); title.textContent = '删除定时任务？';
    const description = document.createElement('p');
    description.textContent = `删除“${row.getAttribute('aria-label') ?? '此任务'}”？其过往运行记录也将被删除。此操作无法撤销。原会话及其消息仍然保留。`;
    const notice = document.createElement('p'); notice.setAttribute('role', 'status');
    notice.textContent = '正在读取任务…';
    const actions = document.createElement('div'); actions.className = 'ccd-schedule-delete-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消';
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.textContent = '删除';
    confirm.className = 'ccd-schedule-delete-confirm'; confirm.disabled = true;
    actions.append(cancel, confirm); dialog.append(title, description, notice, actions);
    let busy = false;
    let closed = false;
    let prepared: Awaited<ReturnType<typeof prepareScheduleDeletion>> | undefined;
    const dismiss = () => {
      closed = true; dialog.close(); dialog.remove(); dismissDialog = undefined;
      if (active) {
        if (trigger?.isConnected) trigger.focus();
        else document.querySelector<HTMLElement>('[data-ccd-schedule-part="heading"] h1')?.focus();
      }
    };
    dismissDialog = dismiss;
    cancel.onclick = dismiss;
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!busy) dismiss(); });
    confirm.onclick = async () => {
      if (!prepared || busy || closed) return;
      busy = true; confirm.disabled = true; cancel.disabled = true;
      confirm.textContent = '正在删除…'; notice.textContent = '';
      try {
        await prepared.confirm();
        if (active && !closed) dismiss();
      } catch (error) {
        if (active && !closed) {
          report(error); notice.setAttribute('role', 'alert');
          notice.textContent = error instanceof Error ? error.message : '删除失败，请稍后重试';
          confirm.disabled = false; cancel.disabled = false; confirm.textContent = '删除';
        }
      } finally { busy = false; }
    };
    document.body.append(dialog); dialog.showModal(); cancel.focus();
    void (async () => {
      try {
        if (!metadata) throw new Error('无法识别任务，请刷新后重试');
        const result = await prepareScheduleDeletion(port, metadata);
        if (!active || closed) return;
        if (!row.isConnected || row.getAttribute('aria-describedby') !== metadata) throw new Error('任务已变化，请重新选择');
        prepared = result;
        description.textContent = `删除“${result.task.title}”？其过往运行记录也将被删除。此操作无法撤销。原会话及其消息仍然保留。`;
        notice.textContent = ''; confirm.disabled = false;
      } catch (error) {
        if (active && !closed) {
          report(error); notice.setAttribute('role', 'alert');
          notice.textContent = error instanceof Error ? error.message : '无法读取任务，请稍后重试';
        }
      }
    })();
  };
  const sync = () => {
    for (const [row, trigger] of controls) {
      if (!row.isConnected) {
        if (selected === row) close();
        trigger.remove(); controls.delete(row);
      }
    }
    for (const row of document.querySelectorAll<HTMLButtonElement>('[data-ccd-schedule-part="list"] > ul > li > button:not(.ccd-schedule-card-more)')) {
      if (controls.has(row)) continue;
      const trigger = document.createElement('button');
      trigger.className = 'ccd-schedule-card-more'; trigger.type = 'button';
      trigger.textContent = '⋮'; trigger.setAttribute('aria-label', `任务操作：${row.getAttribute('aria-label') ?? ''}`);
      trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
      trigger.onclick = () => {
        const wasOpen = anchor === trigger && !menu.hidden;
        close(); if (wasOpen) return;
        row.parentElement?.querySelector('.ccd-schedule-card-error')?.remove();
        if (!menu.isConnected) document.body.append(menu);
        anchor = trigger; selected = row;
        trigger.setAttribute('aria-expanded', 'true'); menu.hidden = false;
        const rect = trigger.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(rect.right - menu.offsetWidth, (document.defaultView?.innerWidth ?? rect.right) - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, (document.defaultView?.innerHeight ?? rect.bottom + menu.offsetHeight) - menu.offsetHeight - 8))}px`;
        remove.focus();
      };
      trigger.onkeydown = event => { if (event.key === 'ArrowDown') { event.preventDefault(); trigger.click(); } };
      row.parentElement?.append(trigger); controls.set(row, trigger);
    }
  };
  const outside = (event: Event) => {
    if (event.target instanceof Node && !menu.contains(event.target) && !anchor?.contains(event.target)) close();
  };
  const keys = (event: KeyboardEvent) => {
    if (menu.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    else if (event.key === 'Tab') close();
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); remove.focus(); }
  };
  const reposition = () => close();
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', keys, true);
  document.addEventListener('scroll', reposition, true);
  document.defaultView?.addEventListener('resize', reposition);
  sync();
  return () => {
    active = false; observer.disconnect(); dismissDialog?.(); close(); menu.remove();
    for (const [row, trigger] of controls) { trigger.remove(); row.parentElement?.querySelector('.ccd-schedule-card-error')?.remove(); }
    controls.clear();
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', keys, true);
    document.removeEventListener('scroll', reposition, true);
    document.defaultView?.removeEventListener('resize', reposition);
  };
}
