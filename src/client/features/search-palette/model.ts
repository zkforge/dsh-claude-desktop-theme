import type {
  PaletteProject, PaletteSchedule, PaletteScheduleRule, PaletteScheduleRuns, PaletteSession, SearchPaletteSnapshot,
} from '../../contracts/ports.ts';

/** The palette's type filter; `all` mixes every list. */
export type PaletteTab = 'all' | 'session' | 'project' | 'schedule';

/** The first matched run of a label, as UTF-16 offsets. */
export type MatchRange = readonly [start: number, end: number] | null;

export type PaletteEntry =
  | { readonly kind: 'session'; readonly key: string; readonly session: PaletteSession; readonly match: MatchRange; readonly snippet: string | null }
  | { readonly kind: 'project'; readonly key: string; readonly project: PaletteProject; readonly match: MatchRange }
  | { readonly kind: 'schedule'; readonly key: string; readonly schedule: PaletteSchedule; readonly match: MatchRange }
  | { readonly kind: 'action'; readonly key: string; readonly prompt: string }
  | { readonly kind: 'filter'; readonly key: string; readonly tab: PaletteTab };

export interface PaletteSection {
  readonly id: string;
  readonly title: string;
  readonly entries: readonly PaletteEntry[];
}

/** One row of an entry's `…` menu; `primary` is what Enter does on the row. */
export interface PaletteAction {
  readonly id: 'open' | 'pin' | 'unpin' | 'fork' | 'archive' | 'unarchive' | 'new-session' | 'copy-path' | 'open-session';
  readonly label: string;
  readonly primary?: boolean;
}

export interface PaletteCopy {
  readonly placeholder: string;
  readonly close: string;
  readonly tabs: Readonly<Record<PaletteTab, string>>;
  readonly recent: string;
  readonly actions: string;
  readonly filters: string;
  readonly newSession: string;
  readonly empty: string;
  readonly archived: string;
  readonly running: string;
  readonly ended: string;
  readonly more: string;
  readonly hints: { readonly close: string; readonly tabs: string; readonly filter: string; readonly actions: string };
  readonly menu: Readonly<Record<PaletteAction['id'], string>>;
  readonly runs: (count: number, more: boolean) => string;
  readonly sessionCount: (count: number) => string;
  readonly daily: string;
  readonly weekdays: string;
  readonly weekday: readonly string[];
  readonly weeklyPrefix: string;
  readonly weekdaySeparator: string;
  readonly every: (amount: number, unit: 'hour' | 'minute' | 'second') => string;
  readonly date: (month: number, day: number, year: number | null) => string;
  readonly failed: (message: string) => string;
}

const COPY: { readonly zh: PaletteCopy; readonly en: PaletteCopy } = {
  zh: {
    placeholder: '搜索',
    close: '关闭',
    tabs: { all: '全部', session: '会话', project: '项目', schedule: '定时任务' },
    recent: '最近使用',
    actions: '操作',
    filters: '筛选条件',
    newSession: '新建会话',
    empty: '没有匹配的结果',
    archived: '已归档',
    running: '运行中',
    ended: '已结束',
    more: '更多操作',
    hints: { close: '关闭', tabs: '切换类型', filter: '筛选条件', actions: '操作' },
    menu: {
      open: '打开', pin: '置顶', unpin: '取消置顶', fork: '创建分支', archive: '归档', unarchive: '取消归档',
      'new-session': '新建会话', 'copy-path': '复制路径', 'open-session': '打开所在会话',
    },
    runs: (count, more) => `${count}${more ? '+' : ''} 次运行`,
    sessionCount: count => `${count} 个会话`,
    daily: '每天',
    weekdays: '工作日',
    weekday: ['一', '二', '三', '四', '五', '六', '日'],
    weeklyPrefix: '每周',
    weekdaySeparator: '、',
    every: (amount, unit) => {
      const name = { hour: '小时', minute: '分钟', second: '秒' }[unit];
      return amount === 1 && unit !== 'second' ? `每${name}` : `每 ${amount} ${name}`;
    },
    date: (month, day, year) => `${year === null ? '' : `${year}年`}${month}月${day}日`,
    failed: message => `操作失败：${message}`,
  },
  en: {
    placeholder: 'Search',
    close: 'Close',
    tabs: { all: 'All', session: 'Sessions', project: 'Projects', schedule: 'Scheduled tasks' },
    recent: 'Recent',
    actions: 'Actions',
    filters: 'Filters',
    newSession: 'New session',
    empty: 'No results',
    archived: 'Archived',
    running: 'Running',
    ended: 'Ended',
    more: 'More actions',
    hints: { close: 'Close', tabs: 'Switch type', filter: 'Filter', actions: 'Actions' },
    menu: {
      open: 'Open', pin: 'Pin', unpin: 'Unpin', fork: 'Fork', archive: 'Archive', unarchive: 'Unarchive',
      'new-session': 'New session', 'copy-path': 'Copy path', 'open-session': 'Open session',
    },
    runs: (count, more) => `${count}${more ? '+' : ''} ${count === 1 && !more ? 'run' : 'runs'}`,
    sessionCount: count => `${count} ${count === 1 ? 'session' : 'sessions'}`,
    daily: 'Daily',
    weekdays: 'Weekdays',
    weekday: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    weeklyPrefix: '',
    weekdaySeparator: ', ',
    every: (amount, unit) => {
      if (amount === 1 && unit === 'hour') return 'Hourly';
      if (amount === 1 && unit === 'minute') return 'Every minute';
      return `Every ${amount} ${{ hour: 'h', minute: 'min', second: 's' }[unit]}`;
    },
    date: (month, day, year) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]} ${day}${year === null ? '' : `, ${year}`}`,
    failed: message => `Action failed: ${message}`,
  },
};

/** The palette's own words, in the document's language. */
export function paletteCopy(language: string): PaletteCopy {
  return language.toLowerCase().startsWith('zh') ? COPY.zh : COPY.en;
}

/** Words a `/` filter answers to, besides its own label in either language. */
const FILTER_ALIASES: Readonly<Record<PaletteTab, readonly string[]>> = {
  all: ['all', '全部'],
  session: ['session', 'sessions', 'chat', 'code', '会话'],
  project: ['project', 'projects', 'workspace', 'folder', '项目'],
  schedule: ['schedule', 'scheduled', 'task', 'tasks', 'routine', '定时任务'],
};

const RECENT_LIMIT = 8;
/** Per-type rows under 全部 while searching; the type's own tab lists them all. */
const MIXED_LIMIT = 6;
/** The longest list one tab draws; a query narrows past it. */
const LIST_LIMIT = 200;

/** `HH:mm[:ss.SSS]` → `9:51`, the reference's unpadded hour. */
function clock(time: string): string {
  const [hours = '0', minutes = '00'] = time.split(':');
  return `${Number(hours)}:${minutes.padStart(2, '0')}`;
}

/** The repeat rule as the reference's title suffix: 每天 9:51 / Daily 9:51. */
export function scheduleRuleLabel(rule: PaletteScheduleRule, copy: PaletteCopy, now = new Date()): string {
  switch (rule.kind) {
    case 'daily': return `${copy.daily} ${clock(rule.time)}`;
    case 'weekly': {
      const days = [...new Set(rule.weekdays)].filter(day => day >= 1 && day <= 7).sort();
      if (days.length === 7) return `${copy.daily} ${clock(rule.time)}`;
      if (days.join() === '1,2,3,4,5') return `${copy.weekdays} ${clock(rule.time)}`;
      return `${copy.weeklyPrefix}${days.map(day => copy.weekday[day - 1]).join(copy.weekdaySeparator)} ${clock(rule.time)}`;
    }
    case 'every': {
      const seconds = Math.max(1, Math.round(rule.seconds));
      if (seconds % 3600 === 0) return copy.every(seconds / 3600, 'hour');
      if (seconds % 60 === 0) return copy.every(seconds / 60, 'minute');
      return copy.every(seconds, 'second');
    }
    case 'cron': return `Cron ${rule.expression}`;
    case 'once': {
      const at = new Date(rule.at);
      if (Number.isNaN(at.getTime())) return '';
      const year = at.getFullYear() === now.getFullYear() ? null : at.getFullYear();
      return `${copy.date(at.getMonth() + 1, at.getDate(), year)} ${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`;
    }
  }
}

/** What a schedule row reads: the task name, then its repeat rule. */
export function scheduleLabel(schedule: PaletteSchedule, copy: PaletteCopy, now = new Date()): string {
  const rule = scheduleRuleLabel(schedule.rule, copy, now);
  return rule === '' ? schedule.title : `${schedule.title} · ${rule}`;
}

/** The right-hand reading of a schedule row. */
export function scheduleMeta(schedule: PaletteSchedule, runs: PaletteScheduleRuns | undefined, copy: PaletteCopy): string {
  if (!schedule.active) return copy.ended;
  return runs === undefined ? '' : copy.runs(runs.count, runs.more);
}

/** Case-insensitive first occurrence, or null; an empty query matches nothing. */
export function matchRange(text: string, query: string): MatchRange {
  if (query === '') return null;
  const at = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  return at < 0 ? null : [at, at + query.length];
}

/** 0 for a prefix, 1 for a word start, 2 for any other occurrence. */
function rank(text: string, match: MatchRange): number {
  if (match === null) return 3;
  if (match[0] === 0) return 0;
  return /[\s\-_/.·:]/u.test(text[match[0] - 1] ?? '') ? 1 : 2;
}

interface Scored<T> { readonly value: T; readonly score: number; readonly order: number }
const byScore = <T>(a: Scored<T>, b: Scored<T>) => a.score - b.score || a.order - b.order;

/** The first range that hits, over the fields a row is found by. */
function firstMatch(query: string, ...fields: readonly string[]): { field: number; match: MatchRange } {
  for (let field = 0; field < fields.length; field++) {
    const match = matchRange(fields[field]!, query);
    if (match) return { field, match };
  }
  return { field: -1, match: null };
}

export interface PaletteQuery {
  /** The field's raw text; a leading `/` asks for the filter list. */
  readonly query: string;
  readonly tab: PaletteTab;
  /** Content hits from the host search for this query, by Session id. */
  readonly content?: ReadonlyMap<string, string> | undefined;
  readonly now?: Date;
}

/** Which tabs this build can fill. */
export function paletteTabs(snapshot: SearchPaletteSnapshot): readonly PaletteTab[] {
  return snapshot.schedules === null ? ['all', 'session', 'project'] : ['all', 'session', 'project', 'schedule'];
}

/** Whether the field's text asks for the filter list rather than a search. */
export function isFilterQuery(query: string): boolean {
  return query.trimStart().startsWith('/');
}

/** Sessions by recency, newest first; host order breaks ties. */
function sessionsByRecency(sessions: readonly PaletteSession[]): PaletteSession[] {
  return sessions.map((session, order) => ({ session, order }))
    .sort((a, b) => b.session.updatedAt - a.session.updatedAt || a.order - b.order)
    .map(item => item.session);
}

/** Active tasks first, then the most recently run. */
function schedulesInOrder(schedules: readonly PaletteSchedule[]): PaletteSchedule[] {
  return schedules.map((schedule, order) => ({ schedule, order }))
    .sort((a, b) => Number(b.schedule.active) - Number(a.schedule.active)
      || (b.schedule.lastRunAt ?? 0) - (a.schedule.lastRunAt ?? 0) || a.order - b.order)
    .map(item => item.schedule);
}

const sessionEntry = (session: PaletteSession, match: MatchRange = null, snippet: string | null = null): PaletteEntry =>
  ({ kind: 'session', key: `session:${session.id}`, session, match, snippet });
const projectEntry = (project: PaletteProject, match: MatchRange = null): PaletteEntry =>
  ({ kind: 'project', key: `project:${project.id}`, project, match });
const scheduleEntry = (schedule: PaletteSchedule, match: MatchRange = null): PaletteEntry =>
  ({ kind: 'schedule', key: `schedule:${schedule.id}`, schedule, match });

/**
 * The palette's sections for one query and tab.
 *
 * Without a query, 全部 shows the reference's 最近使用 (Sessions and tasks by
 * their last activity) above its 操作, and each type tab lists its own rows.
 * With a query, rows are found by title (a project also by path, a task also
 * by its prompt), ranked prefix → word start → anywhere, then by recency;
 * Sessions the host's content search found are appended with their snippet.
 */
export function paletteSections(snapshot: SearchPaletteSnapshot, input: PaletteQuery, copy: PaletteCopy): PaletteSection[] {
  const tabs = paletteTabs(snapshot);
  const tab = tabs.includes(input.tab) ? input.tab : 'all';
  const now = input.now ?? new Date();
  if (isFilterQuery(input.query)) {
    const wanted = input.query.trimStart().slice(1).trim().toLocaleLowerCase();
    const entries = tabs.filter(candidate => wanted === ''
      || [copy.tabs[candidate], ...FILTER_ALIASES[candidate]].some(word => word.toLocaleLowerCase().startsWith(wanted)))
      .map((candidate): PaletteEntry => ({ kind: 'filter', key: `filter:${candidate}`, tab: candidate }));
    return [{ id: 'filters', title: copy.filters, entries }];
  }
  const query = input.query.trim();
  const live = snapshot.sessions.filter(session => !session.archived);
  const schedules = snapshot.schedules ?? [];
  const sections: PaletteSection[] = [];
  const push = (id: string, title: string, entries: readonly PaletteEntry[]) => {
    if (entries.length > 0) sections.push({ id, title, entries });
  };

  if (query === '') {
    if (tab === 'all') {
      const recent = [
        ...live.map(session => ({ at: session.updatedAt, entry: sessionEntry(session) })),
        ...schedules.filter(schedule => schedule.lastRunAt !== null)
          .map(schedule => ({ at: schedule.lastRunAt!, entry: scheduleEntry(schedule) })),
      ].sort((a, b) => b.at - a.at).slice(0, RECENT_LIMIT).map(item => item.entry);
      push('recent', copy.recent, recent);
      push('actions', copy.actions, [{ kind: 'action', key: 'action:new', prompt: '' }]);
    }
    if (tab === 'session') push('sessions', copy.tabs.session, sessionsByRecency(live).slice(0, LIST_LIMIT).map(session => sessionEntry(session)));
    if (tab === 'project') push('projects', copy.tabs.project, snapshot.projects.slice(0, LIST_LIMIT).map(project => projectEntry(project)));
    if (tab === 'schedule') push('schedules', copy.tabs.schedule, schedulesInOrder(schedules).slice(0, LIST_LIMIT).map(schedule => scheduleEntry(schedule)));
    return sections;
  }

  const limit = tab === 'all' ? MIXED_LIMIT : LIST_LIMIT;
  if (tab === 'all' || tab === 'session') {
    const found: Scored<PaletteEntry>[] = [];
    const seen = new Set<string>();
    sessionsByRecency(snapshot.sessions).forEach((session, order) => {
      const match = matchRange(session.title, query);
      if (!match) return;
      seen.add(session.id);
      /* An archived Session is still found, after every live one. */
      found.push({ value: sessionEntry(session, match), score: rank(session.title, match) + (session.archived ? 4 : 0), order });
    });
    let order = found.length;
    const byId = new Map(snapshot.sessions.map(session => [session.id, session]));
    for (const [id, snippet] of input.content ?? []) {
      const session = byId.get(id);
      if (session === undefined || seen.has(id)) continue;
      found.push({ value: sessionEntry(session, null, snippet), score: 8 + (session.archived ? 1 : 0), order: order++ });
    }
    push('sessions', copy.tabs.session, found.sort(byScore).slice(0, limit).map(item => item.value));
  }
  if (tab === 'all' || tab === 'project') {
    const found: Scored<PaletteEntry>[] = [];
    snapshot.projects.forEach((project, order) => {
      const { field, match } = firstMatch(query, project.title, project.path);
      if (field < 0) return;
      found.push({ value: projectEntry(project, field === 0 ? match : null), score: field === 0 ? rank(project.title, match) : 3, order });
    });
    push('projects', copy.tabs.project, found.sort(byScore).slice(0, limit).map(item => item.value));
  }
  if ((tab === 'all' || tab === 'schedule') && snapshot.schedules !== null) {
    const found: Scored<PaletteEntry>[] = [];
    schedulesInOrder(schedules).forEach((schedule, order) => {
      const label = scheduleLabel(schedule, copy, now);
      const { field, match } = firstMatch(query, label, schedule.prompt);
      if (field < 0) return;
      found.push({ value: scheduleEntry(schedule, field === 0 ? match : null), score: field === 0 ? rank(label, match) : 3, order });
    });
    push('schedules', copy.tabs.schedule, found.sort(byScore).slice(0, limit).map(item => item.value));
  }
  if (tab === 'all') push('actions', copy.actions, [{ kind: 'action', key: 'action:new', prompt: query }]);
  return sections;
}

/** An entry's `…` menu, primary action first; empty for rows without one. */
export function entryActions(entry: PaletteEntry, copy: PaletteCopy): readonly PaletteAction[] {
  const action = (id: PaletteAction['id'], primary = false): PaletteAction => ({ id, label: copy.menu[id], primary });
  switch (entry.kind) {
    case 'session': return [
      action('open', true),
      action(entry.session.pinned ? 'unpin' : 'pin'),
      action('fork'),
      action(entry.session.archived ? 'unarchive' : 'archive'),
    ];
    case 'project': return [action('new-session', true), action('copy-path')];
    case 'schedule': return [action('open', true), action('open-session')];
    default: return [];
  }
}

/** Relative activity time for a Session row: 3 小时前 / 3 hours ago. */
export function relativeTime(at: number, language: string, now = Date.now()): string {
  const seconds = Math.round((at - now) / 1000);
  const format = new Intl.RelativeTimeFormat(language || 'en', { numeric: 'auto' });
  const steps: readonly [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'], [3600, 'minute'], [86_400, 'hour'], [604_800, 'day'], [2_629_800, 'week'], [31_557_600, 'month'],
  ];
  const size: Readonly<Record<string, number>> = { second: 1, minute: 60, hour: 3600, day: 86_400, week: 604_800, month: 2_629_800, year: 31_557_600 };
  for (const [limit, unit] of steps) {
    if (Math.abs(seconds) < limit) return unit === 'second' ? format.format(0, 'second') : format.format(Math.round(seconds / size[unit]!), unit);
  }
  return format.format(Math.round(seconds / size.year!), 'year');
}
