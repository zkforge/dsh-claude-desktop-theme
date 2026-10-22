/** Authenticated bridge to DSH's optional worktree runtime. */
export const WORKTREE_PATH = '/api/ccd-worktree';

export type WorktreeAvailability = 'ready' | 'disabled' | 'not-repo' | 'no-commit' | 'unknown-workspace' | 'error';
export interface WorktreeResult {
  readonly path: string;
  readonly branch: string;
  readonly baseCommit: string;
  readonly repositoryRoot: string;
}

export function readWorktreeResult(value: unknown): WorktreeResult {
  if (value === null || typeof value !== 'object') throw new Error('Invalid worktree response');
  const fields = value as Record<string, unknown>;
  for (const key of ['path', 'branch', 'baseCommit', 'repositoryRoot']) {
    if (typeof fields[key] !== 'string' || fields[key] === '') throw new Error('Invalid worktree response');
  }
  return fields as unknown as WorktreeResult;
}
