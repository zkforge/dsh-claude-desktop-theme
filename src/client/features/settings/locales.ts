/**
 * Copy for the row configuration page.
 *
 * The page is the plugin's only owned surface with its own words: everything
 * else mirrors a host label. The dictionary is registered through the locale
 * service and the keys are merged into the slots' namespace table, so the `t`
 * seat stays typed and follows the user's language without a remount.
 */
export const SETTINGS_NAMESPACE = 'ccdSettings';

/** Simplified Chinese dictionary; the key set is the source of truth. */
export const zh = {
  'summary': 'CCD 风格界面 · 外观 · 字体',
  'section.general': '通用',
  'section.features': '模块',
  'section.appearance': '外观',
  'section.fonts': '字体',
  'section.view': '视图',
  'field.showEmptyGroups': '显示空分组',
  'hint.showEmptyGroups': '关掉时没有会话的工作区不再显示；视图选项菜单里的同一项',
  'field.enabled': '启用 CCD 风格界面',
  'field.theme': '主题',
  'theme.system': '跟随系统',
  'theme.light': '浅色',
  'theme.dark': '深色',
  'field.canvas': '会话背景色',
  'field.sidebar': '侧栏背景色',
  'note.coloursApplyToLight': '自定义背景色只作用于浅色模式；深色模式使用内置深色调色板。',
  'note.unknownBuild': '当前 DSH 构建未登记：它的宿主类名与插件记录的两套构建都不一致，界面样式不会生效，请按 host-builds.ts 的说明重新登记。',
  'field.uiLatin': '界面字体',
  'field.uiCjk': '界面中文字体',
  'field.code': '代码与等宽字体',
  'hint.fontListUnavailable': '当前环境不提供系统字体清单，请直接输入字体族名（例如 PingFang SC）。',
  'placeholder.font': '留空使用系统字体',
  'placeholder.colour': '#fcfcfb',
  'action.reset': '恢复默认',
  'picker.search': '搜索字体',
  'picker.empty': '没有匹配的字体',
  'picker.count': '共 {count} 个字体',
  'picker.useTyped': '使用“{name}”',
  'state.loading': '正在读取配置…',
  'state.unavailable': '当前页面没有可写的配置（表单只在 DSH 桌面应用内可用）。',
  'state.saving': '正在保存…',
  'state.saved': '已保存',
  'state.failed': '写入被拒绝：配置可能已被外部修改或不符合约束。',
  'state.readonly': '当前配置不可写。',
  'error.colour': '颜色需为 #rrggbb 或 #rgb',
  'error.font': '字体名只能包含字母、数字、空格与 . _ -，且不超过 64 个字符',
  'feature.shell': '窗口与分栏骨架',
  'feature.sidebar': '侧栏',
  'feature.new-session': '新建页',
  'feature.conversation': '聊天页',
  'feature.tool-calls': '工具调用展示',
  'feature.statistics': '统计卡片',
  'feature.composer-pet': '输入框小鲸鱼',
  'feature.composer-stats': '状态栏统计读数',
  'hint.composer-stats': '输出速度与缓存命中率，关掉时这两项不显示（默认）',
} as const;

export type SettingsKey = keyof typeof zh;

/** English dictionary; every Chinese key has a counterpart. */
export const en: Record<SettingsKey, string> = {
  'summary': 'CCD interface · appearance · typefaces',
  'section.general': 'General',
  'section.features': 'Modules',
  'section.appearance': 'Appearance',
  'section.fonts': 'Typefaces',
  'section.view': 'View',
  'field.showEmptyGroups': 'Show empty groups',
  'hint.showEmptyGroups': 'Off keeps a Workspace with no sessions out of the sidebar; the same switch the view-options menu carries',
  'field.enabled': 'Enable the CCD interface',
  'field.theme': 'Theme',
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'field.canvas': 'Conversation background',
  'field.sidebar': 'Sidebar background',
  'note.coloursApplyToLight': 'Custom background colours apply to the light scheme only; dark keeps the built-in dark palette.',
  'note.unknownBuild': 'This DSH build is not registered: its host class names match neither build this plugin records, so the interface styles stay off. Re-register it as host-builds.ts describes.',
  'field.uiLatin': 'Interface typeface',
  'field.uiCjk': 'CJK interface typeface',
  'field.code': 'Code and monospace typeface',
  'hint.fontListUnavailable': 'This environment does not expose the installed fonts; type a family name instead (for example PingFang SC).',
  'placeholder.font': 'Leave empty for the system stack',
  'placeholder.colour': '#fcfcfb',
  'action.reset': 'Use default',
  'picker.search': 'Search fonts',
  'picker.empty': 'No matching font',
  'picker.count': '{count} fonts',
  'picker.useTyped': 'Use “{name}”',
  'state.loading': 'Reading configuration…',
  'state.unavailable': 'No writable configuration here (the form only works inside the DSH desktop app).',
  'state.saving': 'Saving…',
  'state.saved': 'Saved',
  'state.failed': 'The write was rejected: the configuration changed elsewhere or breaks a constraint.',
  'state.readonly': 'This configuration is not writable.',
  'error.colour': 'Use #rrggbb or #rgb',
  'error.font': 'A family name may hold letters, digits, spaces and . _ - only, up to 64 characters',
  'feature.shell': 'Window and column frame',
  'feature.sidebar': 'Sidebar',
  'feature.new-session': 'New session',
  'feature.conversation': 'Conversation',
  'feature.tool-calls': 'Tool call presentation',
  'feature.statistics': 'Statistics card',
  'feature.composer-pet': 'Composer whale',
  'feature.composer-stats': 'Composer statistics readouts',
  'hint.composer-stats': 'Output speed and cache-hit rate; the two stay out of the row while this is off (the default)',
};

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The row configuration page's copy. */
    ccdSettings: SettingsKey;
  }
}
