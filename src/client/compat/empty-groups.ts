import type { Disposer, SidebarSessionsPort, ViewOptionsSettingsPort } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

/**
 * Workspaces with nothing to show, kept out of the sidebar.
 *
 * The `显示空分组` row in the view-options card writes `view.showEmptyGroups`,
 * whose default is off: a Workspace whose rows are all hidden by the current
 * filter disappears from the column instead of standing there as a heading over
 * nothing. With no durable history, all headings give way to a welcome prompt
 * even if empty groups are enabled. DSH has no such setting of its own — the host draws one empty state
 * for the whole tree (`EmptySessions`, `data-row-key="empty"`, rendered only
 * when there are no groups at all), never one per Workspace — so this is the
 * plugin's own behaviour and this module is where it is decided.
 *
 * A group is the `WorkspaceBrowser` box that holds one Workspace's row, its
 * nested groups and its Session rows (`._7514NG_groupSection`). It is empty
 * when nothing under it is a row the reader can see:
 *
 * - a Session row keeps it (except one `compat/blank-session-rows.ts` already
 *   hides — a provisional New Session is not something to show a group for);
 * - the `overflow:` row ("Show {n} more sessions") keeps it, because it is the
 *   host saying there are more rows behind it;
 * - a nested group's Sessions count, which is why the test walks the whole
 *   subtree rather than the direct children;
 * - collapsed membership comes from the host catalogs and native filter;
 *   while those are loading, an unknown collapsed Workspace stays reachable.
 *
 * The marker is an attribute the sidebar sheet turns into `display: none`. It is
 * written after the commit that drew the rows, which is the one thing about this
 * module worth knowing: the host measures its keyed rows inside that commit
 * (`blank-session-rows.ts` records the 200 ms glide that follows a late change),
 * so a group hidden here can arrive with the rows below it already placed. The
 * plugin's own default makes this the common path, so the first paint is checked
 * on a real machine; if it shows, the fix is to write the same attribute from
 * the previous pass's answer before the rows mount, not to move this test.
 *
 * @param document - renderer document carrying the sidebar.
 * @param hideEmpty - whether empty groups are being kept out (the config's
 *   `view.showEmptyGroups`, inverted).
 * @param report - sink for observer failures; the column stays as the host drew it.
 * @returns disposer that disconnects the observer and clears every marker.
 */
export function mountEmptyGroups(
  document: Document,
  hideEmpty: boolean,
  report: (error: unknown) => void,
  options: {
    source?: SidebarSessionsPort | null;
    settings?: ViewOptionsSettingsPort;
    showAll?: () => void;
  } = {},
): Disposer {
  const host = hostSelectors(document);
  let scheduled = 0;
  let observer: MutationObserver | undefined;
  const marked = new Set<HTMLElement>();
  let emptyState: HTMLElement | null = null;
  let emptyArea: HTMLElement | null = null;
  const unsubscribes: Disposer[] = [];
  let disposed = false;

  /** The row keys that keep one group on screen. */
  const keepsGroup = (group: HTMLElement, populated: ReadonlySet<string> | null): boolean => {
    for (const row of group.querySelectorAll<HTMLElement>('[data-row-key]')) {
      const key = row.getAttribute('data-row-key') ?? '';
      if (key.startsWith('workspace:') && row.getAttribute('aria-expanded') === 'false') {
        if (populated === null || populated.has(key.slice('workspace:'.length))) return true;
      }
      if (key.startsWith('overflow:')) return true;
      if (!key.startsWith('session:')) continue;
      if (row.hasAttribute('data-ccd-blank-session')) continue;
      return true;
    }
    return false;
  };

  const clearEmptyState = () => {
    emptyState?.remove();
    emptyState = null;
    emptyArea?.removeAttribute('data-ccd-list-empty');
    emptyArea = null;
  };

  const renderEmptyState = (area: HTMLElement | null, empty: boolean, noHistory: boolean) => {
    if (!empty || area === null) { clearEmptyState(); return; }
    const kind = noHistory ? 'new' : 'filtered';
    if (emptyArea !== area || !emptyState?.isConnected || emptyState.getAttribute('data-ccd-empty-state') !== kind) {
      clearEmptyState();
      const zh = (document.documentElement.lang || globalThis.navigator?.language || '').toLowerCase().startsWith('zh');
      emptyState = document.createElement('div');
      emptyState.className = 'ccd-sidebar-empty';
      emptyState.setAttribute('data-ccd-empty-state', kind);
      emptyState.setAttribute('role', 'status');
      const message = document.createElement('div');
      message.textContent = noHistory
        ? (zh ? '你发起的会话会显示在这里' : 'Sessions you start will show up here')
        : (zh ? '没有符合当前筛选条件的会话' : 'No sessions match the current filters');
      emptyState.append(message);
      if (noHistory) {
        const pixels = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        pixels.classList.add('ccd-sidebar-empty-pixels');
        pixels.setAttribute('viewBox', '0 0 88 80');
        pixels.setAttribute('aria-hidden', 'true');
        // Two quiet pixel blooms, matching the reference's stepped stems.
        pixels.innerHTML = '<path opacity=".24" d="M50 0h10v10H50zM40 10h10v10H40zM60 10h10v10H60zM50 20h10v10H50z"/><path opacity=".15" d="M15 20h10v10H15zM5 30h10v10H5zM15 30h10v10H15zM25 30h10v10H25zM15 40h10v10H15zM60 30h5v10h-5zM75 20h5v20h-5zM65 40h10v10H65z"/><path opacity=".1" d="M25 50h5v10h-5zM30 60h5v10h-5zM35 70h5v10h-5zM60 50h5v10h-5zM55 60h5v10h-5zM50 70h5v10h-5z"/>';
        emptyState.append(pixels);
      }
      if (!noHistory && options.showAll !== undefined) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = zh ? '显示所有会话' : 'Show all sessions';
        button.addEventListener('click', options.showAll);
        emptyState.append(button);
      }
      emptyArea = area;
      area.setAttribute('data-ccd-list-empty', '');
      area.prepend(emptyState);
    }
  };

  const clear = () => {
    for (const node of marked) node.removeAttribute('data-ccd-empty-group');
    marked.clear();
    clearEmptyState();
  };

  const sync = () => {
    scheduled = 0;
    if (disposed) return;
    const noHistory = options.source?.hasHistory() === false;
    const wanted = new Set<HTMLElement>();
    const preferences = options.settings?.getSnapshot();
    const populated = options.source?.populatedGroups(
      preferences?.groups[2]?.selected ?? null,
      preferences?.groups[0]?.selected === 1,
    ) ?? null;
    const groups = document.querySelectorAll<HTMLElement>(host.workspaceGroup);
    for (const group of groups) {
      if (noHistory || (hideEmpty && !keepsGroup(group, populated))) wanted.add(group);
    }
    /* Only the difference is written: this pass runs on every mutation batch,
       and re-marking a group the sheet already hides is churn for nothing. */
    for (const node of marked) {
      if (wanted.has(node)) continue;
      node.removeAttribute('data-ccd-empty-group');
      marked.delete(node);
    }
    for (const node of wanted) {
      if (marked.has(node)) continue;
      node.setAttribute('data-ccd-empty-group', '');
      marked.add(node);
    }
    const area = document.querySelector<HTMLElement>(host.browserListArea);
    // Do not replace search/loading UI. A native empty row, or a complete set
    // of groups hidden by our rule, establishes that the session tree is empty.
    const flatRows = area?.querySelectorAll<HTMLElement>('[data-row-key^="session:"], [data-row-key^="overflow:"]');
    const flatEmpty = flatRows !== undefined && flatRows.length > 0
      && [...flatRows].every(row => row.hasAttribute('data-ccd-blank-session'));
    const empty = groups.length > 0
      ? wanted.size === groups.length
      : area !== null && (area.querySelector('[data-row-key="empty"]') !== null || flatEmpty);
    renderEmptyState(area, empty, noHistory);
  };

  /** One microtask batch, run synchronously from the observer callback. */
  const schedule = () => {
    if (scheduled !== 0) return;
    scheduled = 1;
    try {
      sync();
    } finally {
      scheduled = 0;
    }
  };

  try {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      // Host expansion/current-row changes and the blank-session adapter can
      // change membership without inserting a row. Our own marker is excluded.
      attributeFilter: ['data-row-key', 'aria-expanded', 'aria-selected', 'data-ccd-blank-session'],
    });
    if (options.source) unsubscribes.push(options.source.subscribe(schedule));
    if (options.settings) unsubscribes.push(options.settings.subscribe(schedule));
    sync();
  } catch (error) {
    observer?.disconnect();
    for (const off of unsubscribes.splice(0)) off();
    clear();
    report(error);
  }

  return () => {
    disposed = true;
    scheduled = 0;
    observer?.disconnect();
    for (const off of unsubscribes.splice(0)) off();
    clear();
  };
}
