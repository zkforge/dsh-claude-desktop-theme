import type { Disposer } from '../contracts/ports.ts';
import { WORKTREE_PATH, readWorktreeResult, type WorktreeAvailability, type WorktreeResult } from '../../shared/worktree.ts';
import { hostSelectors } from './host-dom.ts';
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

/** Claude's compact bottom row: a menu checkbox with a purely visual switch. */
export function mountWorktreeToggle(card: HTMLElement, workspace: string, port: WorktreePickerPort): Disposer {
  const document = card.ownerDocument;
  const host = hostSelectors(document);
  const group = card.querySelector('[data-ccd-workspace-extra="branch"]');
  const sample = group?.querySelector<HTMLElement>('[data-ccd-branch-row]');
  if (!group || !sample) return () => {};
  const { zh } = menuCopy(document);
  const reasons: Record<WorktreeAvailability | 'loading' | 'no-session' | 'restart', string> = zh ? {
    ready: '首次发送时创建独立工作树；未提交改动保留在原目录', loading: '检查工作树支持…',
    disabled: '请先在 DSH 插件中启用「Git 工作树」', 'not-repo': '当前文件夹不是 Git 仓库',
    'no-commit': '仓库至少需要一个提交', 'unknown-workspace': '无法识别当前工作区',
    error: '无法读取工作树支持，请重新打开选单', 'no-session': '请先选择新会话', restart: '需重启 DSH：宿主尚未加载工作树接口',
  } : {
    ready: 'Create an isolated worktree on first send; uncommitted changes stay in the source folder',
    loading: 'Checking worktree support…', disabled: 'Enable Git Worktrees in DSH plugins first',
    'not-repo': 'This folder is not a Git repository', 'no-commit': 'The repository needs at least one commit',
    'unknown-workspace': 'Workspace not recognised', error: 'Could not check worktree support; reopen the menu',
    'no-session': 'Select a new session first', restart: 'Restart DSH to load the worktree interface',
  };
  const wrap = document.createElement('div');
  wrap.className = sample.parentElement?.className ?? '';
  const row = document.createElement('button');
  row.type = 'button';
  row.className = sample.className;
  row.setAttribute('role', 'menuitemcheckbox');
  row.setAttribute('data-ccd-worktree-row', '');
  const label = document.createElement('span');
  label.className = sample.querySelector(host.menuItemLabel)?.className ?? '';
  label.textContent = zh ? '工作树' : 'Worktree';
  const toggle = document.createElement('span');
  toggle.setAttribute('data-ccd-worktree-switch', '');
  toggle.setAttribute('aria-hidden', 'true');
  toggle.append(document.createElement('span'));
  const status = document.createElement('span');
  status.setAttribute('data-ccd-worktree-status', '');
  status.hidden = true;
  row.append(label, status, toggle);
  wrap.append(row);
  group.append(wrap);
  let state: WorktreeAvailability | 'loading' | 'restart' = 'loading';
  const render = () => {
    const session = port.session();
    const reason = state !== 'ready' ? state : session === undefined ? 'no-session' : 'ready';
    row.setAttribute('aria-checked', String(session !== undefined && port.selected(session)));
    row.setAttribute('aria-disabled', String(reason !== 'ready'));
    row.setAttribute('aria-busy', String(state === 'loading'));
    row.title = reasons[reason];
    row.setAttribute('aria-description', reasons[reason]);
    status.hidden = state !== 'restart';
    status.textContent = state === 'restart' ? (zh ? '需重启 DSH' : 'Restart DSH') : '';
  };
  row.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    const session = port.session();
    if (state === 'ready' && session !== undefined) port.select(session, workspace, !port.selected(session));
    render();
  });
  const request = new AbortController();
  const deadline = setTimeout(() => request.abort(), 8_000);
  let disposed = false;
  render();
  void (async () => {
    try {
      const response = await fetch(`${WORKTREE_PATH}?workspace=${encodeURIComponent(workspace)}`, { signal: request.signal });
      const body: unknown = response.ok ? await response.json() : null;
      const value = body !== null && typeof body === 'object' ? (body as { state?: unknown }).state : undefined;
      state = response.status === 404 ? 'restart' : typeof value === 'string' && Object.hasOwn(reasons, value)
        && value !== 'loading' && value !== 'no-session' ? value as WorktreeAvailability : 'error';
    } catch { state = 'error'; }
    clearTimeout(deadline);
    if (!disposed) render();
  })();
  return () => { disposed = true; clearTimeout(deadline); request.abort(); wrap.remove(); };
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
