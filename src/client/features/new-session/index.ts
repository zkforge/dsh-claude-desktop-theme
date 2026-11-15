import type { FeatureEnvironment, ImplementedFeature } from '../../contracts/feature.ts';
import { probeHost } from '../../compat/host-dom.ts';
import { mountHeroGreeting } from '../../compat/hero-greeting.ts';
import { mountHeroCanvas } from '../../compat/hero-canvas.ts';
import { createHeroSpace } from './space.ts';
import { drawHeroRipples } from './ripples.ts';
import type { CleanupScope } from '../../core/cleanup.ts';
import backgroundCss from './background.css';
import newSessionCss from './new-session.css';

/**
 * Blank-session page. DSH renders the Conversation shell in its `hero` phase
 * here. This module lays out the greeting and Composer.
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
  },
};

export function mountConversationBackgrounds(environment: FeatureEnvironment, scope: CleanupScope): void {
  const { config, dom, logger } = environment;
  const home = config.features['new-session'] && config.features['hero-ripples']
    ? config.personalization.heroBackground : 'none';
  const chat = config.features.conversation ? config.personalization.chatBackground : 'none';
  const hideWhale = config.features['new-session'] && home !== 'whale';
  if (hideWhale) {
    scope.add(dom.mountStyles('html[data-dsh-ccd-style="true"] canvas[data-home-whale] { display: none; }'));
  }
  if ((home === 'none' || home === 'whale') && chat === 'none') return;
  scope.add(dom.mountStyles(backgroundCss));
  const report = (error: unknown) => logger.error('conversation: background failed', error);
  if (home === 'ripples' || home === 'space') {
    scope.add(mountHeroCanvas(document, home === 'space' ? createHeroSpace() : drawHeroRipples, report));
  }
  if (chat !== 'none') {
    scope.add(mountHeroCanvas(document, chat === 'space' ? createHeroSpace() : drawHeroRipples, report, 'active'));
  }
}
