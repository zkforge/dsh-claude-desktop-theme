import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { SessionStatus } from './status-groups.ts';

/** What the workspace picker reads from the host's authoritative snapshots. */
export interface WorkspacePickerPort {
  /** Workspace ids in the order the picker renders its rows. */
  workspaceIds(): readonly string[];
  /** Whether any session of the Workspace is running or waiting for input. */
  busy(workspaceId: string): boolean;
}

interface StatusStore { getSnapshot(): ReadonlyMap<string, SessionStatus> }

export function workspacePickerPort(ctx: Context): WorkspacePickerPort {
  return {
    workspaceIds: () => ctx.workspaces.list.getSnapshot().items.map(item => item.workspaceId),
    busy(workspaceId) {
      const workspace = ctx.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId);
      if (workspace === undefined) return false;
      // The same root source the status sections read; builds without it fall back to the summary.
      const statuses = (ctx as Context & { uiSession?: { sessionStatus?: StatusStore } }).uiSession?.sessionStatus?.getSnapshot();
      const sessions = ctx.sessions.list.getSnapshot().byId;
      return workspace.sessionIds.some(id => {
        const status = statuses?.get(id);
        return status?.pendingInteraction !== undefined || (status?.running ?? sessions[id]?.running ?? false);
      });
    },
  };
}
