import type { ImplementedFeature } from '../../contracts/feature.ts';
import { mountChangedFiles } from '../../compat/changed-files.ts';
import { mountConversationFade } from '../../compat/conversation-fade.ts';
import { mountConversationProcess } from '../../compat/conversation-process.ts';
import { mountConversationStream } from '../../compat/conversation-stream.ts';
import { mountRunningStatus } from '../../compat/running-status.ts';
import { mountReplySignature } from '../../compat/reply-signature.ts';
import { probeHost } from '../../compat/host-dom.ts';
import conversationCss from './conversation.css';
import { mountHeaderVisibility } from './header-actions/visibility.ts';

/**
 * Conversation page presentation. The transcript, its scroll behaviour, tool
 * rows, approvals and the resident Composer are all DSH's; this module only
 * adapts the header chrome, the transcript column and the message surfaces.
 *
 * DSH owns the View tabs and selection. The plugin keeps Chat and Trajectory
 * together before the header utilities and hides the overflow launcher.
 *
 * The transcript's own edge fade is published the same way: the host owns the
 * scroll position, `compat/conversation-fade.ts` turns it into two attributes,
 * and the stylesheet prints the stencil.
 */
export const conversationFeature: ImplementedFeature = {
  id: 'conversation',
  status: 'implemented',
  task: 'ARCHITECTURE.md#界面模块',
  mount(environment, scope) {
    const probe = probeHost(document);
    if (!probe.conversation) environment.logger.debug('conversation: body not mounted yet');
    scope.add(environment.dom.mountStyles(conversationCss));
    scope.add(mountConversationStream(document,
      error => environment.logger.error('conversation: streaming text failed', error)));
    scope.add(mountChangedFiles(document, error => environment.logger.error('conversation: changed files failed', error)));
    scope.add(mountRunningStatus(document, environment.config.personalization.runningStyle,
      error => environment.logger.error('conversation: running status failed', error)));
    scope.add(mountReplySignature(
      document,
      error => environment.logger.error('conversation: reply signature failed', error),
      environment.config.personalization.replySignatureStyle,
    ));
    scope.add(mountConversationProcess(
      document,
      error => environment.logger.error('conversation: process expansion failed', error),
    ));
    mountHeaderVisibility(environment.host.slots, environment.config.view, scope);
    scope.add(mountConversationFade(
      document,
      error => environment.logger.error('conversation: transcript edge fade observer failed', error),
    ));
  },
};
