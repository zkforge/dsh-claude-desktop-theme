import type { ImplementedFeature } from '../../contracts/feature.ts';
import { mountConversationFade } from '../../compat/conversation-fade.ts';
import { mountConversationProcess } from '../../compat/conversation-process.ts';
import { mountRunningStatus } from '../../compat/running-status.ts';
import { mountReplySignature } from '../../compat/reply-signature.ts';
import { probeHost } from '../../compat/host-dom.ts';
import { mountViewSwitch } from '../../compat/view-switch.ts';
import conversationCss from './conversation.css';
import { VIEW_SWITCH_ICONS } from './view-switch-icons.ts';
import { mountHeaderVisibility } from './header-actions/visibility.ts';

/**
 * Conversation page presentation. The transcript, its scroll behaviour, tool
 * rows, approvals and the resident Composer are all DSH's; this module only
 * adapts the header chrome, the transcript column and the message surfaces.
 *
 * The header keeps DSH's own View switcher: the host still owns which View is
 * selected and how it is rendered. This module swaps the two shipped Views'
 * text labels for bundled artwork, publishes the selected segment's geometry so
 * the stylesheet can slide the thumb onto it, and parks the tablist in the
 * sidebar's window-control row while that column has a corner to hold it
 * (`compat/view-switch.ts`).
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
    scope.add(mountViewSwitch(
      document, VIEW_SWITCH_ICONS,
      error => environment.logger.error('conversation: view switcher observer failed', error),
    ));
    scope.add(mountConversationFade(
      document,
      error => environment.logger.error('conversation: transcript edge fade observer failed', error),
    ));
  },
};
