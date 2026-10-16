import type { ImplementedFeature } from '../../contracts/feature.ts';
import { probeHost } from '../../compat/host-dom.ts';
import { mountHeroCanvas } from '../../compat/hero-canvas.ts';
import { drawHeroRipples } from './ripples.ts';
import newSessionCss from './new-session.css';

/**
 * Blank-session page. DSH renders the Conversation shell in its `hero` phase
 * here. This module lays out the greeting and Composer and mounts a decorative
 * ASCII ripple field; the phase transition itself belongs to the host.
 */
export const newSessionFeature: ImplementedFeature = {
  id: 'new-session',
  status: 'implemented',
  task: 'ARCHITECTURE.md#界面模块',
  mount(environment, scope) {
    const probe = probeHost(document);
    if (!probe.conversation) environment.logger.debug('new-session: conversation not mounted yet');
    scope.add(environment.dom.mountStyles(newSessionCss));
    scope.add(mountHeroCanvas(document, drawHeroRipples,
      error => environment.logger.error('new-session: ripple background failed', error)));
  },
};
