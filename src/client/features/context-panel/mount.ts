import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { FeatureEnvironment } from '../../contracts/feature.ts';
import type { CleanupScope } from '../../core/cleanup.ts';
import { DSH_SLOTS } from '../../compat/slots.ts';
import { createContextPanelDriver } from '../../compat/context-panel.ts';
import { ContextPanel } from './ContextPanel.tsx';
import css from './context-panel.css';

/** List order inside the frame-wide overlay; the view-options card is at 30. */
const CONTEXT_PANEL_ORDER = 40;

/**
 * Put the context ring's breakdown panel in the frame-wide overlay.
 *
 * The panel is this plugin's own surface, so it is registered like one: a React
 * entry in `shell.overlay`, holding the driver that watches the ring's trigger
 * and takes its click (`compat/context-panel.ts`). Nothing here writes session
 * state — the numbers are the host's own projections, read off the session list
 * — so a write can never re-mount the plugin behind the panel.
 *
 * A build that does not publish the session list yields no port, and the ring
 * keeps DSH's own panel: the feature loses a richer reading, not the control.
 *
 * @param ctx - client root context carrying the slot service.
 * @param environment - configuration, ports and logging for this activation.
 * @param cleanup - scope owning the styles, the driver and the registration.
 */
export function mountContextPanel(
  ctx: Context,
  environment: FeatureEnvironment,
  cleanup: CleanupScope,
): void {
  const projections = environment.host.contextProjections;
  if (projections === null) {
    environment.logger.debug('context panel: this build publishes no session list; the ring keeps its own panel');
    return;
  }
  cleanup.add(environment.dom.mountStyles(css));
  const driver = createContextPanelDriver(
    document,
    projections,
    error => environment.logger.error('context panel: the ring trigger could not be watched', error),
  );
  cleanup.add(driver.dispose);
  const registration = ctx.inject(['slots'], scope => scope.slots.inject(
    DSH_SLOTS.shellOverlay,
    () => scope.slots.register({
      name: DSH_SLOTS.shellOverlay, id: 'ccd-context-panel', order: CONTEXT_PANEL_ORDER,
      inject: () => ({ port: driver.port }),
    }, ContextPanel),
  ));
  cleanup.add(() => { void registration.dispose(); });
}
