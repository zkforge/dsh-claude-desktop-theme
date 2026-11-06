import type { Context } from '@deepseek-ai/cordis';
import type { Disposer } from '../contracts/ports.ts';
import { mountWorkspaceMenu } from './workspace-menu.ts';
import { workspacePickerPort } from './workspace-picker-port.ts';
import { mountWorktreeSupport } from './workspace-worktree-port.ts';
import { mountWorktreeChip } from './workspace-worktree.ts';

/** Forge owns worktree intent even when its Git/session state renders no control.
 * Observe the service lifetime, never infer ownership from a transient DOM node. */
export function mountWorkspaceControls(ctx: Context, document: Document,
  workspaceOf: (session: string) => string | undefined, report: (error: unknown) => void): Disposer {
  let active = true;
  let native = ctx.get('remote.forgePanel' as never) !== undefined;
  let mounted: boolean | undefined;
  let release: Disposer = () => {};
  const sync = () => {
    if (!active || mounted === native) return;
    release();
    mounted = native;
    if (native) {
      release = mountWorkspaceMenu(document, workspacePickerPort(ctx), report);
      return;
    }
    const support = mountWorktreeSupport(ctx, document, report);
    const chip = mountWorktreeChip(document, support.choices, workspaceOf, report);
    const menu = mountWorkspaceMenu(document, workspacePickerPort(ctx, support.choices), report);
    release = () => { menu(); chip(); support.dispose(); };
  };
  const registration = ctx.inject(['remote.forgePanel'], () => {
    native = true;
    sync();
    return () => { native = false; sync(); };
  });
  sync();
  return () => {
    active = false;
    release();
    void registration.dispose();
  };
}
