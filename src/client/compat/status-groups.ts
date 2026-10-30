import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsIntroduce, recordsTouch } from './mutation-scope.ts';

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
type SidebarGroup = 'pinned' | SessionGroup;
const GROUPS = ['pinned', 'input', 'working', 'ended'] as const;
const COLLAPSED_KEY = 'ccd-status-collapsed';

/** Collapsed sections are a per-window view preference; storage may be absent. */
function readCollapsed(storage: Storage | undefined): Set<SidebarGroup> {
  try {
    const value: unknown = JSON.parse(storage?.getItem(COLLAPSED_KEY) ?? '[]');
    return new Set(Array.isArray(value)
      ? GROUPS.filter(group => value.includes(group)) : []);
  } catch { return new Set(); }
}

/**
 * Present the host's flat rows in status sections. React-owned rows never leave
 * their parents: flex order and reading-flow supply visual and accessible order.
 * Native selection, hover cards, menus and rename handlers remain on those rows.
 * uiSession.sessionStatus is the root observable provided by ui-session in the
 * pinned app.asar; it does not acquire or activate any listed Session.
 */
export function mountStatusGroups(document: Document, ctx: Context,
  report: (error: unknown) => void): Disposer {
  const status = (ctx as Context & { uiSession?: { sessionStatus?: StatusStore } }).uiSession?.sessionStatus;
  if (!ctx.sessions?.list) return () => {};
  const workspaces = ctx.workspaces?.list;
  const host = hostSelectors(document);
  const win = document.defaultView!;
  const motion = win.matchMedia('(prefers-reduced-motion: reduce)');
  const owned = new Set<HTMLElement>();
  const saved = new Map<HTMLElement, Map<string, string | null>>();
  const animations = new Map<HTMLElement, Animation>();
  const orders = new Map<HTMLElement, { value: string; priority: string }>();
  const storage = (() => { try { return win.localStorage; } catch { return undefined; } })();
  const collapsed = readCollapsed(storage);
  let list: HTMLElement | null = null;
  let queued = false;
  let disposed = false;
  let dragging: HTMLElement | null = null;
  let gesture: {
    row: HTMLElement; pointerId: number; startX: number; startY: number;
    x: number; y: number; offsetX: number; offsetY: number;
    width: number; height: number; pinned: boolean; started: boolean;
    settling: boolean; target: 'pin' | 'unpin' | null;
  } | null = null;
  let floating: HTMLElement | null = null;
  let dropFrame: HTMLElement | null = null;
  let ignoreClick = false;
  let releasedRow: HTMLElement | null = null;
  const endDrag = () => {
    const previous = gesture;
    if (!previous) return;
    gesture = null;
    dragging?.removeAttribute('data-ccd-pin-dragging');
    dragging = null;
    floating?.remove(); floating = null;
    dropFrame?.remove(); dropFrame = null;
    document.documentElement.removeAttribute('data-ccd-pin-gesture');
    if (previous.row.hasPointerCapture(previous.pointerId)) previous.row.releasePointerCapture(previous.pointerId);
    if (previous.started) { releasedRow = previous.row; ignoreClick = true; schedule(); }
  };
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
    endDrag();
    stopAnimations();
    for (const node of owned) node.remove();
    owned.clear();
    for (const [node, values] of saved) restoreNode(node, values);
    saved.clear();
    list = null; releasedRow = null;
  };
  const observer = new MutationObserver(records => {
    /* The reordered rows all live in the flat list. A streaming transcript, a
       right-pane drag or the account menu cannot change a status or an order,
       so those batches end here rather than in a document-wide walk. */
    if (list !== null && list.isConnected && !recordsTouch(records, list) && !recordsIntroduce(records, host.browserFlatList)) return;
    schedule();
  });
  const observe = () => observer.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'lang', 'data-row-key', 'data-state', 'data-ccd-blank-session'],
  });
  /**
   * The subagent index, rebuilt only when the catalog publishes.
   *
   * `Object.values(catalog.byId)` over every Session is the widest walk in this
   * module, and it is a fact about the catalog: a native row changing state
   * cannot move a child to another parent.
   */
  let childrenDirty = true;
  type Catalog = ReturnType<typeof ctx.sessions.list.getSnapshot>;
  type Child = Catalog['byId'][keyof Catalog['byId']];
  let childrenByParent = new Map<string, Child[]>();
  const readChildren = (catalog: Catalog) => {
    if (!childrenDirty) return childrenByParent;
    childrenByParent = new Map();
    for (const child of Object.values(catalog.byId)) {
      if (child.origin !== 'subagent' || !child.parentId) continue;
      const children = childrenByParent.get(child.parentId) ?? [];
      children.push(child); childrenByParent.set(child.parentId, children);
    }
    childrenDirty = false;
    return childrenByParent;
  };
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
      // Cleanup must also run when the plan below is unchanged. React can
      // replace a wrapper or remove plugin decorations without changing rows.
      for (const [node, values] of saved) if (!node.isConnected || !list.contains(node)) {
        restoreNode(node, values); saved.delete(node);
      }
      for (const [node, animation] of animations) if (!node.isConnected || !list.contains(node)) {
        animation.cancel(); animations.delete(node);
      }
      for (const node of owned) if (!node.isConnected || !list.contains(node)) {
        node.remove(); owned.delete(node);
      }
      const catalog = ctx.sessions.list.getSnapshot();
      const statuses = status?.getSnapshot();
      const pinOrder = new Map<string, number>((workspaces?.getSnapshot().pinnedSessionIds ?? [])
        .map((id, index) => [id, index]));
      const childrenOf = readChildren(catalog);
      const zh = document.documentElement.lang.toLowerCase().startsWith('zh');
      const labels = zh ? ['已置顶', '需要输入', '处理中', '空闲'] : ['Pinned', 'Needs input', 'Working', 'Idle'];
      const rows = [...list.querySelectorAll<HTMLElement>('[data-row-key^="session:"]')]
        .filter(row => !row.hasAttribute('data-ccd-blank-session'));
      /* Plan every row before touching the document. The plan is a pure
         function of the catalogs and the rows, so a pass that changes nothing
         can stop here: no inline style, no layout read, no animation — which
         is what a native row's own status flip or a wrapper's class change
         costs on a long list. */
      const plan = rows.map(row => {
        const id = row.dataset.rowKey!.slice(8);
        const summary = catalog.byId[id as keyof typeof catalog.byId];
        const children = childrenOf.get(id) ?? [];
        const runningChild = children.some(child => statuses?.get(child.id)?.running ?? child.running);
        // Builds without the root sessionStatus source still render StateDot.
        // Read the native row's StateDot in that case; it already combines
        // pending input and running subagents without activating a Session.
        const ownStatus = statuses ? statuses.get(id) : {
          ...(row.querySelector(host.sessionNeedsInput)
            ? { pendingInteraction: { kind: 'native' } } : {}),
          running: !!row.querySelector(host.sessionWorking) || summary?.running,
        };
        const activity = sessionGroup({ ...ownStatus,
          running: (ownStatus?.running ?? summary?.running ?? false) || runningChild,
        }, false);
        const group: SidebarGroup = pinOrder.has(id) ? 'pinned' : activity;
        // A folded section still shows the Session the main panel is on.
        const hidden = collapsed.has(group) && !row.matches(host.sessionRowSelected);
        return { row, id, group, activity, children, hidden };
      });
      // The host pin set supplies the global order, independent of activity.
      plan.sort((a, b) => (pinOrder.get(a.id) ?? Infinity) - (pinOrder.get(b.id) ?? Infinity));
      const counts = [0, 0, 0, 0];
      const stride = (rows.length + 1) * 2;
      const orderedRows = plan.map(entry => {
        const index = GROUPS.indexOf(entry.group);
        return { ...entry, order: index * stride + (++counts[index]!) * 2 };
      });
      // When every Session is pinned, keep an Idle target for dragging one out.
      const onlyPins = counts[0]! > 0 && counts.slice(1).every(count => count === 0);
      const showPinHint = dragging !== null && gesture?.pinned === false;
      const hiddenHeadings = GROUPS.map((group, index) => group === 'pinned'
        ? counts[index] === 0 && dragging === null
        : counts[index] === 0 && !(group === 'ended' && onlyPins));
      const boxes = new Map<string, HTMLElement>();
      for (const node of owned) {
        const key = node.dataset.ccdStatusOwned;
        if (key !== undefined) boxes.set(key, node);
      }
      /* What this pass wants the document to say, compared with what it says
         now. The comparison itself is free of layout and of writes. */
      const signatures = new Map<string, string>();
      for (const { id, activity, children } of plan) {
        if (activity === 'working' && children.length > 0) {
          signatures.set(`children:${id}`, JSON.stringify(children.map(child => [child.id, child.displayTitle, child.running])));
        }
      }
      let changed = boxes.has('pin-hint') !== showPinHint;
      for (const { row, group, order, hidden } of orderedRows) {
        if (row.dataset.ccdStatusOrder !== String(order)
          || row.dataset.ccdStatusGroup !== group
          || row.style.getPropertyValue('--ccd-status-order') !== String(order)
          || row.getAttribute('tabindex') !== '0'
          || row.hasAttribute('data-ccd-status-hidden') !== hidden) { changed = true; break; }
        for (let parent = row.parentElement; parent && parent !== list; parent = parent.parentElement) {
          if (!parent.hasAttribute('data-ccd-status-wrapper')) { changed = true; break; }
        }
        if (changed) break;
      }
      if (!changed) {
        for (const [key, signature] of signatures) {
          if (boxes.get(key)?.dataset.signature !== signature) { changed = true; break; }
        }
      }
      if (!changed) {
        for (const [index, group] of GROUPS.entries()) {
          const heading = boxes.get(group);
          if (heading === undefined || heading.textContent !== labels[index]
            || heading.hasAttribute('hidden') !== hiddenHeadings[index]
            || heading.getAttribute('aria-expanded') !== String(!collapsed.has(group))) { changed = true; break; }
        }
      }
      if (!changed) {
        const live = new Set([...signatures.keys()]);
        for (const key of boxes.keys()) if (key.startsWith('children:') && !live.has(key)) { changed = true; break; }
      }
      if (!changed) { releasedRow = null; updateDrag(); return; }
      /* A row that moved is the only reason to read layout. The previous rects
         are taken now, after the decision, so an unchanged pass never asks the
         engine to flush. */
      const animateLayout = !motion.matches && !document.hidden;
      const before = animateLayout ? new Map(rows.map(row => [row, row.getBoundingClientRect()])) : null;
      let layoutChanged = false;
      remember(list, 'data-ccd-status-list', '');
      const ordered: HTMLElement[] = [];
      for (const { row, id, group, activity, order, children, hidden } of orderedRows) {
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
        if (row.style.getPropertyValue('--ccd-status-order') !== String(order)) {
          row.style.setProperty('--ccd-status-order', String(order));
        }
        remember(row, 'tabindex', '0');
        if (row.hasAttribute('data-ccd-status-hidden') !== hidden) layoutChanged = true;
        remember(row, 'data-ccd-status-hidden', hidden ? '' : null);
        ordered.push(row);
        const childKey = `children:${id}`;
        let childBox = boxes.get(childKey);
        if (activity === 'working' && children.length) {
          if (!childBox) {
            layoutChanged = true;
            childBox = document.createElement('div');
            childBox.className = 'ccd-status-children';
            childBox.dataset.ccdStatusOwned = childKey;
            childBox.setAttribute('role', 'group');
            owned.add(childBox); list.append(childBox);
          }
          if (childBox.style.order !== String(order + 1)) childBox.style.order = String(order + 1);
          if (childBox.hasAttribute('hidden') !== hidden) {
            if (hidden) childBox.setAttribute('hidden', ''); else childBox.removeAttribute('hidden');
          }
          const childLabel = zh ? '子任务' : 'Subagents';
          if (childBox.getAttribute('aria-label') !== childLabel) childBox.setAttribute('aria-label', childLabel);
          const signature = signatures.get(childKey)!;
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
        let heading = boxes.get(group);
        if (!heading) {
          layoutChanged = true;
          heading = document.createElement('button');
          heading.className = 'ccd-status-heading'; heading.dataset.ccdStatusOwned = group;
          heading.setAttribute('type', 'button');
          owned.add(heading); list.append(heading);
        }
        if (heading.style.order !== String(index * stride)) heading.style.order = String(index * stride);
        if (heading.textContent !== labels[index]) heading.textContent = labels[index]!;
        // Keep the pin destination and the all-pinned fallback reachable.
        if (heading.hasAttribute('hidden') !== hiddenHeadings[index]) {
          layoutChanged = true;
          if (hiddenHeadings[index]) heading.setAttribute('hidden', ''); else heading.removeAttribute('hidden');
        }
        const expanded = String(!collapsed.has(group));
        if (heading.getAttribute('aria-expanded') !== expanded) heading.setAttribute('aria-expanded', expanded);
      }
      let hint = boxes.get('pin-hint');
      if (showPinHint) {
        if (!hint) {
          layoutChanged = true;
          hint = document.createElement('div');
          hint.className = 'ccd-pin-hint'; hint.dataset.ccdStatusOwned = 'pin-hint';
          hint.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5 13.5 6.5 11 8l-.5 3.5-1 1-3-3-3-3 1-1L8 5l1.5-2.5ZM6.5 9.5 3 13"/></svg><span></span>';
          owned.add(hint); list.append(hint);
        }
        hint.style.order = String(counts[0]! * 2 + 1);
      } else if (hint) { layoutChanged = true; hint.remove(); owned.delete(hint); }
      const liveIds = new Set(rows.map(row => `children:${row.dataset.rowKey!.slice(8)}`));
      for (const node of owned) if (node.dataset.ccdStatusOwned?.startsWith('children:')
        && !liveIds.has(node.dataset.ccdStatusOwned)) { layoutChanged = true; node.remove(); owned.delete(node); }
      if (layoutChanged) {
        stopAnimations();
      }
      if (layoutChanged && before !== null) for (const row of ordered) {
        const previous = before.get(row)!;
        const rect = row.getBoundingClientRect();
        const dy = previous.top - rect.top;
        // The floating row lands directly in its new slot; it must not also
        // fly across the list from its old section after the Host confirms.
        if (row === dragging || row === releasedRow || !dy || !previous.height || typeof row.animate !== 'function') continue;
        const animation = row.animate([{ translate: `0 ${dy}px` }, { translate: '0 0' }],
          { duration: dragging ? 160 : 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
        animations.set(row, animation);
        animation.onfinish = () => { if (animations.get(row) === animation) animations.delete(row); };
      }
      releasedRow = null; updateDrag();
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
    if (event.key === 'Escape' && gesture) { event.preventDefault(); endDrag(); return; }
    const target = event.target as HTMLElement;
    if (!list?.contains(target) || !target.matches('[data-ccd-status-order]')) return;
    const rows = [...list.querySelectorAll<HTMLElement>('[data-ccd-status-order]')]
      .filter(row => !row.hasAttribute('data-ccd-status-hidden'))
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
  // Headings are plugin-owned buttons; one delegated listener survives their
  // re-creation and leaves nothing on the nodes when the view is restored.
  const toggle = (event: MouseEvent) => {
    const heading = (event.target as Element | null)?.closest?.<HTMLElement>('.ccd-status-heading');
    const group = heading?.dataset.ccdStatusOwned as SidebarGroup | undefined;
    if (!heading || !owned.has(heading) || !group || !GROUPS.includes(group)) return;
    if (!collapsed.delete(group)) collapsed.add(group);
    try { storage?.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])); } catch { /* view-only */ }
    schedule();
  };
  // The reference uses a pointer-driven overlay, not an OS drag image: it
  // becomes a compact red unpin pill as soon as it leaves the pinned section.
  function updateDrag() {
    const active = gesture;
    if (!active?.started || !list || !floating || !dropFrame) return;
    if (!active.row.isConnected) { endDrag(); return; }
    if (active.settling) { floating.hidden = true; dropFrame.hidden = true; return; }
    const headings = [...owned].filter(node => node.className === 'ccd-status-heading' && !node.hidden)
      .sort((a, b) => Number(a.style.order) - Number(b.style.order));
    const heading = headings.find(node => node.dataset.ccdStatusOwned === 'pinned');
    if (!heading) return;
    const start = heading.getBoundingClientRect();
    const pinNodes = [heading, ...list.querySelectorAll<HTMLElement>('[data-ccd-status-group="pinned"], [data-ccd-status-owned="pin-hint"]')];
    const bottom = Math.max(...pinNodes.map(node => node.getBoundingClientRect().bottom)) + 4;
    const area = list.getBoundingClientRect();
    const withinList = active.x >= area.left && active.x <= area.right
      && active.y >= area.top - 4 && active.y <= area.bottom;
    const inPinned = withinList && active.y <= bottom;
    active.target = withinList ? (inPinned ? (active.pinned ? null : 'pin') : (active.pinned ? 'unpin' : null)) : null;
    const unpin = active.target === 'unpin';
    floating.dataset.action = unpin ? 'unpin' : 'move';
    const title = floating.querySelector<HTMLElement>('[data-ccd-pin-title]')!;
    const warning = floating.querySelector<HTMLElement>('[data-ccd-pin-warning]')!;
    title.hidden = unpin; warning.hidden = !unpin;
    floating.style.width = unpin ? 'max-content' : `${active.width}px`;
    floating.style.left = `${active.x - (unpin ? floating.offsetWidth / 2 : active.offsetX)}px`;
    floating.style.top = `${active.y - (unpin ? floating.offsetHeight / 2 : active.offsetY)}px`;
    dropFrame.hidden = active.target !== 'pin';
    dropFrame.style.left = `${start.left}px`; dropFrame.style.top = `${start.top - 4}px`;
    dropFrame.style.width = `${start.width}px`; dropFrame.style.height = `${bottom - start.top + 4}px`;
    const hint = [...owned].find(node => node.dataset.ccdStatusOwned === 'pin-hint');
    if (hint) {
      const zh = document.documentElement.lang.toLowerCase().startsWith('zh');
      const text = active.target === 'pin' ? (zh ? '松开' : 'Release') : (zh ? '拖放到此处' : 'Drop here');
      const label = hint.querySelector('span')!;
      if (label.textContent !== text) label.textContent = text;
    }
  }
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary || gesture?.settling) return;
    ignoreClick = false;
    const target = event.target as Element | null;
    if (target?.closest('button, input, textarea, select, a, [contenteditable="true"]')) return;
    const row = target?.closest<HTMLElement>('[data-ccd-status-order]');
    if (!row || !list?.contains(row)) return;
    endDrag();
    const rect = row.getBoundingClientRect();
    gesture = { row, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
      width: rect.width, height: rect.height, pinned: row.dataset.ccdStatusGroup === 'pinned',
      started: false, settling: false, target: null };
  };
  const pointerMove = (event: PointerEvent) => {
    const active = gesture;
    if (!active || active.pointerId !== event.pointerId || active.settling) return;
    active.x = event.clientX; active.y = event.clientY;
    if (!active.started) {
      if (Math.hypot(active.x - active.startX, active.y - active.startY) < 5) return;
      active.started = true; dragging = active.row; stopAnimations();
      active.row.setPointerCapture(active.pointerId);
      active.row.setAttribute('data-ccd-pin-dragging', '');
      document.documentElement.setAttribute('data-ccd-pin-gesture', '');
      floating = document.createElement('div'); floating.className = 'ccd-pin-floating';
      floating.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span'); title.dataset.ccdPinTitle = '';
      const id = active.row.dataset.rowKey!.slice(8) as keyof ReturnType<typeof ctx.sessions.list.getSnapshot>['byId'];
      title.textContent = ctx.sessions.list.getSnapshot().byId[id]?.displayTitle ?? active.row.textContent;
      const warning = document.createElement('span'); warning.dataset.ccdPinWarning = ''; warning.hidden = true;
      warning.textContent = document.documentElement.lang.toLowerCase().startsWith('zh')
        ? '松开以取消置顶' : 'Release to unpin';
      floating.append(title, warning);
      dropFrame = document.createElement('div'); dropFrame.className = 'ccd-pin-target-frame';
      dropFrame.setAttribute('aria-hidden', 'true'); dropFrame.hidden = true;
      document.body.append(dropFrame, floating);
      schedule();
    }
    event.preventDefault(); event.stopPropagation();
    updateDrag();
  };
  const pointerUp = (event: PointerEvent) => {
    const active = gesture;
    if (!active || active.pointerId !== event.pointerId || active.settling) return;
    if (!active.started) { endDrag(); return; }
    event.preventDefault(); event.stopPropagation(); ignoreClick = true;
    updateDrag();
    if (!active.target) { endDrag(); return; }
    active.settling = true; updateDrag();
    const id = active.row.dataset.rowKey!.slice(8) as Parameters<typeof ctx.uiWorkspace.pinSession>[0];
    const action = active.target === 'pin' ? ctx.uiWorkspace.pinSession(id) : ctx.uiWorkspace.unpinSession(id);
    for (const node of owned) if (node.dataset.ccdStatusOwned === 'pin-error') { node.remove(); owned.delete(node); }
    void action.catch(error => {
      report(error);
      if (disposed || !list?.isConnected) return;
      const notice = document.createElement('div');
      notice.className = 'ccd-pin-error'; notice.dataset.ccdStatusOwned = 'pin-error';
      notice.setAttribute('role', 'alert'); notice.style.order = '1';
      notice.textContent = document.documentElement.lang.toLowerCase().startsWith('zh')
        ? '置顶更新失败，请重试。' : 'Could not update pin. Please try again.';
      owned.add(notice); list.append(notice);
    }).finally(() => { if (gesture === active) endDrag(); });
  };
  const preventNativeDrag = (event: DragEvent) => {
    if (list?.contains(event.target as Node)) { event.preventDefault(); event.stopPropagation(); }
  };
  const preventDragClick = (event: MouseEvent) => {
    if (!ignoreClick) return;
    ignoreClick = false; event.preventDefault(); event.stopPropagation();
  };
  const cancelPointer = (event: PointerEvent) => { if (gesture?.pointerId === event.pointerId) endDrag(); };
  const visibility = () => { stopAnimations(); if (document.hidden) endDrag(); };
  const offStatus = status?.subscribe(schedule);
  const offPins = workspaces?.subscribe(schedule);
  /* The catalog is what the subagent index is built from, so its publish is
     what invalidates it. */
  const offList = ctx.sessions.list.subscribe(() => { childrenDirty = true; schedule(); });
  document.addEventListener('keydown', keydown);
  document.addEventListener('click', toggle);
  document.addEventListener('pointerdown', pointerDown, true);
  document.addEventListener('pointermove', pointerMove, true);
  document.addEventListener('pointerup', pointerUp, true);
  document.addEventListener('pointercancel', cancelPointer, true);
  document.addEventListener('click', preventDragClick, true);
  document.addEventListener('dragstart', preventNativeDrag, true);
  document.addEventListener('scroll', updateDrag, true);
  win.addEventListener?.('blur', endDrag);
  win.addEventListener?.('resize', endDrag);
  document.addEventListener('visibilitychange', visibility);
  motion.addEventListener?.('change', stopAnimations);
  observe(); sync();
  return () => {
    disposed = true; observer.disconnect(); offList(); offStatus?.(); offPins?.();
    document.removeEventListener('keydown', keydown);
    document.removeEventListener('click', toggle);
    document.removeEventListener('pointerdown', pointerDown, true);
    document.removeEventListener('pointermove', pointerMove, true);
    document.removeEventListener('pointerup', pointerUp, true);
    document.removeEventListener('pointercancel', cancelPointer, true);
    document.removeEventListener('click', preventDragClick, true);
    document.removeEventListener('dragstart', preventNativeDrag, true);
    document.removeEventListener('scroll', updateDrag, true);
    win.removeEventListener?.('blur', endDrag);
    win.removeEventListener?.('resize', endDrag);
    document.removeEventListener('visibilitychange', visibility);
    motion.removeEventListener?.('change', stopAnimations);
    restore();
  };
}
