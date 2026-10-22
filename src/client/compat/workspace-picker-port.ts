import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type { WorktreePickerPort } from './workspace-worktree.ts';

/** What the workspace picker reads from the host's authoritative snapshots. */
export interface WorkspacePickerPort {
  readonly worktrees?: WorktreePickerPort;
  /** Workspace ids in the order the picker renders its rows. */
  workspaceIds(): readonly string[];
}

export function workspacePickerPort(ctx: Context, worktrees?: WorktreePickerPort): WorkspacePickerPort {
  return {
    ...(worktrees === undefined ? {} : { worktrees }),
    workspaceIds: () => ctx.workspaces.list.getSnapshot().items.map(item => item.workspaceId),
  };
}
