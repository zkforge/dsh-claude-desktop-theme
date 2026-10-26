import type { Context } from '@deepseek-ai/cordis';
import type { FeatureEnvironment } from '../../contracts/feature.ts';
import type { CleanupScope } from '../../core/cleanup.ts';
import { createSessionInfoPort } from '../../compat/session-info.ts';
import { DSH_SLOTS } from '../../compat/slots.ts';
import { SessionCards } from './SessionCards.tsx';
import { SessionInfoButton } from './SessionInfoButton.tsx';
import css from './session-info.css';

export function mountSessionCards(ctx: Context, environment: FeatureEnvironment, scope: CleanupScope): void {
  if (!environment.config.features['right-panel'] || !environment.config.features.conversation) return;
  scope.add(environment.dom.mountStyles(css));
  const port = createSessionInfoPort(ctx, document, environment.host.contextProjections);
  scope.add(port.dispose);
  const registration = ctx.inject(['slots'], child => child.slots.inject(DSH_SLOTS.shellOverlay, () => child.slots.register({
    name: DSH_SLOTS.shellOverlay, id: 'ccd-session-cards', order: 35,
    inject: () => ({ port, contextEnabled: environment.config.features['context-panel'] }),
  }, SessionCards)));
  scope.add(() => { void registration.dispose(); });
  const button = ctx.inject(['slots'], child => child.slots.inject(DSH_SLOTS.sessionHeaderUtilities, () => child.slots.register({
    name: DSH_SLOTS.sessionHeaderUtilities, id: 'ccd-session-info-toggle', order: -4,
    inject: () => ({ port }),
  }, SessionInfoButton)));
  scope.add(() => { void button.dispose(); });
}
