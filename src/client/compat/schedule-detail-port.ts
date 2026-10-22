import type { Context } from '@deepseek-ai/cordis';
import { hostSchedule, type ScheduleTask, type ScheduleHistory } from './schedule-delete-port.ts';
export type { ScheduleTask, ScheduleHistory } from './schedule-delete-port.ts';

export interface ScheduleDetailPort {
  list(): Promise<readonly ScheduleTask[]>;
  history(task: ScheduleTask, before?: string): Promise<ScheduleHistory>;
  subscribe(listener: () => void): () => void;
}

/** Exact persisted identity, shared by previews and the full-page detail. */
export function taskForMetadata(records: readonly ScheduleTask[], metadata: string): ScheduleTask | undefined {
  const matches = records.filter(task => metadata.endsWith(`-metadata-${task.id}`));
  return matches.length === 1 ? matches[0] : undefined;
}

export function scheduleDetailPort(ctx: Context): ScheduleDetailPort {
  return {
    async list() {
      const result = await hostSchedule(ctx).catalog();
      if (!result.ok) throw new Error(result.error?.message ?? '无法读取任务');
      return result.value;
    },
    async history(task, before) {
      const result = await hostSchedule(ctx).history({ id: task.id, sessionId: task.sessionId, limit: 20,
        ...(before === undefined ? {} : { before }) });
      if (!result.ok) throw new Error(result.error?.message ?? '无法读取运行记录');
      if ('code' in result.value) throw new Error(result.value.code === 'schedule_not_found' ? '任务已不可用' : '运行记录已更新，请返回任务列表后重试');
      if (result.value.id !== task.id) throw new Error('运行记录与当前任务不匹配');
      return result.value;
    },
    subscribe(listener) {
      const remote = ctx.get('remote' as never) as unknown as { $on(event: string, listener: () => void): () => void };
      const stop = remote.$on('schedule/changed', listener);
      const reset = ctx.on('connection/reset', listener);
      return () => { stop(); reset(); };
    },
  };
}
