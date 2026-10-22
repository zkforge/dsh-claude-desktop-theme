import type { Context } from '@deepseek-ai/cordis';

export interface ScheduleDeleteTask { readonly id: string; readonly sessionId: string; readonly title: string }
export interface ScheduleDeletePort {
  find(metadataId: string): Promise<ScheduleDeleteTask>;
  remove(task: ScheduleDeleteTask): Promise<void>;
}
export type Result<T> = { ok: true; value: T } | { ok: false; error?: { message?: string } };
export interface ScheduleTask extends ScheduleDeleteTask {
  readonly prompt: string;
  readonly scheduledAt: string;
  readonly status: 'active' | 'inactive';
}
export interface ScheduleHistory {
  id: string;
  records: { messageId: string; deliveredAt: string; scheduledAt?: string; prompt?: string }[];
  nextBefore?: string;
  earlierRecordsUnavailable?: boolean;
  earlierRecordsPruned?: boolean;
}
interface ScheduleRemote {
  catalog(): Promise<Result<ScheduleTask[]>>;
  history(request: { id: string; sessionId: string; limit: number; before?: string }): Promise<Result<ScheduleHistory | { id: string; code: string }>>;
  delete(request: { id: string; sessionId: string }): Promise<Result<{ id: string; deleted: boolean; code?: string }>>;
}

/** The optional schedule package is present in the pinned host but not its SDK. */
export function hostSchedule(ctx: Context): ScheduleRemote {
  const remote = ctx.get('remote' as never) as unknown as { schedule?: ScheduleRemote };
  if (!remote?.schedule) throw new Error('当前宿主未提供定时任务接口');
  return remote.schedule;
}

export function scheduleDeletePort(ctx: Context): ScheduleDeletePort {
  const schedule = () => hostSchedule(ctx);
  return {
    async find(metadataId) {
      const result = await schedule().catalog();
      if (!result.ok) throw new Error(result.error?.message ?? '无法读取任务，请稍后重试');
      // Native rows describe themselves with `${detailId}-metadata-${record.id}`.
      // Match the whole stored ID, never the title (different tasks may share it).
      const matches = result.value.filter(task => metadataId.endsWith(`-metadata-${task.id}`));
      if (matches.length !== 1) throw new Error('任务已变化或不可用，请刷新后重试');
      const task = matches[0]!;
      return Object.freeze({ id: task.id, sessionId: task.sessionId, title: task.title });
    },
    async remove(task) {
      const result = await schedule().delete({ id: task.id, sessionId: task.sessionId });
      if (!result.ok) throw new Error(result.error?.message ?? '无法确认任务是否已删除，请检查任务后重试');
      if (result.value.id !== task.id || (!result.value.deleted && result.value.code !== 'schedule_not_found')) {
        throw new Error('删除任务失败，请稍后重试');
      }
      // The host emits schedule/changed after its durable delete. Its existing
      // catalog subscription refreshes the list and empty state for every view.
    },
  };
}

/** Preparing the confirmation is read-only; only confirm() can delete. */
export async function prepareScheduleDeletion(port: ScheduleDeletePort, metadataId: string) {
  const task = await port.find(metadataId);
  let pending: Promise<void> | undefined;
  let deleted = false;
  return { task, confirm(): Promise<void> {
    if (deleted) return Promise.resolve();
    if (!pending) {
      pending = Promise.resolve().then(() => port.remove(task)).then(() => { deleted = true; })
        .finally(() => { pending = undefined; });
    }
    return pending;
  } };
}
