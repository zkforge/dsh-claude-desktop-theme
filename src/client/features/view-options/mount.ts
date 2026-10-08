import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import { ENTRY_ID } from '../../../shared/identity.ts';
import type { FeatureEnvironment } from '../../contracts/feature.ts';
import type { CleanupScope } from '../../core/cleanup.ts';
import type { ViewOptionsSettingsPort } from '../../contracts/ports.ts';
import { DSH_SLOTS } from '../../compat/slots.ts';
import { createViewOptionsDriver } from '../../compat/view-options.ts';
import { ViewOptionsCard } from './ViewOptionsCard.tsx';
import css from './view-options.css';

/** List order inside the frame-wide overlay; the pet occupies the earlier seat. */
const VIEW_OPTIONS_ORDER = 30;

/**
 * Put the sidebar's view-options card in the frame-wide overlay.
 *
 * The card is this plugin's own surface, so it is registered like one: a React
 * entry in `shell.overlay`, holding the driver that watches the host's trigger
 * and drives the host's own menu (`compat/view-options.ts`). The one value the
 * card writes is `view.showEmptyGroups`, and it goes through the settings
 * transport the same way the configuration page writes its fields — a write
 * re-mounts the plugin, which is why the card closes behind the switch.
 *
 * Nothing here fails the interface if the trigger is missing: the driver reports
 * a card it cannot read and hands the click back to DSH, whose own menu opens.
 *
 * @param ctx - client root context carrying the slot service.
 * @param environment - configuration, ports and logging for this activation.
 * @param cleanup - scope owning the styles, the driver and the registration.
 */
export function mountViewOptions(
  ctx: Context,
  environment: FeatureEnvironment,
  cleanup: CleanupScope,
): { settings: ViewOptionsSettingsPort; showAllSessions(): void } {
  cleanup.add(environment.dom.mountStyles(css));
  const driver = createViewOptionsDriver(
    document,
    error => environment.logger.error('view options: the sidebar trigger could not be watched', error),
  );
  cleanup.add(driver.dispose);
  const form = environment.host.configForms.get(ENTRY_ID);
  const registration = ctx.inject(['slots'], scope => scope.slots.inject(
    DSH_SLOTS.shellOverlay,
    () => scope.slots.register({
      name: DSH_SLOTS.shellOverlay, id: 'ccd-view-options', order: VIEW_OPTIONS_ORDER,
      inject: () => ({
        port: driver.port,
        showEmptyGroups: environment.config.view.showEmptyGroups,
        setShowEmptyGroups: (value: boolean) => {
          void form.mutate(
            [{ op: 'set', path: ['view', 'showEmptyGroups'], value }],
            form.getSnapshot().revision,
          ).then(
            accepted => {
              if (!accepted) environment.logger.error('view options: the show-empty-groups write was refused');
            },
            error => environment.logger.error('view options: the show-empty-groups write failed', error),
          );
        },
      }),
    }, ViewOptionsCard),
  ));
  cleanup.add(() => { void registration.dispose(); });
  void driver.inspect().catch(error => environment.logger.error('view options: preferences could not be read', error));
  return {
    settings: driver.settings,
    showAllSessions() {
      void (async () => {
        await driver.port.choose(2, 1);
      })().catch(error => environment.logger.error('sidebar: show-all-sessions failed', error));
    },
  };
}
