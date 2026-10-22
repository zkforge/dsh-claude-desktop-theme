import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { WORKTREE_PATH, type WorktreeAvailability, type WorktreeResult } from '../shared/worktree.ts';
import { runGit, type GitRunner } from './git.ts';

interface WorktreeRuntime {
  create(agent: Agent, request: { from?: string }, signal?: AbortSignal): Promise<WorktreeResult>;
}
interface Workspace { readonly path: string; readonly sessionIds: readonly string[] }
interface Registry { get(id: string): Workspace | undefined }

/** Check HEAD as well as repository membership: empty repositories cannot be checked out. */
export async function worktreeAvailability(path: string, available: boolean, signal: AbortSignal,
  run: GitRunner = runGit): Promise<WorktreeAvailability> {
  if (!available) return 'disabled';
  try {
    await run(path, ['rev-parse', '--show-toplevel'], signal);
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: unknown };
    if (failure.code === 'ENOENT') return 'error';
    return /not a git repository/iu.test(String(failure.stderr ?? '')) ? 'not-repo' : 'error';
  }
  try { await run(path, ['rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}'], signal); }
  catch { return 'no-commit'; }
  return 'ready';
}

/** Optional runtime discovery follows plugin enable/disable without making it a theme dependency. */
export function mountWorktrees(ctx: Context, enabled: () => boolean): void {
  ctx.inject(['connection', 'workspaceRegistry', 'sessionController'], scope => {
    const registry = scope.get('workspaceRegistry') as Registry;
    const controller = scope.get('sessionController') as SessionController;
    const connection = scope.get('connection') as { fetch: { register(route: {
      path: string; methods: readonly string[]; requestBody: 'buffered';
      fetch(request: Request): Promise<Response>;
    }): () => Promise<void> } };
    let runtime: WorktreeRuntime | undefined;
    scope.inject(['worktrees'], child => {
      const service = child.get('worktrees') as WorktreeRuntime;
      runtime = service;
      child.effect(() => () => { if (runtime === service) runtime = undefined; });
    });
    // Keep successful results too: retrying after a lost response must not create another checkout.
    const attempts = new Map<string, Promise<WorktreeResult>>();
    scope.effect(() => connection.fetch.register({
      path: WORKTREE_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
      async fetch(request) {
        const reply = (body: unknown, status = 200) => Response.json(body, {
          status, headers: { 'cache-control': 'no-store' },
        });
        if (!enabled()) return reply({ state: 'disabled' }, 409);
        if (request.method === 'GET') {
          const id = new URL(request.url, 'http://host').searchParams.get('workspace') ?? '';
          let workspace: Workspace | undefined;
          try { workspace = registry.get(id); } catch { /* Unknown workspace. */ }
          return reply({ state: workspace === undefined ? 'unknown-workspace'
            : await worktreeAvailability(workspace.path, runtime !== undefined, request.signal) });
        }
        try {
          const body: unknown = await request.json();
          if (body === null || typeof body !== 'object') return reply({ error: 'Invalid request' }, 400);
          const fields = body as Record<string, unknown>;
          const id = fields['session'];
          const workspaceId = fields['workspace'];
          if (typeof id !== 'string' || typeof workspaceId !== 'string') return reply({ error: 'Invalid request' }, 400);
          const from = fields['from'];
          if (from !== undefined && (typeof from !== 'string' || from === '' || /[\0\r\n]/u.test(from))) {
            return reply({ error: 'Invalid base branch' }, 400);
          }
          const workspace = registry.get(workspaceId);
          if (workspace === undefined || !workspace.sessionIds.includes(id)) return reply({ error: 'Session does not belong to this workspace' }, 409);
          const existing = attempts.get(id);
          if (existing !== undefined) return reply(await existing);
          const service = runtime;
          if (service === undefined) return reply({ error: 'Git worktree plugin is disabled' }, 409);
          const operation = (async () => {
            const resolved = await controller.resolveAgent(id as SessionId);
            if ('error' in resolved) throw new Error('Session is unavailable');
            const agent = resolved.agent;
            return agent.runMaintenance(async signal => {
              const inspection = await controller.inspect(id as SessionId, signal);
              if (inspection.meta.cwd !== workspace.path || inspection.events.some(event =>
                event.type === 'user/message' || event.type === 'turn/start')) {
                throw new Error('Worktrees can only be created for a new session in this workspace');
              }
              // Selecting a base never checks out the source directory. DSH resolves
              // the local revision and creates the isolated checkout under its file policy.
              return service.create(agent, from === undefined ? {} : { from }, signal);
            });
          })();
          attempts.set(id, operation);
          try { return reply(await operation); }
          catch (error) { if (attempts.get(id) === operation) attempts.delete(id); throw error; }
        } catch (error) {
          return reply({ error: error instanceof Error ? error.message : 'Could not create worktree' }, 409);
        }
      },
    }), 'worktree: create and availability route');
  });
}
