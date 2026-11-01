export interface ScheduleTemplate {
  name: string;
  description: string;
  frequency: string;
  prompt: string;
}

/** Suggestions, not scheduled records: all require review and explicit sending. */
export const SCHEDULE_TEMPLATES: readonly ScheduleTemplate[] = [
  { name: '简报', description: '您的日历、邮件和消息摘要。', frequency: '工作日 09:00', prompt: '每个工作日早上 9 点，整理我可访问的日历、邮件和消息，生成今日简报。请先确认数据来源与时区，再创建定时任务。' },
  { name: '邮件分类处理', description: '为收件箱中的邮件分类并排定优先级，同时为紧急事项起草回复。', frequency: '工作日 17:00', prompt: '每个工作日下午 5 点，对我授权访问的收件箱进行分类、排定优先级，并为紧急事项起草回复，不自动发送。请先确认邮箱与时区，再创建定时任务。' },
  { name: '系统健康检查', description: '监控基础设施和服务中的错误、中断和性能问题。', frequency: '每天 09:00', prompt: '每天早上 9 点，检查当前项目中可访问的服务日志和健康指标，汇总错误、中断和性能问题。请先确认检查范围与时区，再创建定时任务。' },
  { name: '问题分类处理', description: '审查新提交的议题、缺陷和功能请求，并进行分类。', frequency: '工作日 16:00', prompt: '每个工作日下午 4 点，审查当前项目新提交的议题、缺陷和功能请求，给出分类和优先级建议。请先确认仓库与时区，再创建定时任务。' },
  { name: 'PR 审查摘要', description: '概览未关闭的 PR、审查状态以及需要关注的事项。', frequency: '工作日 10:00', prompt: '每个工作日上午 10 点，汇总当前仓库未关闭的 PR、审查状态和需要我关注的事项。请先确认仓库与时区，再创建定时任务。' },
  { name: '依赖项更新检查', description: '扫描过时的软件包、安全补丁和破坏性变更。', frequency: '每星期二 09:00', prompt: '每周二早上 9 点，检查当前项目的过时依赖、安全补丁和破坏性变更，生成更新建议，不自动修改文件。请先确认范围与时区，再创建定时任务。' },
  { name: '发布说明起草器', description: '汇总近期合并的 PR，起草面向用户的发布说明。', frequency: '每星期五 16:00', prompt: '每周五下午 4 点，汇总当前仓库本周合并的 PR，起草面向用户的发布说明。请先确认仓库与时区，再创建定时任务。' },
  { name: '不稳定测试跟踪器', description: '找出近期 CI 运行中时而通过、时而失败的测试。', frequency: '每天 10:00', prompt: '每天上午 10 点，检查当前项目近期的 CI 运行，找出时而通过、时而失败的测试，附上证据和排查建议。请先确认仓库与时区，再创建定时任务。' },
];

const EN_TEMPLATES: readonly ScheduleTemplate[] = [
  { name: 'Daily briefing', description: 'A summary of your calendar, email and messages.', frequency: 'Weekdays at 09:00', prompt: 'Every weekday at 9 AM, summarize the calendars, email and messages I have authorized you to access into a daily briefing. Confirm the data sources and time zone before creating the scheduled task.' },
  { name: 'Email triage', description: 'Categorize and prioritize inbox messages, and draft replies to urgent items.', frequency: 'Weekdays at 17:00', prompt: 'Every weekday at 5 PM, categorize and prioritize messages in my authorized inbox, and draft replies to urgent items without sending them. Confirm the mailbox and time zone before creating the scheduled task.' },
  { name: 'System health check', description: 'Monitor infrastructure and services for errors, outages and performance issues.', frequency: 'Daily at 09:00', prompt: 'Every day at 9 AM, review accessible service logs and health metrics for the current project, and summarize errors, outages and performance issues. Confirm the scope and time zone before creating the scheduled task.' },
  { name: 'Issue triage', description: 'Review and categorize newly submitted issues, bugs and feature requests.', frequency: 'Weekdays at 16:00', prompt: 'Every weekday at 4 PM, review new issues, bugs and feature requests for the current project, and suggest categories and priorities. Confirm the repository and time zone before creating the scheduled task.' },
  { name: 'PR review summary', description: 'An overview of open PRs, review status and items needing your attention.', frequency: 'Weekdays at 10:00', prompt: 'Every weekday at 10 AM, summarize open PRs, review status and items needing my attention in the current repository. Confirm the repository and time zone before creating the scheduled task.' },
  { name: 'Dependency update check', description: 'Check for outdated packages, security patches and breaking changes.', frequency: 'Tuesdays at 09:00', prompt: 'Every Tuesday at 9 AM, check the current project for outdated dependencies, security patches and breaking changes, and suggest updates without modifying files. Confirm the scope and time zone before creating the scheduled task.' },
  { name: 'Release notes drafter', description: 'Summarize recently merged PRs into release notes for users.', frequency: 'Fridays at 16:00', prompt: 'Every Friday at 4 PM, summarize PRs merged this week in the current repository and draft release notes for users. Confirm the repository and time zone before creating the scheduled task.' },
  { name: 'Flaky test tracker', description: 'Find tests that intermittently pass and fail in recent CI runs.', frequency: 'Daily at 10:00', prompt: 'Every day at 10 AM, review recent CI runs for the current project, identify intermittently failing tests, and provide evidence and debugging suggestions. Confirm the repository and time zone before creating the scheduled task.' },
];

const COPY = {
  zh: {
    title: '定时任务', mine: '我的', templates: '模板', view: '任务视图', search: '搜索任务', filter: '筛选任务',
    searchPlaceholder: '搜索计划任务…', status: '状态', closeSearch: '关闭搜索', templateRegion: '定时任务模板',
    newTask: '新建任务', empty: '暂无计划任务。', suggestions: SCHEDULE_TEMPLATES,
    defaultPrompt: '帮我设置一个定时任务。问我它应该做什么、多久运行一次以及在什么时间运行,然后创建它。',
    location: '位置', nextRun: (time: string) => `下次运行：${time}`, ended: '已结束',
    history: '历史记录', loadingHistory: '正在读取运行记录…', emptyHistory: '暂无运行记录', historyError: '无法读取运行记录',
    prompt: '指令', frequency: '重复频率', actions: '任务操作', deleteTask: '删除任务', deleteTitle: '删除定时任务？',
    deleteDescription: (title: string) => `删除“${title}”？其过往运行记录也将被删除。此操作无法撤销。原会话及其消息仍然保留。`,
    actionLabel: (title: string) => `任务操作：${title}`,
    thisTask: '此任务', loadingTask: '正在读取任务…', cancel: '取消', remove: '删除', deleting: '正在删除…',
    deleteError: '删除失败，请稍后重试', identifyError: '无法识别任务，请刷新后重试',
    changedError: '任务已变化，请重新选择', readError: '无法读取任务，请稍后重试',
  },
  en: {
    title: 'Scheduled tasks', mine: 'Mine', templates: 'Templates', view: 'Task view', search: 'Search tasks', filter: 'Filter tasks',
    searchPlaceholder: 'Search scheduled tasks…', status: 'Status', closeSearch: 'Close search', templateRegion: 'Scheduled task templates',
    newTask: 'New task', empty: 'No scheduled tasks yet.', suggestions: EN_TEMPLATES,
    defaultPrompt: 'Help me set up a scheduled task. Ask what it should do, how often it should run and at what time, then create it.',
    location: 'Location', nextRun: (time: string) => `Next run: ${time}`, ended: 'Ended',
    history: 'History', loadingHistory: 'Loading run history…', emptyHistory: 'No runs yet', historyError: 'Unable to load run history',
    prompt: 'Instructions', frequency: 'Repeat frequency', actions: 'Task actions', deleteTask: 'Delete task', deleteTitle: 'Delete scheduled task?',
    deleteDescription: (title: string) => `Delete “${title}”? Its past runs will also be deleted. This cannot be undone. The original conversation and its messages will be kept.`,
    actionLabel: (title: string) => `Task actions: ${title}`,
    thisTask: 'this task', loadingTask: 'Loading task…', cancel: 'Cancel', remove: 'Delete', deleting: 'Deleting…',
    deleteError: 'Deletion failed. Please try again later.', identifyError: 'Unable to identify the task. Refresh and try again.',
    changedError: 'The task has changed. Select it again.', readError: 'Unable to load the task. Please try again later.',
  },
} as const;

/** The page, task details, menus and draft preparation share DSH's language. */
export function scheduleCopy(document: Document) {
  return COPY[document.documentElement.lang.toLowerCase().startsWith('zh') ? 'zh' : 'en'];
}

