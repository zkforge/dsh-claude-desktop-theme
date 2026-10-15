import type { Disposer } from '../contracts/ports.ts';

/** Identify the two shared Claude actions; unknown/localized actions keep host art. */
export function mountSidebarSessionIcons(document: Document): Disposer {
  const attribute = 'data-ccd-sidebar-session-icon';
  const shortcutAttribute = 'data-ccd-sidebar-session-shortcut';
  const workspaceAttribute = 'data-ccd-sidebar-workspace-menu';
  const sync = (): void => {
    // The workspace popup is portalled and has no slot outlet. Its two native
    // rows identify it without depending on the last menu opened elsewhere.
    for (const menu of document.querySelectorAll<HTMLElement>('[data-menu-material][role="menu"]')) {
      const labels = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .map(row => row.querySelector('._itemLabel_4ub78_190')?.textContent?.trim() ?? '');
      const workspace = labels.length === 2
        && /^(重命名|Rename)$/u.test(labels[0] ?? '')
        && /^(删除工作区|Delete workspace)$/u.test(labels[1] ?? '');
      if (workspace) {
        if (!menu.hasAttribute(workspaceAttribute)) menu.setAttribute(workspaceAttribute, '');
      } else menu.removeAttribute(workspaceAttribute);
    }
    for (const row of document.querySelectorAll<HTMLElement>(
      '[data-slot="sidebar.workspaces.session.menu.item"] [role="menuitem"]',
    )) {
      const label = [...row.querySelectorAll('span')]
        .filter(span => span.children.length === 0)
        .map(span => span.textContent?.trim() ?? '');
      const icon = label.some(text => /^(置顶会话|Pin session)$/u.test(text)) ? 'pin'
        : label.some(text => /^(重命名|重命名会话|Rename|Rename session)$/u.test(text)) ? 'rename' : null;
      const shortcut = label.some(text => /^(置顶会话|取消置顶|Pin session|Unpin session)$/u.test(text)) ? 'P'
        : label.some(text => /^(重命名|重命名会话|Rename|Rename session)$/u.test(text)) ? 'R'
        : label.some(text => /^(分叉会话|分支会话|创建分支|Fork session)$/u.test(text)) ? 'F'
        : label.some(text => /^(归档会话|取消归档|Archive session|Unarchive session)$/u.test(text)) ? 'A' : null;
      if (shortcut === null) row.removeAttribute(shortcutAttribute);
      else if (row.getAttribute(shortcutAttribute) !== shortcut) row.setAttribute(shortcutAttribute, shortcut);
      if (icon === null) row.removeAttribute(attribute);
      else if (row.getAttribute(attribute) !== icon) row.setAttribute(attribute, icon);
    }
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  sync();
  return () => {
    observer.disconnect();
    for (const row of document.querySelectorAll(`[${shortcutAttribute}]`)) row.removeAttribute(shortcutAttribute);
    for (const row of document.querySelectorAll(`[${attribute}]`)) row.removeAttribute(attribute);
    for (const menu of document.querySelectorAll(`[${workspaceAttribute}]`)) menu.removeAttribute(workspaceAttribute);
  };
}
