import {
  GIT_BRANCHES_PATH, GIT_CHECKOUT_PATH, readGitBranchView, readGitCheckoutResult, type GitBranchView, type GitCheckoutResult,
} from '../../shared/git.ts';
import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

/** Marks the plugin's own groups in the picker card, which no host pass may count. */
export const WORKSPACE_EXTRA_ATTRIBUTE = 'data-ccd-workspace-extra';

/** The plugin's branch card, nested in the host card so its pointer guard keeps both open. */
export const BRANCH_MENU_ATTRIBUTE = 'data-ccd-branch-menu';

/** Search field shared by the picker card and the branch card. */
export const MENU_SEARCH_ATTRIBUTE = 'data-ccd-menu-search';

/** A row the current query hides. */
export const FILTERED_ATTRIBUTE = 'data-ccd-filtered';

/** How long a switch runs before the card says so, in ms. */
const PROGRESS_DELAY = 250;

const CHEVRON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5"/></svg>';

/** Last listing per Workspace, so a reopened card shows its branch at once. */
export type BranchCache = Map<string, GitBranchView>;

interface Copy {
  readonly branch: string;
  readonly search: string;
  readonly empty: string;
  readonly loading: string;
  /** The Host half predates this row: the route is registered only at Host start. */
  readonly restart: string;
  readonly detached: string;
  readonly truncated: string;
  readonly states: Readonly<Record<Exclude<GitBranchView['state'], 'ready'>, string>>;
  readonly switching: (branch: string) => string;
  readonly carried: (count: number) => string;
  readonly busy: string;
  readonly outcomes: Readonly<Record<Exclude<GitCheckoutResult['state'], 'switched'>, string>>;
}

const ZH: Copy = {
  branch: '分支', search: '搜索分支…', empty: '无匹配的分支', loading: '读取中…',
  restart: '需重启 DSH', detached: '分离的 HEAD', truncated: '仅列出最近提交的分支',
  states: {
    'not-repo': '不是 Git 仓库', 'no-git': '未找到 git 命令',
    'unknown-workspace': '无法识别当前工作区', error: '读取分支失败',
  },
  switching: branch => `正在切换到 ${branch}…`,
  carried: count => `已切换，带上 ${count} 个未提交改动`,
  busy: '该工作区有会话正在运行，结束后再切换',
  outcomes: {
    conflict: '本地改动会被覆盖，请先提交或暂存',
    'in-worktree': '该分支已在其他工作树中检出',
    'invalid-branch': '分支已不存在，请重新打开选单',
    'unknown-workspace': '无法识别当前工作区',
    error: '切换失败',
  },
};

const EN: Copy = {
  branch: 'Branch', search: 'Search branches…', empty: 'No matching branches', loading: 'Loading…',
  restart: 'Restart DSH', detached: 'Detached HEAD', truncated: 'Showing recently committed branches only',
  states: {
    'not-repo': 'Not a Git repository', 'no-git': 'git command not found',
    'unknown-workspace': 'Workspace not recognised', error: 'Could not read branches',
  },
  switching: branch => `Switching to ${branch}…`,
  carried: count => `Switched, carrying ${count} uncommitted ${count === 1 ? 'change' : 'changes'}`,
  busy: 'A session in this workspace is running; switch when it ends',
  outcomes: {
    conflict: 'Local changes would be overwritten; commit or stash them first',
    'in-worktree': 'Branch is checked out in another worktree',
    'invalid-branch': 'Branch no longer exists; reopen the menu',
    'unknown-workspace': 'Workspace not recognised',
    error: 'Could not switch branches',
  },
};

/** Host-language copy, following the `<html lang>` the rest of the picker reads. */
export function menuCopy(document: Document): { readonly zh: boolean; readonly copy: Copy } {
  const language = document.documentElement.lang || globalThis.navigator?.language || '';
  const zh = language.toLowerCase().startsWith('zh');
  return { zh, copy: zh ? ZH : EN };
}

/** One bare search line, as the model card draws it. */
export function createMenuSearch(document: Document, placeholder: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.setAttribute(MENU_SEARCH_ATTRIBUTE, '');
  input.setAttribute('aria-label', placeholder.replace(/…$/u, ''));
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.spellcheck = false;
  return input;
}

/** The host's own row classes, read from a row it rendered in the same card. */
interface RowClasses { readonly wrap: string; readonly item: string; readonly label: string }

function rowClasses(card: HTMLElement): RowClasses {
  const host = hostSelectors(card.ownerDocument);
  const sample = card.querySelector<HTMLElement>(`${host.menuViewport} ${host.menuItem}`);
  const selected = sample?.parentElement?.querySelector(host.menuItemCheck) !== null;
  // A selected sample carries the host's selected class; keep only the cell classes.
  const item = [...(sample?.classList ?? [])].filter(name => !selected || !/selected/iu.test(name)).join(' ');
  return {
    wrap: sample?.parentElement?.className ?? '',
    item,
    label: sample?.querySelector(host.menuItemLabel)?.className ?? '',
  };
}

/**
 * The picker card's branch row and its side card.
 *
 * The row names the selected Workspace's current branch; the side card lists
 * the repository's local branches with the current one checked, and choosing
 * another one checks it out through the Host (`host/git.ts`). The picker only
 * opens on the new-session page, so no conversation of this session is under
 * way; another session of the same Workspace may be, and while one runs or waits
 * for input the switch is refused, since it would change the files under that
 * agent. There is no confirmation: git itself refuses a switch that would
 * overwrite local changes, and changes it carries over are reported in one line
 * at the foot of the card.
 *
 * Both are the plugin's own nodes: the row in a group after the host's pinned
 * footer, the side card nested in the host card as a manual popover, so the
 * primitive's outside-pointer guard (`card.contains(target)`) keeps the card open
 * while the pointer is in the side card and the top layer lifts it out of the
 * card's clipping.
 *
 * @param card - the open picker card (the portalled host `Menu`).
 * @param workspaceId - selected Workspace; the Host resolves its directory.
 * @param cache - listings retained across openings.
 * @param busy - whether another session of this Workspace is running or waiting.
 * @param report - sink for unexpected failures.
 * @returns disposer that aborts the read and removes every node.
 */
export function mountWorkspaceBranch(card: HTMLElement, workspaceId: string, cache: BranchCache,
  busy: () => boolean, report: (error: unknown) => void): Disposer {
  const document = card.ownerDocument;
  const window = document.defaultView;
  const host = hostSelectors(document);
  const { copy } = menuCopy(document);
  const classes = rowClasses(card);
  const footer = [...card.querySelectorAll<HTMLElement>(':scope > [role="presentation"]')]
    .filter(group => !group.hasAttribute(WORKSPACE_EXTRA_ATTRIBUTE)).at(-1);

  const group = document.createElement('div');
  group.setAttribute('role', 'presentation');
  group.setAttribute(WORKSPACE_EXTRA_ATTRIBUTE, 'branch');
  if (footer !== undefined && footer.querySelector(host.menuViewport) === null) group.className = footer.className;

  const wrap = document.createElement('div');
  wrap.className = classes.wrap;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = classes.item;
  row.setAttribute('role', 'menuitem');
  row.setAttribute('data-ccd-branch-row', '');
  const label = document.createElement('span');
  label.className = classes.label;
  label.textContent = copy.branch;
  const value = document.createElement('span');
  value.setAttribute('data-ccd-branch-value', '');
  const chevron = document.createElement('span');
  chevron.setAttribute('data-ccd-menu-chevron', '');
  chevron.innerHTML = CHEVRON;
  row.append(label, value, chevron);
  wrap.append(row);
  group.append(wrap);
  card.append(group);

  let view: GitBranchView | undefined = cache.get(workspaceId);
  let submenu: HTMLElement | null = null;
  /** The side card's parts that outlive one fill of its rows. */
  let parts: { readonly search: HTMLInputElement; readonly list: HTMLElement; readonly note: HTMLElement } | null = null;
  /** The one line under the list: progress, carried changes, or why a switch failed. */
  let notice: { readonly text: string; readonly tone: 'info' | 'error' } | null = null;
  let switchingTo: string | null = null;
  /** Whether the running switch has outlasted {@link PROGRESS_DELAY}. */
  let showProgress = false;
  /** The side card's top, kept while its height changes so the card does not jump. */
  let placedTop: number | null = null;
  let disposed = false;
  let read = new AbortController();

  /* Set when the route answers 404: the renderer reloaded the new client while
     the Host process still runs the build without the route. */
  let stale = false;

  const render = () => {
    const ready = view?.state === 'ready' && view.current !== null;
    value.textContent = stale ? copy.restart : view === undefined ? copy.loading
      : view.state === 'ready' ? (view.current ?? '—') : copy.states[view.state];
    row.title = stale ? `${copy.states.error} · ${copy.restart}`
      : view?.state === 'ready' && view.detached ? `${copy.detached} · ${view.current}` : '';
    if (ready) {
      row.removeAttribute('aria-disabled');
      row.setAttribute('aria-haspopup', 'menu');
      row.setAttribute('aria-expanded', String(submenu !== null));
    } else {
      closeSubmenu();
      row.setAttribute('aria-disabled', 'true');
      row.removeAttribute('aria-haspopup');
      row.removeAttribute('aria-expanded');
    }
  };

  const position = () => {
    if (submenu === null || window == null) return;
    const outer = card.getBoundingClientRect();
    const anchor = row.getBoundingClientRect();
    const size = submenu.getBoundingClientRect();
    const right = outer.right + 4;
    const left = right + size.width <= window.innerWidth - 8 ? right : outer.left - size.width - 4;
    submenu.style.left = `${Math.max(8, left)}px`;
    /* Opened beside its row; later height changes (the foot line, a filter)
       keep that top and only move up when the card would leave the window. */
    const fits = Math.max(8, window.innerHeight - size.height - 8);
    const top = Math.max(8, Math.min(placedTop ?? anchor.top - 5, fits));
    if (placedTop === null) placedTop = top;
    submenu.style.top = `${top}px`;
  };

  /** Show only the rows the side card's query names. */
  function filter(): void {
    if (parts === null) return;
    const query = parts.search.value.trim().toLowerCase();
    let shown = 0;
    for (const item of parts.list.querySelectorAll<HTMLElement>('[data-ccd-branch-name]')) {
      const match = query === '' || (item.getAttribute('data-ccd-branch-name') ?? '').toLowerCase().includes(query);
      item.parentElement?.toggleAttribute(FILTERED_ATTRIBUTE, !match);
      if (match) shown++;
    }
    parts.list.querySelector<HTMLElement>('[data-ccd-branch-empty]')?.toggleAttribute('hidden', shown > 0);
  }

  /**
   * Bring the side card's rows to the current listing in place. While the card
   * is open its rows keep the order they opened in: a switch moves only the
   * check, so the row under the pointer never changes and nothing is rebuilt.
   * Branches that appeared are appended, branches that vanished are removed.
   */
  function fill(): void {
    if (parts === null || view?.state !== 'ready' || view.current === null) return;
    const listed = view.detached ? [view.current, ...view.branches] : view.branches;
    const wanted = new Set(listed);
    const rows = new Map<string, HTMLElement>();
    for (const item of parts.list.querySelectorAll<HTMLElement>('[data-ccd-branch-name]')) {
      const name = item.getAttribute('data-ccd-branch-name') ?? '';
      if (wanted.has(name)) rows.set(name, item);
      else item.parentElement?.remove();
    }
    const empty = parts.list.querySelector('[data-ccd-branch-empty]');
    for (const name of listed) {
      if (rows.has(name)) continue;
      const itemWrap = document.createElement('div');
      itemWrap.className = classes.wrap;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = classes.item;
      item.setAttribute('role', 'menuitem');
      item.setAttribute('data-ccd-branch-name', name);
      const text = document.createElement('span');
      text.className = classes.label;
      text.textContent = name;
      item.append(text);
      itemWrap.append(item);
      parts.list.insertBefore(itemWrap, empty);
      rows.set(name, item);
    }
    for (const [name, item] of rows) {
      const current = name === view.current;
      const check = item.querySelector('[data-ccd-branch-check]');
      if (current && check === null) {
        const mark = card.querySelector(host.menuItemCheck)?.cloneNode(true);
        if (mark instanceof Element) {
          mark.setAttribute('data-ccd-branch-check', '');
          item.append(mark);
        }
      } else if (!current) check?.remove();
      setAttribute(item, 'aria-current', current ? 'true' : null);
      setAttribute(item, 'title', current && view.detached ? copy.detached : null);
      // Rows stop taking clicks at once; only a switch that outlasts the delay looks busy.
      setAttribute(item, 'aria-disabled', switchingTo !== null ? 'true' : null);
      setAttribute(item, 'aria-busy', showProgress && name === switchingTo ? 'true' : null);
    }
    const text = notice?.text ?? (view.truncated ? copy.truncated : '');
    if (parts.note.textContent !== text) parts.note.textContent = text;
    parts.note.hidden = text === '';
    parts.note.setAttribute('data-tone', notice?.tone ?? 'info');
    filter();
    position();
  }

  /** Write an attribute only when it changes; null removes it. */
  function setAttribute(node: Element, name: string, value: string | null): void {
    if (value === null) node.removeAttribute(name);
    else if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }

  /** Check out one branch, then re-read the listing the Host now reports. */
  async function switchTo(branch: string): Promise<void> {
    if (switchingTo !== null) return;
    if (busy()) {
      notice = { text: copy.busy, tone: 'error' };
      fill();
      return;
    }
    switchingTo = branch;
    /* A local switch usually lands within tens of milliseconds; announcing it
       at once would flash a progress line and dimmed rows for one frame. */
    const progress = setTimeout(() => {
      if (switchingTo !== branch || disposed) return;
      showProgress = true;
      notice = { text: copy.switching(branch), tone: 'info' };
      fill();
    }, PROGRESS_DELAY);
    fill();
    let result: GitCheckoutResult;
    let missing = false;
    try {
      const response = await fetch(GIT_CHECKOUT_PATH, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: workspaceId, branch }),
      });
      missing = response.status === 404;
      result = readGitCheckoutResult(response.ok ? await response.json() : null);
    } catch (error) {
      report(error);
      result = readGitCheckoutResult(null);
    }
    clearTimeout(progress);
    switchingTo = null;
    showProgress = false;
    // The tree may have moved even when this card is gone: never show the old listing again.
    cache.delete(workspaceId);
    if (disposed) return;
    if (result.state === 'switched') {
      notice = result.carried > 0 ? { text: copy.carried(result.carried), tone: 'info' } : null;
      if (view?.state === 'ready') {
        // Move only the check; the next opening lists the Host's own order.
        view = { ...view, current: branch, detached: false,
          branches: view.branches.includes(branch) ? view.branches : [...view.branches, branch] };
      }
    } else {
      const reason = missing ? copy.restart : copy.outcomes[result.state];
      notice = { text: result.message === '' ? reason : `${reason}：${result.message}`, tone: 'error' };
    }
    render();
    fill();
    void load();
  }

  function closeSubmenu(): void {
    if (submenu === null) return;
    submenu.remove();
    submenu = null;
    parts = null;
    placedTop = null;
    notice = null;
    if (row.hasAttribute('aria-haspopup')) row.setAttribute('aria-expanded', 'false');
  }

  const openSubmenu = (focus: boolean) => {
    if (view?.state !== 'ready' || view.current === null) return;
    if (submenu !== null) {
      if (focus) submenu.querySelector<HTMLInputElement>(`[${MENU_SEARCH_ATTRIBUTE}]`)?.focus();
      return;
    }
    const node = document.createElement('div');
    node.className = card.className;
    node.setAttribute('role', 'menu');
    node.setAttribute('aria-label', copy.branch);
    node.setAttribute('data-menu-material', card.getAttribute('data-menu-material') ?? '');
    node.setAttribute(BRANCH_MENU_ATTRIBUTE, '');
    node.setAttribute('popover', 'manual');
    const material = card.firstElementChild;
    if (material?.getAttribute('aria-hidden') === 'true') node.append(material.cloneNode(false));
    const search = createMenuSearch(document, copy.search);
    const list = document.createElement('div');
    list.setAttribute('role', 'presentation');
    list.setAttribute('data-ccd-branch-list', '');
    const note = document.createElement('div');
    note.setAttribute('role', 'status');
    note.setAttribute('data-ccd-menu-note', '');
    note.setAttribute('data-ccd-branch-notice', '');
    const empty = document.createElement('div');
    empty.setAttribute('role', 'presentation');
    empty.setAttribute('data-ccd-menu-note', '');
    empty.setAttribute('data-ccd-branch-empty', '');
    empty.textContent = copy.empty;
    empty.hidden = true;
    list.append(empty);
    node.append(search, list, note);
    parts = { search, list, note };
    fill();
    search.addEventListener('input', () => { filter(); position(); });
    list.addEventListener('click', event => {
      const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-ccd-branch-name]') : null;
      const name = item?.getAttribute('data-ccd-branch-name');
      if (item === null || name == null || item.getAttribute('aria-disabled') === 'true') return;
      if (name !== view?.current || view.detached) void switchTo(name);
    });
    node.addEventListener('keydown', event => {
      const items = [search, ...[...list.querySelectorAll<HTMLElement>('[data-ccd-branch-name]')]
        .filter(item => !item.parentElement?.hasAttribute(FILTERED_ATTRIBUTE))];
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(Math.max(index, 0) + step + items.length) % items.length]?.focus();
      } else if (event.key === 'ArrowLeft' && document.activeElement !== search) {
        event.preventDefault();
        event.stopPropagation();
        closeSubmenu();
        row.focus();
      } else if (event.key === 'Tab') {
        // The primitive clicks whatever row has focus on Tab; here Tab only moves focus.
        event.stopPropagation();
      }
    });
    // Inside the card for the primitive's pointer guard; the top layer lifts it out.
    group.append(node);
    submenu = node;
    try {
      node.style.margin = '0';
      node.style.inset = 'auto';
      node.showPopover();
    } catch (error) { report(error); }
    row.setAttribute('aria-expanded', 'true');
    position();
    if (focus) search.focus();
  };

  row.addEventListener('click', event => {
    event.stopPropagation();
    if (submenu === null) openSubmenu(true);
  });
  row.addEventListener('pointerenter', () => { openSubmenu(false); });
  row.addEventListener('keydown', event => {
    if (event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    openSubmenu(true);
  });
  /* Pointing at any other row of the host card withdraws the side card, as the
     primitive does for its own submenus. */
  const withdraw = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target === null || submenu?.contains(target) || row.contains(target)) return;
    if (target.closest(host.menuItem) !== null || target.closest(`[${MENU_SEARCH_ATTRIBUTE}]`) !== null) closeSubmenu();
  };
  card.addEventListener('pointerover', withdraw);
  card.addEventListener('focusin', withdraw);
  window?.addEventListener('resize', position);

  /** Read the listing; a newer read supersedes an older one still in flight. */
  async function load(): Promise<void> {
    read.abort();
    const current = new AbortController();
    read = current;
    const deadline = setTimeout(() => current.abort(), 8_000);
    try {
      const response = await fetch(`${GIT_BRANCHES_PATH}?workspace=${encodeURIComponent(workspaceId)}`, {
        signal: current.signal, credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' },
      });
      if (disposed || read !== current) return;
      stale = response.status === 404;
      const next = response.ok ? readGitBranchView(await response.json()) : readGitBranchView(null);
      if (disposed || read !== current) return;
      view = next;
      // Only a Host answer is worth showing again before the next read lands.
      if (response.ok) cache.set(workspaceId, next);
    } catch (error) {
      if (disposed || read !== current) return;
      if (!current.signal.aborted) report(error);
      view = view ?? readGitBranchView(null);
    } finally {
      clearTimeout(deadline);
    }
    render();
    fill();
  }

  render();
  void load();

  return () => {
    disposed = true;
    read.abort();
    card.removeEventListener('pointerover', withdraw);
    card.removeEventListener('focusin', withdraw);
    window?.removeEventListener('resize', position);
    closeSubmenu();
    group.remove();
  };
}
