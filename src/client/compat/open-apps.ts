/** Mirrors the host's open-in-app catalog in its menu order, one record per group. */
const OPEN_APP_GROUPS: readonly Readonly<Record<string, string>>[] = [
  { finder: 'Finder', explorer: 'File Explorer', filemanager: 'Files' },
  {
    cursor: 'Cursor', vscode: 'VS Code', vscodeinsiders: 'VS Code Insiders', windsurf: 'Windsurf', zed: 'Zed',
    sublimetext: 'Sublime Text', xcode: 'Xcode', androidstudio: 'Android Studio', intellij: 'IntelliJ IDEA',
    pycharm: 'PyCharm', webstorm: 'WebStorm', phpstorm: 'PhpStorm', goland: 'GoLand', rider: 'Rider', rustrover: 'RustRover',
  },
  {
    fork: 'Fork', sourcetree: 'Sourcetree', github: 'GitHub Desktop', tower: 'Tower',
    gitkraken: 'GitKraken', smartgit: 'SmartGit', sublimemerge: 'Sublime Merge',
  },
  {
    ghostty: 'Ghostty', warp: 'Warp', iterm: 'iTerm2', kitty: 'kitty', terminal: 'Terminal',
    windowsterminal: 'Windows Terminal', gitbash: 'Git Bash', gnometerminal: 'GNOME Terminal', konsole: 'Konsole',
  },
];

/** System applications carry localized names; products keep their own. */
const CHINESE_NAMES: Readonly<Record<string, string>> = {
  finder: '访达', explorer: '文件资源管理器', filemanager: '文件管理器', terminal: '终端',
};

export interface OpenApp { readonly id: string; readonly name: string }

/**
 * @param ids - installed application ids reported by the host.
 * @returns non-empty menu groups; ids this table cannot name stay hidden, as they do in the host's menu.
 */
export function openAppGroups(ids: readonly string[], document: Document): OpenApp[][] {
  const chinese = (document.documentElement.lang || globalThis.navigator?.language || '').toLowerCase().startsWith('zh');
  return OPEN_APP_GROUPS.flatMap(group => {
    const apps = Object.entries(group).filter(([id]) => ids.includes(id))
      .map(([id, name]) => ({ id, name: (chinese ? CHINESE_NAMES[id] : undefined) ?? name }));
    return apps.length === 0 ? [] : [apps];
  });
}
