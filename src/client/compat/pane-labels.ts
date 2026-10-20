/**
 * The words the right panel's panes add (DESIGN.md §6.9).
 *
 * DSH localises its own strings through `ctx.locale`; a third-party plugin may
 * not borrow another package's namespace, so the copy this panel writes follows
 * the document language instead — the same rule the header's labels
 * (`header-labels.ts`) and the permission card follow. Host-owned words keep
 * the host's wording either way: a root path, the reload button, the
 * open-in-app action and a browser page's own text are never renamed here.
 */

/** The language a pane writes its own copy in. */
export type PaneLanguage = 'zh' | 'en';

/** The Files pane's own words: its card title, field, tree control and landing state. */
export interface FilesPaneLabels {
  /** The card's title; the host's own tree heading is never touched. */
  readonly title: string;
  /** The filter field's placeholder. */
  readonly filter: string;
  /** The filter field's accessible name. */
  readonly filterLabel: string;
  /** The filter's clear control. */
  readonly clear: string;
  /** The header control while the tree shows. */
  readonly hide: string;
  /** The same control once the tree is away, and the row that brings it back. */
  readonly show: string;
  /** The line under the list when a query matched nothing. */
  readonly noMatch: string;
  /** The landing state: a title, and the line of guidance under it. */
  readonly emptyTitle: string;
  readonly emptyBody: string;
}

/** The words on a pane's title bar, its ⋮ menu and the browser's toolbar. */
export interface PaneChromeLabels {
  readonly more: string;
  readonly expand: string;
  readonly restore: string;
  readonly search: string;
  readonly reload: string;
  readonly back: string;
  readonly forward: string;
  /** The element-picking control, and the notice it answers with. */
  readonly pick: string;
  readonly pickNotice: string;
  /** The globe that focuses the address field. */
  readonly address: string;
  /** The word before a terminal's workspace name, and the tab group's own name. */
  readonly terminal: string;
  readonly terminals: string;
  readonly newTerminal: string;
  /** Prefixes one terminal tab's close control. */
  readonly closeTab: string;
  /** The Files menu's remaining rows. */
  readonly refresh: string;
  readonly openFolder: string;
  readonly hideSidebar: string;
  readonly close: string;
}

/** The capture menu's one row, and the webview area's two states. */
export interface BrowserPaneLabels {
  readonly newTab: string;
  readonly tabs: string;
  readonly saveScreenshot: string;
  readonly awaitingServer: string;
  readonly enterAddress: string;
}

/** Every word the right panel adds, in one language. */
export interface PaneLabels {
  readonly files: FilesPaneLabels;
  readonly chrome: PaneChromeLabels;
  readonly browser: BrowserPaneLabels;
}

const ZH: PaneLabels = {
  files: {
    title: '文件',
    filter: '过滤文件，或按 ? 在文件内容中搜索',
    filterLabel: '过滤文件',
    clear: '清除过滤',
    hide: '收起文件树',
    show: '展开文件树',
    noMatch: '没有匹配的文件',
    emptyTitle: '打开的文件会显示在这里',
    emptyBody: '在文件树中选择一个文件，或点击对话中的文件路径。',
  },
  chrome: {
    more: '更多',
    expand: '放大面板',
    restore: '还原面板',
    search: '搜索文件',
    reload: '刷新',
    back: '后退',
    forward: '前进',
    pick: '选取元素 — DSH 暂不支持网页元素选取',
    pickNotice: 'DSH 暂不支持选取浏览器页面元素。',
    address: '编辑地址',
    terminal: '终端',
    terminals: '终端',
    newTerminal: '新建终端',
    closeTab: '关闭',
    refresh: '刷新文件',
    openFolder: '在应用中打开文件夹',
    hideSidebar: '收起侧边栏',
    close: '关闭',
  },
  browser: {
    newTab: '新建标签页',
    tabs: '浏览器标签页',
    saveScreenshot: '保存截图',
    awaitingServer: '等待服务器响应…',
    enterAddress: '输入 URL',
  },
};

const EN: PaneLabels = {
  files: {
    title: 'Files',
    filter: 'Filter, or ? to search in files',
    filterLabel: 'Filter files',
    clear: 'Clear filter',
    hide: 'Hide file tree',
    show: 'Show file tree',
    noMatch: 'No matching files',
    emptyTitle: 'Open files appear here',
    emptyBody: 'Pick a file in the tree, or click a file path in the conversation.',
  },
  chrome: {
    more: 'More',
    expand: 'Expand pane',
    restore: 'Restore pane',
    search: 'Search files',
    reload: 'Reload',
    back: 'Back',
    forward: 'Forward',
    pick: 'Select element — DSH does not support page picking',
    pickNotice: 'DSH does not support picking browser page elements yet.',
    address: 'Edit address',
    terminal: 'Terminal',
    terminals: 'Terminals',
    newTerminal: 'New terminal',
    closeTab: 'Close',
    refresh: 'Refresh files',
    openFolder: 'Open folder in app',
    hideSidebar: 'Hide sidebar',
    close: 'Close',
  },
  browser: {
    newTab: 'New tab',
    tabs: 'Browser tabs',
    saveScreenshot: 'Save screenshot',
    awaitingServer: 'Awaiting server…',
    enterAddress: 'Enter URL',
  },
};

/**
 * @param document - renderer document whose language DSH sets from the locale
 * (`dsh-client-locale` points `<html lang>` at `zh-CN` for Chinese).
 * @returns `zh` for a Chinese document, `en` for every other language.
 */
export function paneLanguage(document: Document): PaneLanguage {
  const language = (document.documentElement.lang || globalThis.navigator?.language || '').toLowerCase();
  return language.startsWith('zh') ? 'zh' : 'en';
}

/**
 * @param language - the pane's language, from {@link paneLanguage}.
 * @returns the right panel's copy in it.
 */
export function paneLabels(language: PaneLanguage): PaneLabels {
  return language === 'zh' ? ZH : EN;
}
