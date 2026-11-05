import type { ImplementedFeature } from '../../contracts/feature.ts';
import { probeHost } from '../../compat/host-dom.ts';
import { mountHeroGreeting } from '../../compat/hero-greeting.ts';
import { mountHeroCanvas } from '../../compat/hero-canvas.ts';
import { createHeroSpace } from './space.ts';
import { drawHeroRipples } from './ripples.ts';
import newSessionCss from './new-session.css';

/**
 * Blank-session page. DSH renders the Conversation shell in its `hero` phase
 * here. This module lays out the greeting and Composer and mounts the selected
 * background animation; the phase transition itself belongs to the host.
 */
export const newSessionFeature: ImplementedFeature = {
  id: 'new-session',
  status: 'implemented',
  task: 'ARCHITECTURE.md#界面模块',
  mount(environment, scope) {
    const probe = probeHost(document);
    if (!probe.conversation) environment.logger.debug('new-session: conversation not mounted yet');
    scope.add(environment.dom.mountStyles(newSessionCss));
    scope.add(mountHeroGreeting(document, environment.config.personalization));
    if (environment.config.features['hero-ripples']) {
      const renderer = environment.config.personalization.heroBackground === 'space' ? createHeroSpace() : drawHeroRipples;
      scope.add(mountHeroCanvas(document, renderer,
        error => environment.logger.error('new-session: background failed', error)));
    }
  },
};
