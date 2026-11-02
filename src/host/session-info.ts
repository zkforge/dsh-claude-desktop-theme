import { homedir } from 'node:os';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query';
import type { ProjectionDefinition, SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import type { ZodType } from 'zod';
import { SESSION_ENVIRONMENT_PATH, SESSION_INFO_KEY, SESSION_SKILL_PATH, infoRecord, type SessionEnvironment } from '../shared/session-info.ts';
import { runGit, type GitRunner } from './git.ts';

interface PromptCount { readonly prompts: number }

/** The `skills` registry face this route reads; `dsh-skill` is not in our type baseline. */
interface SkillRegistry {
  list(options: { cwd: string }): Promise<readonly {
    readonly name: string;
    readonly path?: string;
    readonly resourceBase?: { readonly kind: string; readonly path?: string };
  }[]>;
}

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

/** The roots `dsh-home-paths` displays global instruction files under. */
export function instructionHomes(env: NodeJS.ProcessEnv, home: string): SessionEnvironment['homes'] {
  return {
    '~': home,
    ...env['DSH_HOME'] ? { $DSH_HOME: env['DSH_HOME'] } : {},
    ...env['DSH_AGENTS_HOME'] ? { $DSH_AGENTS_HOME: env['DSH_AGENTS_HOME'] } : {},
  };
}

/** Inspect only this checkout. Never list the repository or invoke a shell. */
export async function readSessionEnvironment(cwd: string, signal: AbortSignal, run: GitRunner = runGit): Promise<Omit<SessionEnvironment, 'homes'>> {
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

/** A registered skill's SKILL.md; packaged skills such as the Office set publish only their directory. */
export async function skillFilePath(registry: SkillRegistry, cwd: string, name: string): Promise<string | null> {
  const skill = (await registry.list({ cwd })).find(entry => entry.name === name);
  const base = skill?.resourceBase?.kind === 'directory' ? skill.resourceBase.path : undefined;
  return skill?.path ?? (base === undefined ? null : `${base}/SKILL.md`);
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
    const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
    const directoryOf = async (id: string, signal: AbortSignal) => {
      const observation = await query.observeSession(id as SessionId, { signal });
      try {
        const recorded = (observation.projections?.values as Record<string, unknown> | undefined)?.['workingDirectory'];
        return typeof recorded === 'string' && recorded !== '' ? recorded : observation.header.cwd;
      } finally { observation[Symbol.dispose](); }
    };
    scope.effect(() => connection.fetch.register({
      path: SESSION_ENVIRONMENT_PATH, methods: ['GET'], requestBody: 'buffered',
      async fetch(request) {
        if (!enabled()) return reply({ error: 'disabled' }, 409);
        const id = new URL(request.url).searchParams.get('session');
        if (!id) return reply({ error: 'missing-session' }, 400);
        try {
          const cwd = await directoryOf(id, request.signal);
          if (!cwd) return reply({ error: 'missing-directory' }, 404);
          return reply({ ...await readSessionEnvironment(cwd, request.signal), homes: instructionHomes(process.env, homedir()) });
        } catch { return reply({ error: 'unavailable' }, 503); }
      },
    }), 'session info: environment route');
    scope.effect(() => connection.fetch.register({
      path: SESSION_SKILL_PATH, methods: ['GET'], requestBody: 'buffered',
      async fetch(request) {
        if (!enabled()) return reply({ error: 'disabled' }, 409);
        const params = new URL(request.url).searchParams;
        const id = params.get('session'), name = params.get('name');
        const registry = scope.get('skills') as SkillRegistry | undefined;
        if (!id || !name) return reply({ error: 'missing-skill' }, 400);
        if (registry === undefined) return reply({ error: 'unavailable' }, 503);
        try {
          const path = await skillFilePath(registry, await directoryOf(id, request.signal) ?? '', name);
          return path === null ? reply({ error: 'missing-skill' }, 404) : reply({ path });
        } catch { return reply({ error: 'unavailable' }, 503); }
      },
    }), 'session info: skill route');
  });
}
