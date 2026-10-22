import { symbols, type Context } from '@deepseek-ai/cordis';
import type { ConversationController, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { Disposer } from '../contracts/ports.ts';
import { createSessionWorktree, WorktreeChoices } from './workspace-worktree.ts';
import { hostSelectors } from './host-dom.ts';

/** The concrete input shell owns the notice store; its public notify() never expires. */
interface NoticeInput extends SessionInput {
  readonly notices?: { getSnapshot(): unknown; set(value: null): void };
}

/** Only clear the exact notice we published, preserving any newer host/command notice. */
export function showWorktreeProgress(input: SessionInput, text: string): Disposer {
  const shell = (Reflect.get(input, symbols.original) as NoticeInput | undefined) ?? input as NoticeInput;
  const notices = shell.notices;
  // Without a clearable store, omit the transient banner instead of leaving a permanent one.
  if (typeof notices?.getSnapshot !== 'function' || typeof notices.set !== 'function') return () => {};
  shell.notify('info', text);
  const owned = notices.getSnapshot();
  return () => { if (notices.getSnapshot() === owned) notices.set(null); };
}

/**
 * The SDK has no before-send extension. Decorate only the resident composer's
 * send boundary, leaving command arbitration, references, attachments and native
 * draft recovery with the host. The exact original method is restored on release.
 */
export function mountWorktreeSupport(ctx: Context, document: Document,
  report: (error: unknown) => void): { readonly choices: WorktreeChoices; readonly dispose: Disposer } {
  let installed = false;
  const choices = new WorktreeChoices(() => {
    if (!installed) return undefined;
    const chip = document.querySelector(hostSelectors(document).heroWorkspaceChip);
    const id = chip?.closest('[data-conversation-session]')?.getAttribute('data-conversation-session');
    return id && ctx.sessions.list.getSnapshot().byId[id as SessionId]?.blank ? id : undefined;
  });
  let active = true;
  const progress = new Set<Disposer>();
  const registration = ctx.inject(['conversation'], scope => {
    const face = scope.conversation as ConversationController;
    // Cordis returns a fresh tracing proxy for every method read. Decorate the
    // underlying service so identity checks and cleanup restore the real method.
    const conversation = (Reflect.get(face, symbols.original) as ConversationController | undefined) ?? face;
    if (typeof conversation.sendSession !== 'function') return;
    const original = conversation.sendSession;
    const send: ConversationController['sendSession'] = async function(this: ConversationController, session, text, attachments, mode, signal) {
      if (choices.selected(session.sessionId) && session.getSnapshot().blank) {
        let clearProgress: Disposer = () => {};
        try {
          signal?.throwIfAborted();
          const binding = ctx.sessions.binding(session.sessionId);
          if (binding) {
            clearProgress = showWorktreeProgress(conversation.input.for(binding.ctx), document.documentElement.lang.toLowerCase().startsWith('zh')
              ? '正在创建工作树…' : 'Creating worktree…');
            progress.add(clearProgress);
            signal?.addEventListener('abort', clearProgress, { once: true });
          }
          await choices.prepare(session.sessionId, (workspace, from) => createSessionWorktree(session.sessionId, workspace, from));
          signal?.throwIfAborted();
          if (!active) throw new Error('Worktree preparation was interrupted; retry sending');
        } catch (error) {
          report(error);
          // Returning the host's ordinary error outcome restores the exact editor
          // projection and attachments, including reference chips, through its sink.
          const zh = document.documentElement.lang.toLowerCase().startsWith('zh');
          return { kind: 'error', text: `${zh ? '创建工作树失败' : 'Could not create worktree'}: ${error instanceof Error ? error.message : String(error)}` };
        } finally {
          clearProgress();
          signal?.removeEventListener('abort', clearProgress);
          progress.delete(clearProgress);
        }
      }
      return original.call(this, session, text, attachments, mode, signal);
    };
    conversation.sendSession = send;
    installed = true;
    scope.effect(() => () => {
      installed = false;
      if (conversation.sendSession === send) conversation.sendSession = original;
    });
  });
  return { choices, dispose() {
    active = false;
    for (const clear of progress) clear();
    progress.clear();
    void registration.dispose();
  } };
}
