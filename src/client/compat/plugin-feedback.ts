import { hostBuildStatus } from './host-builds.ts';

/** New-issue form of the plugin repository; title and body arrive as query parameters. */
export const FEEDBACK_ISSUE_URL = 'https://github.com/zkforge/dsh-claude-desktop-theme/issues/new';

declare const __CCD_PLUGIN_VERSION__: string | undefined;

/** Description characters kept in the URL; GitHub rejects much longer request lines. */
const DESCRIPTION_LIMIT = 4000;
const TITLE_LIMIT = 72;

/** One diagnostic row appended under the description. */
export type FeedbackEnvironment = readonly (readonly [label: string, value: string])[];

/**
 * The new-issue URL for one description.
 *
 * GitHub's `issues/new` reads `title` and `body` from the query string, so the
 * report opens already filled in and the reporter still reviews and submits it
 * on GitHub themself. Nothing is sent from the plugin.
 *
 * @param description - what the reporter typed; trimmed and capped.
 * @param environment - diagnostic rows rendered as a table below it.
 * @returns the prefilled issue URL.
 */
export function feedbackIssueUrl(description: string, environment: FeedbackEnvironment): string {
  const text = description.trim().slice(0, DESCRIPTION_LIMIT);
  const line = text.split('\n', 1)[0]?.trim() ?? '';
  const title = `[UI] ${line.length > TITLE_LIMIT ? `${line.slice(0, TITLE_LIMIT - 1)}…` : line}`;
  const rows = environment.map(([label, value]) => `| ${label} | ${value.replace(/[|\n]/gu, ' ')} |`);
  const body = [text, '', '<!-- 截图可直接粘贴到这里 / Paste screenshots here -->', '', '| | |', '| --- | --- |', ...rows].join('\n');
  const url = new URL(FEEDBACK_ISSUE_URL);
  url.searchParams.set('title', title);
  url.searchParams.set('body', body);
  return url.toString();
}

/** What a UI report needs to be reproducible, and nothing from the session. */
function environment(document: Document): FeedbackEnvironment {
  const view = document.defaultView;
  const status = hostBuildStatus(document);
  const dark = view?.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return [
    ['Plugin', typeof __CCD_PLUGIN_VERSION__ === 'string' ? __CCD_PLUGIN_VERSION__ : 'dev'],
    ['DSH build', `${status.build.id} (${status.state})`],
    ['Platform', document.documentElement.dataset.platform ?? view?.navigator.platform ?? ''],
    ['Language', document.documentElement.lang || view?.navigator.language || ''],
    ['Appearance', document.documentElement.dataset.theme ?? (dark ? 'dark' : 'light')],
    ['Window', view ? `${view.innerWidth}×${view.innerHeight} @${view.devicePixelRatio}x` : ''],
    ['User agent', view?.navigator.userAgent ?? ''],
  ];
}

/**
 * Open the plugin's feedback dialog.
 *
 * The card follows the host's own "send feedback" sheet: a title, a description
 * box, one line saying what the report will carry, and Cancel / Send. Send
 * hands the description to GitHub's new-issue form in the browser; with no
 * description it opens the blank form.
 *
 * @param document - renderer document the modal is shown in.
 * @returns disposer that closes and removes the dialog.
 */
export function openPluginFeedback(document: Document): () => void {
  const zh = (document.documentElement.lang || document.defaultView?.navigator.language || '').toLowerCase().startsWith('zh');
  const dialog = document.createElement('dialog');
  dialog.setAttribute('data-ccd-plugin-feedback-dialog', '');
  dialog.setAttribute('aria-labelledby', 'ccd-plugin-feedback-title');
  const heading = document.createElement('h2');
  heading.id = 'ccd-plugin-feedback-title';
  heading.textContent = zh ? '发送反馈' : 'Send feedback';
  const input = document.createElement('textarea');
  input.placeholder = zh ? '描述问题' : 'Describe the issue';
  input.setAttribute('aria-label', input.placeholder);
  const note = document.createElement('p');
  note.textContent = zh
    ? '将在浏览器中打开 GitHub 新建 Issue 页面，预填你的描述、插件版本与界面环境，不包含会话内容。提交前可以继续编辑或粘贴截图。'
    : 'Opens a new GitHub issue in your browser, prefilled with your description, the plugin version and UI environment. No conversation content is included. You can edit it or paste screenshots before submitting.';
  const actions = document.createElement('div');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = zh ? '取消' : 'Cancel';
  const send = document.createElement('button');
  send.type = 'button';
  send.setAttribute('data-ccd-primary', '');
  send.textContent = zh ? '发送' : 'Send';
  actions.append(cancel, send);
  dialog.append(heading, input, note, actions);

  const submit = () => {
    // An empty description goes straight to the blank new-issue page.
    const url = input.value.trim() === '' ? FEEDBACK_ISSUE_URL : feedbackIssueUrl(input.value, environment(document));
    document.defaultView?.open(url, '_blank', 'noopener,noreferrer');
    dialog.close();
  };
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); }
  });
  cancel.addEventListener('click', () => dialog.close());
  send.addEventListener('click', submit);
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove());

  document.body.append(dialog);
  dialog.showModal();
  input.focus();
  return () => { if (dialog.open) dialog.close(); dialog.remove(); };
}
