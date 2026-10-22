import type { Context } from '@deepseek-ai/cordis';
import type { ConversationController, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { Disposer } from '../contracts/ports.ts';
import { frameScheduler } from './frame.ts';

export const NEW_SCHEDULE_DRAFT = '帮我设置一个定时任务。问我它应该做什么、多久运行一次以及在什么时间运行,然后创建它。';

/** Write through the host input machine, without sending or replacing a draft. */
export function prefillScheduleDraft(input: Pick<SessionInput, 'state' | 'setDraft' | 'focus'>): boolean {
  const state = input.state.getSnapshot();
  if (state.draft !== '' || state.attachmentIds.length > 0 || state.phase !== 'plain') return false;
  input.setDraft(NEW_SCHEDULE_DRAFT);
  input.focus();
  return true;
}

/** Arm before the native new-task handler navigates. Wait for its blank session
 * and editor to mount, then seed that session's public input facade once. */
export function mountScheduleDraft(ctx: Context, document: Document, report: (error: unknown) => void): {
  prepare(): void;
  dispose: Disposer;
} {
  let pending = false;
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let conversation: ConversationController | undefined;
  const clear = () => {
    pending = false;
    clearTimeout(timer); timer = undefined;
  };
  const frames = frameScheduler(() => {
    if (!active || !pending || !conversation) return;
    const root = document.querySelector('[data-conversation-content][data-conversation-session][data-content-phase="hero"]');
    const id = root?.getAttribute('data-conversation-session') as SessionId | null;
    if (!id || !root?.querySelector('[contenteditable="true"]')) return;
    const binding = ctx.sessions.binding(id);
    if (!binding || !ctx.sessions.list.getSnapshot().byId[id]?.blank) return;
    try {
      const input = conversation.input.for(binding.ctx);
      clear();
      prefillScheduleDraft(input);
    } catch (error) { clear(); report(error); }
  }, document.defaultView);
  const registration = ctx.inject(['conversation'], scope => {
    conversation = scope.conversation as ConversationController;
    frames.schedule();
    scope.effect(() => () => { conversation = undefined; clear(); });
  });
  const observer = new MutationObserver(() => { if (pending) frames.schedule(); });
  observer.observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-content-phase', 'data-conversation-session', 'contenteditable'],
  });
  const stop = ctx.sessions.list.subscribe(() => { if (pending) frames.schedule(); });
  return {
    prepare() {
      if (!active) return;
      clear(); pending = true;
      timer = setTimeout(clear, 30_000);
      frames.schedule();
    },
    dispose() {
      active = false; clear(); frames.cancel(); observer.disconnect(); stop();
      void registration.dispose();
    },
  };
}
