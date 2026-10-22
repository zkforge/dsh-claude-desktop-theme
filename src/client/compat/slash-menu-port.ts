import type { Context } from '@deepseek-ai/cordis';
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';

/** Insert through the pinned host shell's revision-guarded input actions. A
 * real slash lets every registered source participate, including skills. */
export function slashMenuOpener(ctx: Context): (id: string) => void {
  return id => {
    const scoped = ctx.sessions.scope(id as Parameters<typeof ctx.sessions.scope>[0]);
    if (!scoped) return;
    const input = ctx.conversation.input.for(scoped);
    const actions = (input as typeof input & { readonly actions: InputActions }).actions;
    input.focus();
    const span = actions.captureInsertion();
    const previous = input.state.getSnapshot().draft[span.start - 1];
    if (!actions.insertText(previous && !/\s/u.test(previous) ? ' /' : '/', span)) {
      input.notify('error', '当前无法打开斜杠命令菜单，请在输入框中输入 /。');
    }
  };
}
