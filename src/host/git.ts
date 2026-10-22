import { execFile } from 'node:child_process';
import type { Context } from '@deepseek-ai/cordis';
import {
  GIT_BRANCH_LIMIT, GIT_BRANCHES_PATH, type GitBranchView,
} from '../shared/git.ts';

/** Runs one git invocation in a directory; rejects with the child's error. */
export type GitRunner = (cwd: string, args: readonly string[], signal: AbortSignal, timeout?: number) => Promise<string>;

/** Failure shape `execFile` rejects with: `code` is the exit status or a spawn errno. */
interface RunFailure { readonly code?: unknown; readonly stderr?: unknown }

/**
 * No shell, no prompts, no optional locks: listing branches must never block on
 * credentials, never start a repository-configured fsmonitor, and never take
 * the index lock a concurrent `git` in the user's terminal is waiting for.
 * `LC_ALL=C` keeps git's own messages in English, which is what tells a
 * non-repository apart from other fatal errors (a Chinese locale prints
 * 「不是 git 仓库」); ref names are bytes and pass through unchanged.
 */
export const runGit: GitRunner = (cwd, args, signal, timeout = 5_000) => new Promise((resolve, reject) => {
  execFile('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd, signal, timeout, windowsHide: true, maxBuffer: 1 << 20, encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stderr }));
    else resolve(stdout);
  });
});

const view = (state: GitBranchView['state']): GitBranchView =>
  ({ state, current: null, detached: false, branches: [], truncated: false });

/**
 * Local branches of the repository that contains `cwd`, read-only.
 * @returns `ready` with the current branch first, or the reason there is none.
 */
export async function listBranches(cwd: string, run: GitRunner, signal: AbortSignal): Promise<GitBranchView> {
  let listed: string;
  try {
    listed = await run(cwd, ['for-each-ref', '--sort=-committerdate', `--count=${GIT_BRANCH_LIMIT + 1}`,
      '--format=%(refname:short)', 'refs/heads'], signal);
  } catch (error) {
    const failure = error as RunFailure;
    if (failure.code === 'ENOENT') return view('no-git');
    if (failure.code === 128 && /not a git repository/iu.test(String(failure.stderr ?? ''))) return view('not-repo');
    return view('error');
  }
  let current: string | null = null;
  let detached = false;
  try {
    // Also names an unborn branch, which `for-each-ref` cannot list yet.
    current = (await run(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal)).trim() || null;
  } catch {
    try {
      current = (await run(cwd, ['rev-parse', '--short', 'HEAD'], signal)).trim() || null;
      detached = current !== null;
    } catch { /* An empty repository without HEAD lists no current branch. */ }
  }
  const names = listed.split('\n').map(line => line.trim()).filter(Boolean);
  const truncated = names.length > GIT_BRANCH_LIMIT;
  const others = names.slice(0, GIT_BRANCH_LIMIT).filter(name => name !== current);
  const branches = current !== null && !detached ? [current, ...others] : others;
  return { state: 'ready', current, detached, branches: branches.slice(0, GIT_BRANCH_LIMIT), truncated };
}

interface WorkspaceRegistryPort { get(id: string): { readonly path: string } | undefined }

/**
 * Authenticated read-only branch listing. The
 * client names a registered Workspace, never a path, so the route cannot be
 * pointed at an arbitrary directory.
 */
export function mountGitBranches(ctx: Context, isEnabled: () => boolean, run: GitRunner = runGit): void {
  ctx.inject(['connection'], injected => {
    if (!isEnabled()) return;
    const connection = injected.get('connection') as { fetch: { register(route: {
      path: string; methods: readonly string[]; requestBody: 'buffered';
      fetch(request: Request): Promise<Response>;
    }): () => Promise<void> } } | undefined;
    if (!connection) return;
    ctx.effect(() => connection.fetch.register({
      path: GIT_BRANCHES_PATH, methods: ['GET'], requestBody: 'buffered',
      fetch: async request => {
        const reply = (body: GitBranchView) => Response.json(body, { headers: { 'cache-control': 'no-store' } });
        if (!isEnabled()) return reply(view('error'));
        const id = new URL(request.url, 'http://host').searchParams.get('workspace') ?? '';
        const registry = injected.get('workspaceRegistry') as WorkspaceRegistryPort | undefined;
        let path: string | undefined;
        try { path = id === '' ? undefined : registry?.get(id)?.path; } catch { path = undefined; }
        if (path === undefined) return reply(view('unknown-workspace'));
        try {
          return reply(await listBranches(path, run, request.signal));
        } catch {
          return reply(view('error'));
        }
      },
    }), 'git: branch route');
  });
}
