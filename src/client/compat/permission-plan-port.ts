import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';

export interface PermissionPlanPort {
  read(sessionId: string): { active: boolean } | null;
  set(sessionId: string, active: boolean): Promise<void>;
  subscribe(listener: () => void): () => void;
}

/** The pinned host exposes plan independently of sandbox/approval presets. */
export function permissionPlanPort(ctx: Context): PermissionPlanPort {
  // commands is an optional host package, absent from the plugin's SDK bundle.
  const remote = ctx.get('remote' as never) as unknown as {
    commands: { execute(id: string, line: string, attachments: readonly unknown[]): Promise<{
      ok: boolean; error?: { message: string }; value?: { result: { kind: string; text?: string } };
    }> };
  };
  type PlanState = { active: boolean; pending?: boolean };
  type Face = { getSnapshot(): unknown; subscribe(listener: () => void): () => void };
  let currentId: string | null = null;
  let currentFace: Face | undefined;
  let stopFace: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const faceFor = (id: string) => ctx.sessions.binding?.(id as Parameters<typeof ctx.sessions.binding>[0])
    ?.session.projections.faceOf('plan');
  const watchFace = (face: Face | undefined) => {
    if (face === currentFace) return;
    stopFace?.();
    currentFace = face;
    stopFace = listeners.size > 0 ? face?.subscribe(notify) : undefined;
  };
  return {
    read(id) {
      currentId = id;
      const face = faceFor(id);
      watchFace(face);
      const projections = ctx.sessions.list.getSnapshot().projectionsBySession as
        Readonly<Record<string, { values?: { plan?: { active: boolean; pending?: boolean } } }>>;
      // An open session uses the same live face as the native PlanChip. A missing
      // live value means capability absent; do not resurrect a stale catalog value.
      const plan = (face ? face.getSnapshot() : projections[id]?.values?.plan) as PlanState | undefined;
      return plan === undefined ? null : { active: plan.pending ? !plan.active : plan.active };
    },
    async set(id, active) {
      const result = await remote.commands.execute(id, active ? '/plan' : '/plan off', []);
      if (!result.ok) throw new Error(result.error?.message ?? 'Plan command failed');
      if (result.value === undefined || result.value.result.kind !== 'success') {
        throw new Error(result.value?.result.text ?? 'Plan command unavailable');
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) stopFace = currentFace?.subscribe(notify);
      const stopList = ctx.sessions.list.subscribe(() => {
        if (currentId !== null) watchFace(faceFor(currentId));
        listener();
      });
      return () => {
        stopList();
        listeners.delete(listener);
        if (listeners.size === 0) { stopFace?.(); stopFace = undefined; }
      };
    },
  };
}
