import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';

/** Only host-authoritative identity and mutations cross into the menu renderer. */
export interface HeaderMenuActions {
  read(id: string): { title: string; cwd: string | undefined } | null;
  rename(id: string, title: string): Promise<void>;
  fork(id: string): Promise<void>;
  archive(id: string): Promise<void>;
  /** Installed application ids, in the host's order. */
  openApps(): Promise<readonly string[]>;
  openApp(app: string, path: string): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export function headerMenuActions(ctx: Context): HeaderMenuActions {
  type SessionId = Parameters<typeof ctx.uiWorkspace.forkSession>[0];
  return {
    read(id) {
      const session = ctx.sessions.list.getSnapshot().byId[id as SessionId];
      return session === undefined ? null : { title: session.displayTitle, cwd: session.cwd };
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
    // The host's own open-in-app routes, document-relative as its client addresses them.
    async openApps() {
      const response = await fetch('open-in-app/apps', { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { apps } = await response.json() as { apps?: unknown };
      return Array.isArray(apps) ? apps.filter((id): id is string => typeof id === 'string') : [];
    },
    async openApp(app, path) {
      const response = await fetch('open-in-app/open', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app, path }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    },
    subscribe: listener => ctx.sessions.list.subscribe(listener),
  };
}
