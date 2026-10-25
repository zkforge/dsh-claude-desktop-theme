import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type {
  PaletteSchedule, PaletteScheduleRule, PaletteSession, SearchPalettePort, SearchPaletteSnapshot,
} from '../contracts/ports.ts';
import { hostSchedule, type ScheduleTask } from './schedule-delete-port.ts';

/** `schedule/catalog()` rows carry their rule beside the shared task fields.
 * Source: dsh-schedule's generated catalog schema (`after`/`at`/`every`/`daily`/`weekly`/`cron`). */
interface ScheduleRecord extends ScheduleTask {
  readonly kind?: string;
  readonly everySeconds?: number;
  readonly time?: string;
  readonly weekdays?: readonly number[];
  readonly expression?: string;
  readonly lastDelivery?: { readonly deliveredAt: string };
}

/** The panel id `ui-schedule` registers its page and its sidebar row under. */
const SCHEDULE_PANEL = 'schedules';
/** How long a task row may take to render after its page is selected. */
const SCHEDULE_ROW_WAIT_MS = 3000;

function ruleOf(record: ScheduleRecord): PaletteScheduleRule {
  if (record.kind === 'every' && typeof record.everySeconds === 'number') return { kind: 'every', seconds: record.everySeconds };
  if (record.kind === 'daily' && typeof record.time === 'string') return { kind: 'daily', time: record.time };
  if (record.kind === 'weekly' && typeof record.time === 'string' && Array.isArray(record.weekdays)) {
    return { kind: 'weekly', time: record.time, weekdays: record.weekdays };
  }
  if (record.kind === 'cron' && typeof record.expression === 'string') return { kind: 'cron', expression: record.expression };
  return { kind: 'once', at: record.scheduledAt };
}

function scheduleOf(record: ScheduleRecord): PaletteSchedule {
  const delivered = record.lastDelivery === undefined ? Number.NaN : Date.parse(record.lastDelivery.deliveredAt);
  return Object.freeze({
    id: record.id, sessionId: record.sessionId, title: record.title, prompt: record.prompt,
    rule: ruleOf(record), active: record.status === 'active',
    lastRunAt: Number.isNaN(delivered) ? null : delivered,
  });
}

/** Read the palette's lists from the host catalogs and drive the host's own navigation. */
export function searchPalettePort(ctx: Context, document: Document, report: (error: unknown) => void): SearchPalettePort {
  type SessionId = Parameters<typeof ctx.sessions.subagentAddress>[0];
  type WorkspaceId = NonNullable<Parameters<typeof ctx.uiWorkspace.startSession>[0]>;
  type PanelId = Parameters<typeof ctx.layout.selectPanel>[0];
  const listeners = new Set<() => void>();
  let records: readonly ScheduleRecord[] | null = null;
  let scheduleRead = 0;
  let cache: { sessions: unknown; workspaces: unknown; records: unknown; value: SearchPaletteSnapshot } | null = null;
  let waiting: { observer: MutationObserver; timer: ReturnType<typeof setTimeout> } | null = null;
  const notify = () => { for (const listener of listeners) listener(); };

  const read = (): SearchPaletteSnapshot => {
    const list = ctx.sessions.list.getSnapshot();
    const workspaces = ctx.workspaces.list.getSnapshot();
    if (cache && cache.sessions === list && cache.workspaces === workspaces && cache.records === records) return cache.value;
    const archived = new Set<string>(workspaces.archivedSessionIds);
    const pinned = new Set<string>(workspaces.pinnedSessionIds);
    const owner = new Map<string, string>();
    for (const item of workspaces.items) for (const id of item.sessionIds) owner.set(id, item.title);
    const sessions: PaletteSession[] = [];
    for (const id of list.ids) {
      const row = list.byId[id];
      if (row === undefined || row.blank || row.origin === 'subagent') continue;
      sessions.push(Object.freeze({
        id, title: row.displayTitle, workspace: owner.get(id) ?? null, updatedAt: row.updatedAt,
        running: row.running, archived: archived.has(id), pinned: pinned.has(id),
      }));
    }
    const value: SearchPaletteSnapshot = Object.freeze({
      sessions: Object.freeze(sessions),
      projects: Object.freeze(workspaces.items.map(item => Object.freeze({
        id: item.workspaceId, title: item.title, path: item.path, sessions: item.sessionIds.length,
      }))),
      schedules: records === null ? null : Object.freeze(records.map(scheduleOf)),
    });
    cache = { sessions: list, workspaces, records, value };
    return value;
  };

  const refreshSchedules = () => {
    const mine = ++scheduleRead;
    let remote;
    try { remote = hostSchedule(ctx); } catch { return; }
    remote.catalog().then(result => {
      if (mine !== scheduleRead) return;
      if (!result.ok) { report(new Error(result.error?.message ?? 'schedule catalog unavailable')); return; }
      records = Object.freeze(result.value as ScheduleRecord[]);
      notify();
    }, report);
  };

  const stopWaiting = () => {
    if (!waiting) return;
    waiting.observer.disconnect(); clearTimeout(waiting.timer); waiting = null;
  };

  return {
    getSnapshot: read,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size > 1) return () => { listeners.delete(listener); };
      const releases = [ctx.sessions.list.subscribe(notify), ctx.workspaces.list.subscribe(notify)];
      try {
        const remote = ctx.get('remote' as never) as unknown as { $on(event: string, listener: () => void): () => void };
        releases.push(remote.$on('schedule/changed', refreshSchedules));
      } catch (error) { report(error); }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) { for (const release of releases) release(); stopWaiting(); }
      };
    },
    refreshSchedules,
    async scheduleRuns(id) {
      const task = records?.find(record => record.id === id);
      if (task === undefined) return { count: 0, more: false };
      const result = await hostSchedule(ctx).history({ id: task.id, sessionId: task.sessionId, limit: 100 });
      if (!result.ok) throw new Error(result.error?.message ?? 'schedule history unavailable');
      if ('code' in result.value) return { count: 0, more: false };
      return { count: result.value.records.length, more: result.value.nextBefore !== undefined };
    },
    async searchContent(query, signal) {
      const result = await ctx.sessions.search(query, signal);
      if (!result.ok) throw new Error(result.error.message);
      return result.value.items;
    },
    openSession(id) {
      ctx.layout.beginNavigation();
      ctx.uiWorkspace.openSession(ctx.sessions.subagentAddress(id as SessionId) ?? id as SessionId);
    },
    startSession(options = {}) {
      const prompt = options.prompt?.trim();
      ctx.uiWorkspace.startSession(
        options.workspaceId as WorkspaceId | undefined,
        prompt ? { prompt, whenDraftExists: 'append' } : undefined,
      );
    },
    openSchedule(id) {
      stopWaiting();
      ctx.layout.beginNavigation();
      ctx.layout.selectPanel(SCHEDULE_PANEL as PanelId);
      /* The page's task cards name their task only in `aria-describedby`
         (`…-metadata-${id}`); clicking one is what `schedule-detail.ts` turns
         into the full-page detail, so the palette reuses that path. */
      const reveal = () => {
        const page = document.querySelector('[data-testid="task-manager-page"]');
        const card = Array.from(page?.querySelectorAll<HTMLElement>('li > button[aria-describedby]') ?? [])
          .find(button => button.getAttribute('aria-describedby')?.endsWith(`-metadata-${id}`));
        if (!card) return false;
        stopWaiting(); card.click();
        return true;
      };
      if (reveal()) return;
      const observer = new MutationObserver(() => { reveal(); });
      observer.observe(document.body, { childList: true, subtree: true });
      waiting = { observer, timer: setTimeout(stopWaiting, SCHEDULE_ROW_WAIT_MS) };
    },
    setPinned: (id, pinned) => pinned
      ? ctx.uiWorkspace.pinSession(id as SessionId) : ctx.uiWorkspace.unpinSession(id as SessionId),
    setArchived: (id, archived) => archived
      ? ctx.uiWorkspace.archiveSession(id as SessionId) : ctx.uiWorkspace.unarchiveSession(id as SessionId),
    async fork(id) {
      const child = await ctx.uiWorkspace.forkSession(id as SessionId);
      ctx.uiWorkspace.openSession(child);
    },
    copy: text => document.defaultView?.navigator.clipboard.writeText(text) ?? Promise.reject(new Error('clipboard unavailable')),
  };
}
