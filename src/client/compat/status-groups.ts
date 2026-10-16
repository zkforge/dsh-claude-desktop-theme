import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

export type SessionGroup = 'input' | 'working' | 'ended';
export interface SessionStatus {
  readonly running?: boolean;
  readonly pendingInteraction?: { readonly kind: string };
}
interface StatusStore {
  getSnapshot(): ReadonlyMap<string, SessionStatus>;
  subscribe(listener: () => void): Disposer;
}
/** Pending interaction takes precedence over live work, as in DSH's own rows. */
export function sessionGroup(status: SessionStatus | undefined, running: boolean): SessionGroup {
  if (status?.pendingInteraction) return 'input';
  return (status?.running ?? running) ? 'working' : 'ended';
}
const GROUPS = ['input', 'working', 'ended'] as const;

/**
 * Present the host's flat rows in status sections. React-owned rows never leave
 * their parents: flex order and reading-flow supply visual and accessible order.
 * Native selection, hover cards, menus and rename handlers remain on those rows.
 * uiSession.sessionStatus is the root observable provided by ui-session in the
 * pinned app.asar; it does not acquire or activate any listed Session.
 */
export function mountStatusGroups(document: Document, ctx: Context, showEmpty: boolean,
  report: (error: unknown) => void): Disposer {
  const status = (ctx as Context & { uiSession?: { sessionStatus?: StatusStore } }).uiSession?.sessionStatus;
  if (!status || !ctx.sessions?.list) return () => {};
  const host = hostSelectors(document);
  const win = document.defaultView!;
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const owned = new Set<HTMLElement>();
  const saved = new Map<HTMLElement, Map<string, string | null>>();
  const animations = new Map<HTMLElement, Animation>();
  const orders = new Map<HTMLElement, { value: string; priority: string }>();
  let list: HTMLElement | null = null;
  let queued = false;
  let disposed = false;
  const stopAnimations = () => {
    for (const animation of animations.values()) animation.cancel();
    animations.clear();
  };
  const restoreNode = (node: HTMLElement, values: Map<string, string | null>) => {
    for (const [key, value] of values) {
      if (value === null) node.removeAttribute(key); else node.setAttribute(key, value);
    }
    const original = orders.get(node);
    if (original?.value) node.style.setProperty('--ccd-status-order', original.value, original.priority);
    else if (original) node.style.removeProperty('--ccd-status-order');
    orders.delete(node);
  };
  const remember = (node: HTMLElement, key: string, value: string | null) => {
    let values = saved.get(node);
    if (!values) { values = new Map(); saved.set(node, values); }
    if (!values.has(key)) values.set(key, node.getAttribute(key));
    if (value === null) node.removeAttribute(key);
    else if (node.getAttribute(key) !== value) node.setAttribute(key, value);
  };
  const restore = () => {
    stopAnimations();
    for (const node of owned) node.remove();
    owned.clear();
    for (const [node, values] of saved) restoreNode(node, values);
    saved.clear();
    list = null;
  };
  const observer = new MutationObserver(() => schedule());
  const observe = () => observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'lang', 'data-row-key', 'data-ccd-blank-session'],
  });
  const sync = () => {
    queued = false;
    if (disposed) return;
    observer.disconnect();
    try {
      // Search has its own result list; group only the verified flat view.
      const next = document.querySelector<HTMLElement>(host.browserFlatList);
      if (next !== list) restore();
      if (!next) return;
      list = next;
      const catalog = ctx.sessions.list.getSnapshot();
      const statuses = status.getSnapshot();
      const childrenByParent = new Map<string, (typeof catalog.byId)[keyof typeof catalog.byId][]>();
      for (const child of Object.values(catalog.byId)) {
        if (child.origin !== 'subagent' || !child.parentId) continue;
        const children = childrenByParent.get(child.parentId) ?? [];
        children.push(child); childrenByParent.set(child.parentId, children);
      }
      const zh = document.documentElement.lang.toLowerCase().startsWith('zh');
      const labels = zh ? ['需要输入', '进行中', '已结束'] : ['Needs input', 'Working', 'Ended'];
      const rows = [...list.querySelectorAll<HTMLElement>('[data-row-key^="session:"]')]
        .filter(row => !row.hasAttribute('data-ccd-blank-session'));
      const before = new Map(rows.map(row => [row, row.getBoundingClientRect()]));
      let layoutChanged = false;
      remember(list, 'data-ccd-status-list', '');
      const counts = [0, 0, 0];
      const stride = (rows.length + 1) * 2;
      const ordered: HTMLElement[] = [];
      for (const row of rows) {
        const id = row.dataset.rowKey!.slice(8);
        const summary = catalog.byId[id as keyof typeof catalog.byId];
        const children = childrenByParent.get(id) ?? [];
        const runningChild = children.some(child => statuses.get(child.id)?.running ?? child.running);
        const ownStatus = statuses.get(id);
        const group = sessionGroup({ ...ownStatus,
          running: (ownStatus?.running ?? summary?.running ?? false) || runningChild,
        }, false);
        const index = GROUPS.indexOf(group);
        const order = index * stride + (++counts[index]!) * 2;
        if (row.dataset.ccdStatusOrder !== String(order)) layoutChanged = true;
        remember(row, 'data-ccd-status-order', String(order));
        remember(row, 'data-ccd-status-group', group);
        // The HoverCard wrapper may be display:contents already. Mark only the
        // ancestor chain of this row, never a menu portal or React's root.
        for (let parent = row.parentElement; parent && parent !== list; parent = parent.parentElement) {
          remember(parent, 'data-ccd-status-wrapper', '');
        }
        if (!orders.has(row)) orders.set(row, {
          value: row.style.getPropertyValue('--ccd-status-order'),
          priority: row.style.getPropertyPriority('--ccd-status-order'),
        });
        row.style.setProperty('--ccd-status-order', String(order));
        remember(row, 'tabindex', '0');
        ordered.push(row);
        const childKey = `children:${id}`;
        let childBox = [...owned].find(node => node.dataset.ccdStatusOwned === childKey);
        if (group === 'working' && children.length) {
          if (!childBox) {
            layoutChanged = true;
            childBox = document.createElement('div');
            childBox.className = 'ccd-status-children';
            childBox.dataset.ccdStatusOwned = childKey;
            childBox.setAttribute('role', 'group');
            owned.add(childBox); list.append(childBox);
          }
          childBox.style.order = String(order + 1);
          childBox.setAttribute('aria-label', zh ? '子任务' : 'Subagents');
          const signature = JSON.stringify(children.map(child => [child.id, child.displayTitle, child.running]));
          if (childBox.dataset.signature !== signature) {
            layoutChanged = true;
            childBox.dataset.signature = signature;
            childBox.replaceChildren(...children.map(child => {
              const button = document.createElement('button');
              button.type = 'button'; button.textContent = child.displayTitle;
              button.title = child.displayTitle;
              button.addEventListener('click', () => ctx.uiWorkspace.openSession(child.id));
              return button;
            }));
          }
        } else if (childBox) { layoutChanged = true; owned.delete(childBox); childBox.remove(); }
      }
      for (const [index, group] of GROUPS.entries()) {
        let heading = [...owned].find(node => node.dataset.ccdStatusOwned === group);
        if (counts[index] || showEmpty) {
          if (!heading) {
            layoutChanged = true;
            heading = document.createElement('div');
            heading.className = 'ccd-status-heading'; heading.dataset.ccdStatusOwned = group;
            heading.setAttribute('role', 'presentation');
            owned.add(heading); list.append(heading);
          }
          heading.style.order = String(index * stride);
          if (heading.textContent !== labels[index]) heading.textContent = labels[index]!;
        } else if (heading) { layoutChanged = true; owned.delete(heading); heading.remove(); }
      }
      const liveIds = new Set(rows.map(row => `children:${row.dataset.rowKey!.slice(8)}`));
      for (const node of owned) if (node.dataset.ccdStatusOwned?.startsWith('children:')
        && !liveIds.has(node.dataset.ccdStatusOwned)) { layoutChanged = true; node.remove(); owned.delete(node); }
      if (layoutChanged) {
        stopAnimations();
      }
      if (layoutChanged && !motion.matches && !document.hidden) for (const row of ordered) {
        const previous = before.get(row)!;
        const rect = row.getBoundingClientRect();
        const dy = previous.top - rect.top;
        if (!dy || !previous.height || typeof row.animate !== 'function') continue;
        const animation = row.animate([{ translate: `0 ${dy}px` }, { translate: '0 0' }],
          { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
        animations.set(row, animation);
        animation.onfinish = () => { if (animations.get(row) === animation) animations.delete(row); };
      }
      for (const [node, values] of saved) if (!node.isConnected) {
        restoreNode(node, values); saved.delete(node);
      }
    } catch (error) { restore(); report(error); }
    finally { if (!disposed) observe(); }
  };
  function schedule() {
    if (queued || disposed) return;
    queued = true; queueMicrotask(sync);
  }
  // Status order must also be the keyboard order on Chromium versions without
  // reading-flow. Enter/Space forward the native row's own click.
  const keydown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (!list?.contains(target) || !target.matches('[data-ccd-status-order]')) return;
    const rows = [...list.querySelectorAll<HTMLElement>('[data-ccd-status-order]')]
      .sort((a, b) => Number(a.dataset.ccdStatusOrder) - Number(b.dataset.ccdStatusOrder));
    const index = rows.indexOf(target);
    let next: HTMLElement | undefined;
    if (event.key === 'ArrowDown') next = rows[(index + 1) % rows.length];
    if (event.key === 'ArrowUp') next = rows[(index - 1 + rows.length) % rows.length];
    if (event.key === 'Home') next = rows[0];
    if (event.key === 'End') next = rows.at(-1);
    if (next) { event.preventDefault(); next.focus(); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); target.click(); }
  };
  // Manual native DnD rewrites the saved account order, which is not the order
  // shown in this view. Keep that gesture for the project's original views.
  const drag = (event: DragEvent) => {
    if (list?.contains(event.target as Node)) { event.preventDefault(); event.stopPropagation(); }
  };
  const offStatus = status.subscribe(schedule);
  const offList = ctx.sessions.list.subscribe(schedule);
  document.addEventListener('keydown', keydown);
  document.addEventListener('dragstart', drag, true);
  document.addEventListener('visibilitychange', stopAnimations);
  motion.addEventListener?.('change', stopAnimations);
  observe(); sync();
  return () => {
    disposed = true; observer.disconnect(); offList(); offStatus();
    document.removeEventListener('keydown', keydown);
    document.removeEventListener('dragstart', drag, true);
    document.removeEventListener('visibilitychange', stopAnimations);
    motion.removeEventListener?.('change', stopAnimations);
    restore();
  };
}
