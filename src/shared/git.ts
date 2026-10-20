/** Read-only branch listing for the workspace picker's branch row. */
export const GIT_BRANCHES_PATH = '/api/ccd-git-branches';

/** Upper bound on listed local branches; the rest are reported as truncated. */
export const GIT_BRANCH_LIMIT = 200;

export type GitBranchState = 'ready' | 'not-repo' | 'no-git' | 'unknown-workspace' | 'error';

/** What the Host reports for one Workspace directory. */
export interface GitBranchView {
  readonly state: GitBranchState;
  /** Checked-out branch, or the short commit id when `detached`. */
  readonly current: string | null;
  readonly detached: boolean;
  /** Local branches, current first, then most recently committed. */
  readonly branches: readonly string[];
  readonly truncated: boolean;
}

const STATES: readonly GitBranchState[] = ['ready', 'not-repo', 'no-git', 'unknown-workspace', 'error'];

/** Accept only a well-formed view; anything else reads as an error. */
export function readGitBranchView(value: unknown): GitBranchView {
  const failed: GitBranchView = { state: 'error', current: null, detached: false, branches: [], truncated: false };
  if (!value || typeof value !== 'object') return failed;
  const view = value as Record<string, unknown>;
  const state = STATES.find(state => state === view['state']);
  if (state === undefined) return failed;
  if (state !== 'ready') return { ...failed, state };
  const branches = view['branches'];
  const current = view['current'];
  if (!Array.isArray(branches) || !branches.every(branch => typeof branch === 'string')) return failed;
  if (current !== null && typeof current !== 'string') return failed;
  return {
    state, current, branches: branches.slice(0, GIT_BRANCH_LIMIT),
    detached: view['detached'] === true, truncated: view['truncated'] === true,
  };
}

/** Branch checkout for the same row, offered on the new-session page only. */
export const GIT_CHECKOUT_PATH = '/api/ccd-git-checkout';

export type GitCheckoutState =
  | 'switched' | 'conflict' | 'in-worktree' | 'invalid-branch' | 'unknown-workspace' | 'error';

/** What the Host reports after one checkout attempt. */
export interface GitCheckoutResult {
  readonly state: GitCheckoutState;
  /** Tracked files still modified after a switch: the changes git carried over. */
  readonly carried: number;
  /** First line of git's own message, for `error` only. */
  readonly message: string;
}

const CHECKOUT_STATES: readonly GitCheckoutState[] =
  ['switched', 'conflict', 'in-worktree', 'invalid-branch', 'unknown-workspace', 'error'];

/** Accept only a well-formed result; anything else reads as an error. */
export function readGitCheckoutResult(value: unknown): GitCheckoutResult {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const state = CHECKOUT_STATES.find(state => state === record['state']) ?? 'error';
  const carried = record['carried'];
  const message = record['message'];
  return {
    state,
    carried: state === 'switched' && typeof carried === 'number' && Number.isInteger(carried) && carried > 0 ? carried : 0,
    message: state === 'error' && typeof message === 'string' ? message.slice(0, 300) : '',
  };
}
