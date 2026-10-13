import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';

/** Only host-authoritative identity and mutations cross into the menu renderer. */
export interface HeaderMenuActions {
  read(id: string): { title: string; folder: string; path: string } | null;
  rename(id: string, title: string): Promise<void>;
  fork(id: string): Promise<void>;
  archive(id: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function headerMenuActions(ctx: Context): HeaderMenuActions {
  type SessionId = Parameters<typeof ctx.uiWorkspace.forkSession>[0];
  return {
    read(id) {
      const sessionId = id as SessionId;
      const session = ctx.sessions.list.getSnapshot().byId[sessionId];
      if (session === undefined) return null;
      const workspace = ctx.workspaces.list.getSnapshot().items.find(item => item.sessionIds.includes(sessionId));
      const path = session.cwd ?? workspace?.path ?? '';
      return { title: session.displayTitle, path, folder: path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path };
    },
    async rename(id, title) {
      const result = await ctx.sessions.using(id as SessionId, { source: 'workspaceOperation' }, reference => reference.binding.session.rename(title));
      if (!result.ok) throw new Error(result.error.message);
    },
    async fork(id) {
      const child = await ctx.uiWorkspace.forkSession(id as SessionId);
      ctx.uiWorkspace.openSession(child);
    },
    archive: id => ctx.uiWorkspace.archiveSession(id as SessionId),
    subscribe(listener) {
      const sessions = ctx.sessions.list.subscribe(listener);
      const workspaces = ctx.workspaces.list.subscribe(listener);
      return () => { sessions(); workspaces(); };
    },
  };
}
