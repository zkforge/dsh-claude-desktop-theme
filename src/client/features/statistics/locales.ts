export const STATS_COPY = {
  zh: {
    tabs: ['概览', '模型'], ranges: ['全部', '近30天', '近7天'],
    tiles: ['会话数', '消息数', 'Token 总量', '活跃天数', '高峰时段', '常用模型'],
    view: '统计视图', range: '时间范围', heat: '每日活跃热力图', chart: '各模型每日 Token 用量',
    empty: '此时间范围内暂无模型用量', input: '输入', output: '输出', less: '收起',
    more: (count: number) => `展开其余 ${count} 个模型`,
  },
  en: {
    tabs: ['Overview', 'Models'], ranges: ['All', 'Last 30 days', 'Last 7 days'],
    tiles: ['Sessions', 'Messages', 'Total tokens', 'Active days', 'Peak hour', 'Favorite model'],
    view: 'Statistics view', range: 'Time range', heat: 'Daily activity heatmap', chart: 'Daily token usage by model',
    empty: 'No model usage in this time range', input: 'Input', output: 'Output', less: 'Show less',
    more: (count: number) => `Show ${count} more ${count === 1 ? 'model' : 'models'}`,
  },
} as const;
