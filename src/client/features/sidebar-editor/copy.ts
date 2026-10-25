export interface EditorCopy {
  readonly edit: string;
  readonly title: string;
  readonly description: string;
  readonly done: string;
  readonly close: string;
}

/** The reference's words in Chinese; its English counterparts elsewhere. */
export function editorCopy(language: string): EditorCopy {
  return language.toLowerCase().startsWith('zh')
    ? { edit: '编辑侧边栏…', title: '编辑侧边栏', description: '选择要在侧边栏中显示的项。', done: '完成', close: '关闭' }
    : { edit: 'Edit sidebar…', title: 'Edit sidebar', description: 'Choose the items to show in the sidebar.', done: 'Done', close: 'Close' };
}
