import type { Context } from '@deepseek-ai/cordis';
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import type { ProjectionDefinition, SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import type { ZodType } from 'zod';
import { SESSION_ENVIRONMENT_PATH, SESSION_INFO_KEY, infoRecord, type SessionEnvironment } from '../shared/session-info.ts';
import { runGit, type GitRunner } from './git.ts';

interface PromptCount { readonly prompts: number }

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { ccdSessionInfo: PromptCount }
  interface SessionProjectionStateMap { ccdSessionInfo: PromptCount }
}

/** Count the full log, matching native tokenUsage/sessionStats on forked conversations. */
export function applyPromptEvent(state: PromptCount, event: SessionEvent): PromptCount {
  return event.type === 'user/message' && event.data.source.kind === 'user'
    ? { prompts: state.prompts + 1 } : state;
}

const readPrompts = (value: unknown): PromptCount => {
  const prompts = infoRecord(value)['prompts'];
  return { prompts: typeof prompts === 'number' && Number.isSafeInteger(prompts) && prompts >= 0 ? prompts : 0 };
};
const promptSchema = { parse: readPrompts } as unknown as ZodType<PromptCount>;
export const sessionInfoProjection: Omit<ProjectionDefinition<typeof SESSION_INFO_KEY>, 'wire'> & {
  wire: NonNullable<ProjectionDefinition<typeof SESSION_INFO_KEY>['wire']>;
} = {
  key: SESSION_INFO_KEY, stateVersion: 1, stateSchema: promptSchema,
  init: () => ({ prompts: 0 }), apply: applyPromptEvent,
  wire: { viewSchema: promptSchema, view: state => state },
};

/** Inspect only this checkout. Never list the repository or invoke a shell. */
export async function readSessionEnvironment(cwd: string, signal: AbortSignal, run: GitRunner = runGit): Promise<SessionEnvironment> {
  const base = { cwd, branch: null, detached: false, worktree: null } as const;
  try {
    const paths = (await run(cwd, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], signal)).trim().split('\n');
    let branch: string | null = null;
    let detached = false;
    try { branch = (await run(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal)).trim() || null; }
    catch {
      signal.throwIfAborted();
      try { branch = (await run(cwd, ['rev-parse', '--short', 'HEAD'], signal)).trim() || null; detached = branch !== null; }
      catch { signal.throwIfAborted(); }
    }
    return { cwd, git: 'ready', branch, detached, worktree: paths.length === 2 ? paths[0] !== paths[1] : null };
  } catch (error) {
    signal.throwIfAborted();
    const stderr = String((error as { stderr?: unknown }).stderr ?? '');
    return { ...base, git: /not a git repository/iu.test(stderr) ? 'not-repo' : 'error' };
  }
}

/** Observe a Session without resuming its Agent; no arbitrary client-supplied paths. */
export function mountSessionInfo(ctx: Context, enabled: () => boolean): void {
  ctx.inject(['sessionProjections'], scope => {
    if (enabled()) (scope.get('sessionProjections') as SessionProjectionRegistry).register(sessionInfoProjection);
  });
  ctx.inject(['connection', 'sessionQuery'], scope => {
    const query = scope.get('sessionQuery') as SessionQueryEngine;
    const connection = scope.get('connection') as { fetch: { register(route: {
      path: string; methods: readonly string[]; requestBody: 'buffered';
      fetch(request: Request): Promise<Response>;
    }): () => Promise<void> } };
    scope.effect(() => connection.fetch.register({
      path: SESSION_ENVIRONMENT_PATH, methods: ['GET'], requestBody: 'buffered',
      async fetch(request) {
        const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
        if (!enabled()) return reply({ error: 'disabled' }, 409);
        const id = new URL(request.url).searchParams.get('session');
        if (!id) return reply({ error: 'missing-session' }, 400);
        try {
          const observation = await query.observeSession(id as SessionId, { signal: request.signal });
          let cwd: string | undefined;
          try {
            const recorded = (observation.projections?.values as Record<string, unknown> | undefined)?.['workingDirectory'];
            cwd = typeof recorded === 'string' && recorded !== '' ? recorded : observation.header.cwd;
          } finally { observation[Symbol.dispose](); }
          if (!cwd) return reply({ error: 'missing-directory' }, 404);
          return reply(await readSessionEnvironment(cwd, request.signal));
        } catch { return reply({ error: 'unavailable' }, 503); }
      },
    }), 'session info: environment route');
  });
}
