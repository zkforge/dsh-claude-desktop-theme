import type { Context } from '@deepseek-ai/cordis';
import type { Disposer, SidebarRightPort, SidebarTabRecord } from '../contracts/ports.ts';
import { mountPaneChrome, type PaneChrome } from './pane-chrome.ts';
import { hostSelectors } from './host-dom.ts';
import { EMPTY_LAYOUT, reconcilePanes, resizePanes, tilePanes, type PaneLayout, type PaneRect, type PaneSeam } from './pane-tiles.ts';

/** DockLayout can only render two horizontal dock panes. Its floating leaves
 * have no such limit: retain those host-rendered bodies and controls, and give
 * them session-owned column geometry. No React-owned node is reparented. */
export const PANES_ATTRIBUTE = 'data-ccd-panes';
export const PANE_ATTRIBUTE = 'data-ccd-pane';
export const SEAM_ATTRIBUTE = 'data-ccd-pane-seam';
export const SEAM_AXIS_ATTRIBUTE = 'data-ccd-pane-axis';
export const SEAM_INDEX_ATTRIBUTE = 'data-ccd-pane-seam-index';
export const DRAGGING_ATTRIBUTE = 'data-ccd-pane-dragging';
export const PANE_LEFT_PROPERTY = '--ccd-pane-left';
export const PANE_TOP_PROPERTY = '--ccd-pane-top';
export const PANE_WIDTH_PROPERTY = '--ccd-pane-width';
export const PANE_HEIGHT_PROPERTY = '--ccd-pane-height';
const GAP = 12;
const HEADER = 32;
const INACTIVE = 'data-ccd-pane-inactive';
const TREE = 'data-ccd-pane-tree';
const PREVIEW = 'data-ccd-pane-preview';
const JOINED = 'data-ccd-files-combined';
const LEADING = 'data-ccd-pane-leading';
const COMPACT = 'data-ccd-files-compact';
const TREE_WIDTH = '--ccd-files-tree-width';
const FILE_GROUP = 'files';
const TERMINAL_GROUP = 'terminals';
const EXPANDED = 'data-ccd-pane-expanded';

interface SessionState {
  layout: PaneLayout;
  preview: string | null;
  terminal: string | null;
  terminals: Set<string>;
  previews: Set<string>;
  fileShare: number;
  maximized: string | null;
  requestedFiles: boolean;
  hadViews: boolean;
  active: string | null;
}
interface Group {
  readonly id: string;
  readonly tabs: readonly string[];
  readonly tree?: string;
  readonly preview?: string;
  readonly terminal?: string;
}
interface Boundary {
  readonly key: string;
  readonly seam: PaneSeam;
  readonly extent: number;
  readonly minimum: number;
  readonly files: boolean;
  readonly value: number;
}
interface Placement {
  readonly root: HTMLElement;
  readonly session: string;
  readonly boundaries: readonly Boundary[];
}
interface Drag {
  readonly boundary: Boundary;
  readonly placement: Placement;
  readonly pointer: number;
  readonly origin: number;
  readonly layout: PaneLayout;
  readonly fileShare: number;
  readonly controller: AbortController;
}

export function mountRightPanes(ctx: Context, document: Document, report: (error: unknown) => void): Disposer {
  const registration = ctx.inject(['sidebarRight'], scope => {
    const sidebar = (scope as Context & { sidebarRight?: SidebarRightPort }).sidebarRight;
    if (typeof sidebar?.float !== 'function' || typeof sidebar.dock !== 'function') return () => {};
    return createRightPanes(document, sidebar, report);
  });
  return () => { void registration.dispose(); };
}

function createRightPanes(document: Document, sidebar: SidebarRightPort, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const sessions = new Map<string, SessionState>();
  const floated = new Map<string, Set<string>>();
  const asked = new Set<string>();
  const owned = new Set<HTMLElement>();
  const seams = new Map<string, HTMLElement>();
  const controls = new Map<HTMLElement, PaneChrome>();
  let placement: Placement | null = null;
  let observed: HTMLElement | null = null;
  let dragging: Drag | null = null;
  let observer: MutationObserver | undefined;
  let resize: ResizeObserver | undefined;
  let unsubscribe: Disposer = () => {};
  let disposed = false;
  let syncing = false;
  let queued = false;
  const zh = () => (document.documentElement.lang || globalThis.navigator?.language || '').toLowerCase().startsWith('zh');

  const stateOf = (session: string): SessionState => {
    let state = sessions.get(session);
    if (state === undefined) {
      state = { layout: EMPTY_LAYOUT, preview: null, terminal: null, terminals: new Set(), previews: new Set(), fileShare: 0.4, maximized: null, requestedFiles: false, hadViews: false, active: null };
      sessions.set(session, state);
    }
    return state;
  };
  const panelOnScreen = (): HTMLElement | null => [...document.querySelectorAll<HTMLElement>(host.rightbarPanel)]
    .find(panel => panel.closest('[hidden]') === null) ?? null;
  const sessionOf = (panel: HTMLElement): string | null => panel.closest(host.rightbarSession)?.getAttribute('data-sidebar-right-session') ?? null;
  const setAttribute = (node: HTMLElement, name: string, value: string) => {
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  };
  const setProperty = (node: HTMLElement, name: string, value: string) => {
    if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
  };
  const isFile = (record: SidebarTabRecord) => record.kind === 'text' && record.contentId?.startsWith('dsh-resource://file/') === true;

  const groupsOf = (records: readonly SidebarTabRecord[], state: SessionState, active: string | null): Group[] => {
    const tree = records.find(record => record.kind === 'files');
    const previews = records.filter(isFile).map(record => record.tabId);
    const newest = previews.filter(id => !state.previews.has(id)).at(-1);
    if (newest !== undefined) state.preview = newest;
    else if (active !== null && active !== state.active && previews.includes(active)) state.preview = active;
    if (state.preview === null || !previews.includes(state.preview)) state.preview = previews.at(-1) ?? null;
    state.previews = new Set(previews);
    const terminalIds = records.filter(record => record.kind === 'terminal').map(record => record.tabId);
    const addedTerminal = terminalIds.filter(id => !state.terminals.has(id)).at(-1);
    if (addedTerminal !== undefined) state.terminal = addedTerminal;
    else if (active !== null && active !== state.active && terminalIds.includes(active)) state.terminal = active;
    if (state.terminal === null || !terminalIds.includes(state.terminal)) state.terminal = terminalIds.at(-1) ?? null;
    state.terminals = new Set(terminalIds);
    const groups: Group[] = [];
    let terminalsAdded = false;
    let filesAdded = false;
    for (const record of records) {
      if (record.kind === 'guide') continue;
      if (record.kind === 'terminal') {
        if (!terminalsAdded) { groups.push({ id: TERMINAL_GROUP, tabs: terminalIds, ...(state.terminal === null ? {} : { terminal: state.terminal }) }); terminalsAdded = true; }
      } else if (tree !== undefined && (record.tabId === tree.tabId || isFile(record))) {
        if (!filesAdded) {
          groups.push({ id: FILE_GROUP, tabs: [tree.tabId, ...previews], tree: tree.tabId,
            ...(state.preview === null ? {} : { preview: state.preview }) });
          filesAdded = true;
        }
      } else groups.push({ id: record.tabId, tabs: [record.tabId] });
    }
    return groups;
  };

  const place = (node: HTMLElement, id: string, rect: PaneRect) => {
    owned.add(node);
    setAttribute(node, PANE_ATTRIBUTE, id);
    setProperty(node, PANE_LEFT_PROPERTY, `${rect.x}px`);
    setProperty(node, PANE_TOP_PROPERTY, `${rect.y}px`);
    setProperty(node, PANE_WIDTH_PROPERTY, `${rect.width}px`);
    setProperty(node, PANE_HEIGHT_PROPERTY, `${rect.height}px`);
  };
  const clearNode = (node: HTMLElement) => {
    for (const attr of [PANE_ATTRIBUTE, INACTIVE, TREE, PREVIEW, JOINED, LEADING, COMPACT]) node.removeAttribute(attr);
    for (const property of [PANE_LEFT_PROPERTY, PANE_TOP_PROPERTY, PANE_WIDTH_PROPERTY, PANE_HEIGHT_PROPERTY, TREE_WIDTH]) node.style.removeProperty(property);
    controls.get(node)?.release();
    controls.delete(node);
    owned.delete(node);
  };
  const endDrag = () => {
    if (dragging === null) return;
    dragging.controller.abort();
    dragging.placement.root.removeAttribute(DRAGGING_ATTRIBUTE);
    dragging = null;
  };
  const clear = () => {
    endDrag();
    placement = null;
    for (const node of [...owned]) clearNode(node);
    for (const node of seams.values()) node.remove();
    seams.clear();
    for (const root of document.querySelectorAll<HTMLElement>(`[${PANES_ATTRIBUTE}]`)) root.removeAttribute(PANES_ATTRIBUTE);
    for (const panel of document.querySelectorAll(`[${EXPANDED}]`)) panel.removeAttribute(EXPANDED);
  };

  /** Exact reference chrome; native bodies and the close control stay intact. */
  const decorate = (node: HTMLElement, group: Group, root: HTMLElement, state: SessionState, records: readonly SidebarTabRecord[]) => {
    let chrome = controls.get(node);
    if (chrome === undefined) {
      const created = mountPaneChrome(node);
      if (created === null) return;
      chrome = created;
      controls.set(node, chrome);
    }
    const record = records.find(record => record.tabId === node.getAttribute('data-dockkit-content'));
    const filesRoot = group.tree === undefined ? null : root.querySelector<HTMLElement>(`[data-dockkit-content="${group.tree}"] [data-files-root]`);
    const filename = (id: string) => {
      let value = records.find(record => record.tabId === id)?.contentId?.split('/').at(-1) ?? id;
      try { value = decodeURIComponent(value); } catch { /* Keep malformed paths readable. */ }
      return value;
    };
    const workspace = root.querySelector('[data-files-root]')?.getAttribute('data-files-root')?.split('/').filter(Boolean).at(-1)
      ?? document.querySelector('[data-row-key^="workspace:"]')?.textContent?.trim() ?? '';
    const kind = record?.kind ?? '';
    const nativeTitle = node.querySelector('[data-dockkit-tab-title]')?.textContent?.trim() ?? '';
    const terminalName = nativeTitle && !/^(?:zsh|bash|fish|pwsh|powershell|cmd|终端|terminal)$/iu.test(nativeTitle) && nativeTitle !== record?.tabId ? nativeTitle : workspace;
    const title = kind === 'files' ? 'Files' : kind === 'terminal' ? `Terminal${terminalName ? ` ${terminalName}` : ''}`
      : group.preview ? filename(group.preview) : node.querySelector('[data-dockkit-tab-title]')?.textContent?.trim() ?? '';
    chrome.update({ kind, title, filesRoot, zoomed: state.maximized === group.id,
      panel: root.closest<HTMLElement>(host.rightbarPanel)!,
      onZoom: () => {
        state.maximized = state.maximized === group.id ? null : group.id;
        sidebar.focus(group.terminal ?? group.preview ?? group.tree ?? group.tabs[0]!);
        endDrag(); schedule();
      },
      onNew: () => sidebar.openTab('terminal'),
      closeTabs: group.tabs,
      onSelect: id => { if (group.id === TERMINAL_GROUP) state.terminal = id; else state.preview = id; sidebar.focus(id); schedule(); },
      onClose: id => {
        const close = root.querySelector<HTMLButtonElement>(`[data-dockkit-content="${id}"] [data-dockkit-float-close]`);
        if (close) { close.setAttribute('data-ccd-close-tab', ''); close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); close.removeAttribute('data-ccd-close-tab'); }
      },
      terminals: group.id === TERMINAL_GROUP ? group.tabs.map((id, index) => ({ id, title: group.tabs.length > 1 ? `Terminal ${index + 1}${workspace ? ` ${workspace}` : ''}` : title, selected: id === group.terminal })) : [],
      files: group.tabs.filter(id => id !== group.tree && records.find(record => record.tabId === id)?.kind === 'text')
        .map(id => ({ id, title: filename(id), selected: id === group.preview })),
    });
  };

  const placeSeams = (root: HTMLElement, boundaries: readonly Boundary[]) => {
    const live = new Set<string>();
    for (const boundary of boundaries) {
      const { key, seam } = boundary;
      live.add(key);
      let node = seams.get(key);
      if (node === undefined) {
        node = document.createElement('div');
        node.setAttribute(SEAM_ATTRIBUTE, key);
        node.setAttribute('role', 'separator');
        node.tabIndex = 0;
        seams.set(key, node);
      }
      setAttribute(node, SEAM_AXIS_ATTRIBUTE, seam.axis);
      setAttribute(node, SEAM_INDEX_ATTRIBUTE, String(seam.index));
      setAttribute(node, 'aria-orientation', seam.axis === 'row' ? 'horizontal' : 'vertical');
      setAttribute(node, 'aria-label', zh() ? (boundary.files ? '调整文件树宽度' : '调整面板大小') : (boundary.files ? 'Resize file tree' : 'Resize panes'));
      setAttribute(node, 'aria-valuemin', String(Math.round(boundary.minimum * 100)));
      setAttribute(node, 'aria-valuemax', String(Math.round((1 - boundary.minimum) * 100)));
      setAttribute(node, 'aria-valuenow', String(Math.round(boundary.value * 100)));
      place(node, key, seam.rect);
      // Seams use geometry properties but are not view bodies.
      node.removeAttribute(PANE_ATTRIBUTE);
      owned.delete(node);
      if (node.parentElement !== root) root.append(node);
    }
    for (const [key, node] of seams) if (!live.has(key)) { node.remove(); seams.delete(key); }
  };

  const sync = () => {
    const panel = panelOnScreen();
    const root = panel?.querySelector<HTMLElement>(host.dockSurface) ?? null;
    const session = panel === null ? null : sessionOf(panel);
    if (root !== observed) {
      clear();
      resize?.disconnect();
      observed = root;
      if (root !== null) {
        for (const seam of root.querySelectorAll(`[${SEAM_ATTRIBUTE}]`)) seam.remove();
        resize?.observe(root);
        const frame = root.closest<HTMLElement>(host.frame);
        if (frame) resize?.observe(frame);
        const navigation = frame?.querySelector<HTMLElement>(host.sidebarColumn);
        if (navigation) resize?.observe(navigation);
      }
    }
    if (root === null || panel === null || session === null) return;
    const state = stateOf(session);
    const records = (sidebar.openTabs?.getSnapshot?.() ?? []).filter(record => record.sessionId === session);
    const active = root.querySelector<HTMLElement>('[data-dockkit-float-active]')?.getAttribute('data-dockkit-content') ?? null;
    const groups = groupsOf(records, state, active);
    const ids = groups.map(group => group.id);
    const activeGroup = groups.find(group => group.tabs.includes(active ?? ''));
    if (state.maximized !== null && active !== state.active && activeGroup !== undefined) state.maximized = activeGroup.id;
    state.active = active;
    if (state.maximized !== null) {
      const held = new Set(state.layout.columns.flatMap(column => column.ids));
      if (ids.some(id => !held.has(id))) state.maximized = null;
    }
    state.layout = reconcilePanes(state.layout, ids);
    if (state.maximized !== null && !ids.includes(state.maximized)) state.maximized = null;
    if (dragging !== null) {
      const oldIds = new Set(dragging.layout.columns.flatMap(column => column.ids));
      if (dragging.placement.session !== session || oldIds.size !== ids.length || ids.some(id => !oldIds.has(id))) endDrag();
    }
    if (groups.length === 0) {
      clear();
      if (state.hadViews && panel.hasAttribute('data-sidebar-right-open')) sidebar.toggleExpanded?.();
      state.hadViews = false;
      state.requestedFiles = false;
      return;
    }
    state.hadViews = true;
    if (records.some(isFile) && !records.some(record => record.kind === 'files') && !state.requestedFiles) {
      state.requestedFiles = true;
      try { sidebar.openTab('files'); } catch (error) { report(error); }
    }
    if (!records.some(isFile)) state.requestedFiles = false;
    const box = root.getBoundingClientRect();
    let area: PaneRect = { x: box.x, y: box.y, width: box.width, height: box.height };
    if (state.maximized !== null) {
      const frame = panel.closest<HTMLElement>(host.frame) ?? document.querySelector<HTMLElement>(host.frame);
      const frameBox = frame?.getBoundingClientRect();
      const navigation = frame?.querySelector<HTMLElement>(host.sidebarColumn)?.getBoundingClientRect();
      const center = frame?.querySelector<HTMLElement>(host.centerColumn)?.getBoundingClientRect();
      const left = navigation?.right ?? center?.left ?? frameBox?.left ?? 0;
      const windowsCaption = document.documentElement.hasAttribute('data-windows-titlebar') && !document.documentElement.hasAttribute('data-fullscreen')
        ? Number.parseFloat(document.documentElement.style.getPropertyValue('--dsh-windows-titlebar-height')) || 40 : 0;
      const top = Math.max(center?.top ?? frameBox?.top ?? 0, windowsCaption);
      area = { x: left + 8, y: top + 8, width: Math.max(0, (frameBox?.right ?? window.innerWidth) - left - 16), height: Math.max(0, (frameBox?.bottom ?? window.innerHeight) - top - 16) };
      setAttribute(panel, EXPANDED, '');
    } else panel.removeAttribute(EXPANDED);
    if (area.width <= 0 || area.height <= 0) return;
    const layout = tilePanes(area, state.layout, GAP);
    const boundaries: Boundary[] = state.maximized === null ? layout.seams.map(seam => {
      const column = state.layout.columns[seam.column];
      const extent = seam.axis === 'row' ? area.height - GAP * ((column?.ids.length ?? 1) - 1) : area.width - GAP;
      const value = seam.axis === 'row' ? (column?.sizes.slice(0, seam.index + 1).reduce((sum, size) => sum + size, 0) ?? 0.5) : state.layout.column;
      return { key: `${seam.axis}:${seam.column}:${seam.index}`, seam, extent, minimum: Math.min(0.15, (seam.axis === 'row' ? 96 : 160) / extent), files: false, value };
    }) : [];
    const nodes = new Map([...root.querySelectorAll<HTMLElement>(host.dockContent)].map(node => [node.getAttribute('data-dockkit-content') ?? '', node]));
    const liveNodes = new Set<HTMLElement>();
    const sessionFloats = floated.get(session) ?? new Set<string>();
    floated.set(session, sessionFloats);
    for (const group of groups) {
      const rect = state.maximized === group.id ? area : layout.rects.get(group.id);
      if (rect === undefined) continue;
      const hiddenGroup = state.maximized !== null && state.maximized !== group.id;
      const tree = group.tree === undefined ? undefined : nodes.get(group.tree);
      const preview = group.preview === undefined ? undefined : nodes.get(group.preview);
      // Leave the tree usable while React is committing the preview's float.
      const combined = tree !== undefined && preview?.hasAttribute('data-dockkit-float') === true;
      const treeHidden = tree?.querySelector('[data-files-root]')?.getAttribute('data-ccd-files-tree') === 'hidden';
      const compact = !combined && rect.width < 420;
      const width = treeHidden ? 0 : compact ? rect.width : Math.min(Math.max(140, rect.width * state.fileShare), Math.max(0, rect.width - 140));
      for (const tabId of group.tabs) {
        const node = nodes.get(tabId);
        if (node === undefined) continue;
        const treeNode = combined && tabId === group.tree;
        const paneRect = treeNode ? { x: rect.x + 1, y: rect.y + HEADER, width: Math.max(width, 1), height: Math.max(0, rect.height - HEADER - 1) } : rect;
        if (!node.hasAttribute('data-dockkit-float')) {
          const request = `${session}:${tabId}`;
          if (!asked.has(request)) {
            asked.add(request);
            try { sidebar.float?.(tabId, paneRect); sessionFloats.add(tabId); }
            catch (error) { asked.delete(request); report(error); }
          }
          continue;
        }
        asked.delete(`${session}:${tabId}`);
        liveNodes.add(node);
        place(node, group.id, paneRect);
        if (paneRect.x === area.x && paneRect.y === area.y) setAttribute(node, LEADING, ''); else node.removeAttribute(LEADING);
        const inactive = hiddenGroup || (treeNode && treeHidden) || (group.tree !== undefined && tabId !== group.tree && tabId !== group.preview) || (group.terminal !== undefined && tabId !== group.terminal);
        if (inactive) setAttribute(node, INACTIVE, ''); else node.removeAttribute(INACTIVE);
        if (treeNode) setAttribute(node, TREE, ''); else node.removeAttribute(TREE);
        if (combined && tabId === group.preview) {
          setAttribute(node, PREVIEW, '');
          setProperty(node, TREE_WIDTH, `${width}px`);
        } else { node.removeAttribute(PREVIEW); node.style.removeProperty(TREE_WIDTH); }
        const filesRoot = node.querySelector<HTMLElement>('[data-files-root]');
        if (filesRoot !== null) {
          if (combined) setAttribute(filesRoot, JOINED, ''); else filesRoot.removeAttribute(JOINED);
          if (compact) setAttribute(filesRoot, COMPACT, ''); else filesRoot.removeAttribute(COMPACT);
          setProperty(filesRoot, TREE_WIDTH, `${width}px`);
          owned.add(filesRoot);
        }
        if (!treeNode) decorate(node, group, root, state, records);
        else { controls.get(node)?.release(); controls.delete(node); }
      }
      if (tree !== undefined && !compact && !treeHidden && !hiddenGroup && width > 0) {
        boundaries.push({ key: 'files:tree', seam: { axis: 'column', column: 0, index: 0,
          rect: { x: rect.x + width - GAP / 2, y: rect.y + HEADER, width: GAP, height: Math.max(0, rect.height - HEADER) } },
          extent: rect.width, minimum: Math.min(0.4, 140 / rect.width), files: true, value: width / rect.width });
      }
    }
    for (const node of [...owned]) {
      if (node.matches('[data-files-root]')) {
        if (!node.isConnected || ![...liveNodes].some(pane => pane.contains(node))) clearNode(node);
      } else if (!liveNodes.has(node)) clearNode(node);
    }
    setAttribute(root, PANES_ATTRIBUTE, String(groups.length));
    placeSeams(root, boundaries);
    placement = { root, session, boundaries };
  };

  /** A service commit can notify synchronously from float(). Drain that work
   * after the current pass, and ignore our own marker/style mutations. */
  const schedule = () => {
    if (disposed) return;
    if (syncing) {
      if (!queued) {
        queued = true;
        queueMicrotask(() => { queued = false; schedule(); });
      }
      return;
    }
    syncing = true;
    try { sync(); } catch (error) { report(error); } finally { syncing = false; }
  };

  const boundaryUnder = (target: EventTarget | null): Boundary | undefined => {
    const node = target instanceof Element ? target.closest(`[${SEAM_ATTRIBUTE}]`) : null;
    return placement?.boundaries.find(boundary => boundary.key === node?.getAttribute(SEAM_ATTRIBUTE));
  };
  const moveBoundary = (state: SessionState, boundary: Boundary, fraction: number, layout: PaneLayout, fileShare: number) => {
    if (boundary.files) state.fileShare = Math.min(1 - boundary.minimum, Math.max(boundary.minimum, fileShare + fraction));
    else state.layout = resizePanes(layout, boundary.seam, fraction, boundary.minimum);
    schedule();
  };
  const onPointerMove = (event: PointerEvent) => {
    const held = dragging;
    if (held === null || held.pointer !== event.pointerId || held.boundary.extent <= 0) return;
    const coordinate = held.boundary.seam.axis === 'row' ? event.clientY : event.clientX;
    moveBoundary(stateOf(held.placement.session), held.boundary, (coordinate - held.origin) / held.boundary.extent, held.layout, held.fileShare);
  };
  const finishPointer = (event: PointerEvent) => { if (dragging?.pointer === event.pointerId) endDrag(); };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest('[data-ccd-files-switch]')) return;
    const boundary = boundaryUnder(event.target);
    if (boundary !== undefined && placement !== null) {
      event.preventDefault(); event.stopPropagation(); endDrag();
      const state = stateOf(placement.session);
      const controller = new AbortController();
      dragging = { boundary, placement, pointer: event.pointerId, origin: boundary.seam.axis === 'row' ? event.clientY : event.clientX,
        layout: state.layout, fileShare: state.fileShare, controller };
      placement.root.setAttribute(DRAGGING_ATTRIBUTE, '');
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(`[${SEAM_ATTRIBUTE}]`) : null;
      try { target?.setPointerCapture(event.pointerId); } catch { /* Synthetic pointers cannot be captured. */ }
      window.addEventListener('pointermove', onPointerMove, { signal: controller.signal });
      window.addEventListener('pointerup', finishPointer, { signal: controller.signal });
      window.addEventListener('pointercancel', finishPointer, { signal: controller.signal });
      window.addEventListener('blur', endDrag, { signal: controller.signal });
      return;
    }
    if (!(event.target instanceof Element) || event.target.closest('button, input, select, a') !== null) return;
    if (event.target.closest(host.dockFloatGrip)?.closest(`[${PANE_ATTRIBUTE}]`) !== null
      && event.target.closest(host.dockFloatGrip) !== null) {
      event.preventDefault(); event.stopPropagation();
    }
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest('[data-ccd-pane-menu], [data-ccd-browser-toolbar]')) return;
    if (event.target instanceof Element && event.target.closest('[data-ccd-files-switch]')) return;
    const boundary = boundaryUnder(event.target);
    if (boundary !== undefined && placement !== null) {
      const row = boundary.seam.axis === 'row';
      const direction = event.key === (row ? 'ArrowDown' : 'ArrowRight') ? 1 : event.key === (row ? 'ArrowUp' : 'ArrowLeft') ? -1 : 0;
      if (direction === 0 && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault(); event.stopPropagation();
      const state = stateOf(placement.session);
      const delta = event.key === 'Home' ? -1 : event.key === 'End' ? 1 : direction * (event.shiftKey ? 8 : 24) / boundary.extent;
      moveBoundary(state, boundary, delta, state.layout, state.fileShare);
    } else if (event.key === 'Escape' && placement !== null && stateOf(placement.session).maximized !== null
      && (!(event.target instanceof Element) || event.target.closest('input, textarea, select, [contenteditable]') === null)) {
      event.preventDefault(); event.stopPropagation();
      stateOf(placement.session).maximized = null;
      schedule();
    }
  };

  const release = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect(); resize?.disconnect(); unsubscribe();
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', schedule);
    const panel = panelOnScreen();
    const session = panel === null ? null : sessionOf(panel);
    clear();
    // dock() addresses the on-screen session. Never send another session's ids.
    if (panel !== null && session !== null) {
      for (const tab of floated.get(session) ?? []) {
        const node = [...panel.querySelectorAll<HTMLElement>(host.dockFloat)].find(node => node.getAttribute('data-dockkit-content') === tab);
        const paneId = node?.getAttribute('data-dockkit-float');
        if (paneId) { try { sidebar.dock?.(paneId); } catch (error) { report(error); } }
      }
    }
  };
  try {
    observer = new MutationObserver(mutations => {
      const relevant = mutations.some(mutation => {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (target === null) return false;
        if (mutation.type === 'attributes' && mutation.attributeName === 'hidden') return target.matches(host.rightbarSession);
        if (target.closest(host.rightbarPanel) !== null) {
          if (target.closest(host.dockFloatGrip) !== null) return true;
          const body = target.closest(host.dockContent);
          return body === null || body === target || (mutation.type === 'attributes' && mutation.attributeName === 'data-ccd-files-tree');
        }
        // Replacement/removal of the panel itself is a mutation on its parent.
        return [...mutation.addedNodes, ...mutation.removedNodes].some(node => node instanceof Element
          && (node.matches(`${host.rightbarPanel}, ${host.rightbarSession}`) || node.querySelector(host.rightbarPanel) !== null));
      });
      if (relevant) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['hidden', 'data-sidebar-right-open', 'data-sidebar-right-panel', 'data-sidebar-right-session',
        'data-dockkit-content', 'data-dockkit-float', 'data-dockkit-float-active', 'data-dockkit-pane', 'data-dockkit-host', 'data-ccd-files-tree'] });
    if (typeof ResizeObserver === 'function') resize = new ResizeObserver(schedule);
    unsubscribe = sidebar.openTabs?.subscribe?.(schedule) ?? (() => {});
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', schedule);
    schedule();
  } catch (error) { release(); report(error); }
  return release;
}
