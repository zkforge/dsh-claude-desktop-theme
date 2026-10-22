import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { NavigationHistoryPort } from './navigation-history.ts';

/** Read selection from the same mainView retention fact as native session rows. */
export function navigationHistoryPort(ctx: Context): NavigationHistoryPort {
  type SessionId = Parameters<typeof ctx.sessions.subagentAddress>[0];
  type PanelId = Parameters<typeof ctx.layout.selectPanel>[0];
  return {
    current() {
      const panel = ctx.layout.panelInfo.getSnapshot().activePanelId;
      if (panel !== null) return { kind: 'panel', id: panel };
      const session = Object.values(ctx.sessions.list.getSnapshot().byId)
        // mainView is declared by the host's workspace runtime, but its SDK
        // declaration does not publish that reference-source augmentation.
        .find(row => ((row.retainedBy as Readonly<Record<string, number | undefined>>).mainView ?? 0) > 0);
      return session ? { kind: 'session', id: session.id } : null;
    },
    available(target) {
      if (target.kind === 'panel') return true;
      const list = ctx.sessions.list.getSnapshot();
      // A catalog reconnect is not deletion. Keep visits until it is ready.
      return list.phase !== 'ready' || (list.byId[target.id as SessionId] !== undefined
        && !ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(target.id as SessionId));
    },
    open(target) {
      // Cancel a pending async New Session request before replaying a visit.
      ctx.layout.beginNavigation();
      if (target.kind === 'panel') ctx.layout.selectPanel(target.id as PanelId);
      else {
        const id = target.id as SessionId;
        ctx.uiWorkspace.openSession(ctx.sessions.subagentAddress(id) ?? id);
      }
    },
    subscribe(listener) {
      const releases = [ctx.sessions.list.subscribe(listener), ctx.workspaces.list.subscribe(listener),
        ctx.layout.panelInfo.subscribe(listener)];
      return () => { for (const release of releases) release(); };
    },
  };
}
