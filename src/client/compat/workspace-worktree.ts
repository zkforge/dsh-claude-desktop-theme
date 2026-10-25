import type { Disposer } from '../contracts/ports.ts';
import { WORKTREE_PATH, readWorktreeResult, type WorktreeAvailability, type WorktreeResult } from '../../shared/worktree.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsInTranscript } from './mutation-scope.ts';
import { menuCopy } from './workspace-branch.ts';

export interface WorktreePickerPort {
  session(): string | undefined;
  selected(session: string): boolean;
  select(session: string, workspace: string, enabled: boolean): void;
  base(session: string): string | undefined;
  setBase(session: string, branch: string): void;
  subscribe(listener: () => void): Disposer;
}

/** Per-new-session intent; successful and in-flight creations survive send retries. */
export class WorktreeChoices implements WorktreePickerPort {
  readonly choices = new Map<string, { workspace: string; enabled: boolean; from?: string; result?: Promise<WorktreeResult> }>();
  private readonly listeners = new Set<() => void>();
  readonly session: () => string | undefined;
  constructor(session: () => string | undefined) { this.session = session; }
  selected(session: string): boolean { return this.choices.get(session)?.enabled === true; }
  select(session: string, workspace: string, enabled: boolean): void {
    const previous = this.choices.get(session);
    // Once created, this session is already in its checkout; a toggle cannot undo it.
    if (previous?.result !== undefined) return;
    this.choices.set(session, { ...previous, workspace, enabled });
    for (const listener of this.listeners) listener();
  }
  base(session: string): string | undefined { return this.choices.get(session)?.from; }
  setBase(session: string, branch: string): void {
    const choice = this.choices.get(session);
    if (!choice?.enabled || choice.result !== undefined) return;
    choice.from = branch;
    for (const listener of this.listeners) listener();
  }
  subscribe(listener: () => void): Disposer {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  async prepare(session: string, create: (workspace: string, from?: string) => Promise<WorktreeResult>): Promise<void> {
    const choice = this.choices.get(session);
    if (!choice?.enabled) return;
    const operation = choice.result ??= create(choice.workspace, choice.from);
    try { await operation; }
    catch (error) {
      if (choice.result === operation) delete choice.result;
      throw error;
    }
  }
}

type ChipState = WorktreeAvailability | 'loading' | 'restart';

/** Do not advertise an unavailable feature or flash it before the first check. */
const HIDDEN: ReadonlySet<ChipState> = new Set(['loading', 'disabled', 'not-repo', 'no-commit', 'unknown-workspace']);

/**
 * Claude's worktree toggle beside the folder chip: a pressed chip, not a menu
 * row. It is shown only for a new session whose folder is a Git repository,
 * and the optional runtime is enabled. Recheck while visible and on returning
 * to the composer so plugin enable/disable does not leave a stale button.
 *
 * @param document - renderer document carrying the hero workspace row.
 * @param port - per-session worktree choices.
 * @param workspaceOf - the Workspace a session belongs to.
 * @param report - sink for observer failures.
 */
export function mountWorktreeChip(document: Document, port: WorktreePickerPort,
  workspaceOf: (session: string) => string | undefined, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const { zh } = menuCopy(document);
  const reasons: Record<ChipState | 'no-session', string> = zh ? {
    ready: '首次发送时创建独立工作树；未提交改动保留在原目录', loading: '检查工作树支持…',
    disabled: '请先在 DSH 插件中启用「Git 工作树」', 'not-repo': '当前文件夹不是 Git 仓库',
    'no-commit': '仓库至少需要一个提交', 'unknown-workspace': '无法识别当前工作区',
    error: '无法读取工作树支持', 'no-session': '请先选择新会话', restart: '需重启 DSH：宿主尚未加载工作树接口',
  } : {
    ready: 'Create an isolated worktree on first send; uncommitted changes stay in the source folder',
    loading: 'Checking worktree support…', disabled: 'Enable Git Worktrees in DSH plugins first',
    'not-repo': 'This folder is not a Git repository', 'no-commit': 'The repository needs at least one commit',
    'unknown-workspace': 'Workspace not recognised', error: 'Could not check worktree support',
    'no-session': 'Select a new session first', restart: 'Restart DSH to load the worktree interface',
  };
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('data-ccd-worktree-chip', '');
  const label = document.createElement('span');
  label.textContent = zh ? '工作树' : 'Worktree';
  button.append(label);
  const states = new Map<string, ChipState>();
  const requests = new Set<AbortController>();
  const pending = new Set<string>();
  let workspace: string | undefined;
  let session: string | undefined;
  let disposed = false;

  const state = (): ChipState => workspace === undefined ? 'unknown-workspace' : states.get(workspace) ?? 'loading';

  /** Keep the last answer during refresh and merge overlapping checks. */
  const load = (id: string, refresh = false) => {
    if (pending.has(id) || (!refresh && states.has(id))) return;
    pending.add(id);
    if (!states.has(id)) states.set(id, 'loading');
    const request = new AbortController();
    requests.add(request);
    const deadline = setTimeout(() => request.abort(), 8_000);
    void (async () => {
      let next: ChipState;
      try {
        const response = await fetch(`${WORKTREE_PATH}?workspace=${encodeURIComponent(id)}`, { signal: request.signal });
        const body: unknown = response.ok ? await response.json() : null;
        const value = body !== null && typeof body === 'object' ? (body as { state?: unknown }).state : undefined;
        next = response.status === 404 ? 'restart' : typeof value === 'string' && Object.hasOwn(reasons, value)
          && value !== 'loading' && value !== 'no-session' && value !== 'restart' ? value as WorktreeAvailability : 'error';
      } catch { next = 'error'; }
      clearTimeout(deadline);
      requests.delete(request);
      pending.delete(id);
      if (disposed) return;
      states.set(id, next);
      render();
    })();
  };

  const render = () => {
    const current = state();
    const reason = current !== 'ready' ? current : session === undefined ? 'no-session' : 'ready';
    button.hidden = session === undefined || HIDDEN.has(current);
    button.setAttribute('aria-pressed', String(session !== undefined && port.selected(session)));
    button.setAttribute('aria-disabled', String(reason !== 'ready'));
    button.setAttribute('aria-busy', String(current === 'loading'));
    button.title = reasons[reason];
  };

  /** Keep the chip right after the folder chip's own row item. */
  const sync = () => {
    const chip = document.querySelector<HTMLElement>(host.heroWorkspaceChip);
    const row = chip?.closest<HTMLElement>(host.heroWorkspaceRow) ?? null;
    if (chip === null || row === null) {
      button.remove();
      return;
    }
    let item: HTMLElement = chip;
    while (item.parentElement !== null && item.parentElement !== row) item = item.parentElement;
    const returning = !button.isConnected;
    if (item.nextElementSibling !== button) item.after(button);
    const nextSession = port.session();
    const nextWorkspace = nextSession === undefined ? undefined : workspaceOf(nextSession);
    // Switching folders before the first send moves an enabled choice with it.
    if (nextSession !== undefined && nextWorkspace !== undefined && nextWorkspace !== workspace
      && nextSession === session && port.selected(nextSession)) port.select(nextSession, nextWorkspace, true);
    const changed = session !== nextSession || workspace !== nextWorkspace;
    session = nextSession;
    workspace = nextWorkspace;
    if (workspace !== undefined) load(workspace, returning || changed);
    render();
  };

  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    if (state() === 'ready' && session !== undefined && workspace !== undefined) {
      port.select(session, workspace, !port.selected(session));
    }
    render();
  });

  let observer: MutationObserver | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const refresh = () => {
    if (!document.hidden && button.isConnected && workspace !== undefined) load(workspace, true);
  };
  const view = document.defaultView;
  let release: Disposer = () => {};
  try {
    release = port.subscribe(render);
    observer = new MutationObserver(records => { if (!recordsInTranscript(records)) sync(); });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    sync();
    timer = setInterval(refresh, 10_000);
    view?.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
  } catch (error) {
    observer?.disconnect();
    release();
    button.remove();
    report(error);
    return () => {};
  }
  return () => {
    disposed = true;
    clearInterval(timer);
    view?.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
    observer?.disconnect();
    release();
    for (const request of requests) request.abort();
    requests.clear();
    button.remove();
  };
}

/** Request retries reuse the Host's per-session result, including after a lost response. */
export async function createSessionWorktree(session: string, workspace: string, from?: string): Promise<WorktreeResult> {
  const response = await fetch(WORKTREE_PATH, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ session, workspace, from }),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = body !== null && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
    throw new Error(typeof error === 'string' ? error : 'Could not create worktree');
  }
  return readWorktreeResult(body);
}
