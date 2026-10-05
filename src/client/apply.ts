import type { Context } from '@deepseek-ai/cordis';
import type { FeatureEnvironment } from './contracts/feature.ts';
import type { Logger } from './contracts/ports.ts';
import { adoptConfig } from '../shared/config.ts';
import { ENTRY_ID, PLUGIN_ID } from '../shared/identity.ts';
import { createHostServices } from './compat/adapter.ts';
import { mountComposerMenuPlacement } from './compat/composer-menus.ts';
import { watchHostBuild } from './compat/host-builds.ts';
import { mountComposerStats } from './compat/stats-values.ts';
import { mountComposerPlaceholder } from './compat/composer-placeholder.ts';
import { mountComposerStatusOrder } from './compat/composer-status-order.ts';
import { mountPermissionMenu } from './compat/permission-menu.ts';
import { mountWorkspaceMenu } from './compat/workspace-menu.ts';
import { mountOpenTargetMode } from './compat/open-target.ts';
import { createDomPort } from './compat/dom.ts';
import { CleanupScope } from './core/cleanup.ts';
import { mountFeatures } from './core/mount-features.ts';
import { mountTheme } from './theme/mount.ts';
import { mountModelControls } from './features/model-controls/mount.ts';
import { mountHeaderActions } from './features/conversation/header-actions/mount.ts';
import { mountComposerPet } from './features/composer-pet/mount.ts';
import { mountSettingsPage } from './features/settings/mount.ts';
import { shellFeature } from './features/shell/index.ts';
import { sidebarFeature } from './features/sidebar/index.ts';
import { newSessionFeature } from './features/new-session/index.ts';
import { conversationFeature } from './features/conversation/index.ts';
import { toolCallsFeature } from './features/tool-calls/index.ts';
import { statisticsFeature } from './features/statistics/index.ts';

/** Speaks for the settings page's "planned" markers and for feature mounting. */
const FEATURES = [
  shellFeature, sidebarFeature, newSessionFeature,
  conversationFeature, toolCallsFeature, statisticsFeature,
] as const;

/**
 * Cordis services, not manifest package-name edges, control activation.
 *
 * `sessions` is the Session Controller's catalog store: the sidebar column
 * reads its `blank` flag to keep a provisional New Session row out of the list.
 * It is a prerequisite of `uiWorkspace` already, and Cordis refuses to resolve
 * a service that is not declared here, so the dependency is named rather than
 * discovered at the point of use.
 */
export const inject = ['slots', 'theme', 'uiWorkspace', 'configForms', 'sessions'];

/**
 * The only assembly point allowed to import multiple feature domains.
 *
 * The loader creates client entries without configuration, so this plugin reads
 * its own Host-served section through the settings transport rather than a
 * second `apply` argument: `configForms.get(entryId)`. That keeps one source of
 * truth for the switch and lets enable/disable take effect without a reload.
 * The configuration page is registered on the outer scope so it survives the
 * switch being turned off — otherwise the interface could never be turned back
 * on from inside the app.
 *
 * @param ctx - client root context carrying the injected services.
 */
export function apply(ctx: Context): void {
  if (typeof document === 'undefined') return;
  ctx.effect(() => {
    const host = createHostServices(ctx);
    const form = host.configForms.get(ENTRY_ID);
    const dom = createDomPort(document);
    let environment: FeatureEnvironment = {
      config: adoptConfig(undefined),
      logger: { debug: () => {}, error: () => {} },
      host,
      dom,
    };
    const logger: Logger = {
      debug: message => { if (environment.config.debug) console.debug(`[${PLUGIN_ID}] ${message}`); },
      error: (message, error) => console.error(`[${PLUGIN_ID}] ${message}`, error),
    };
    const settingsScope = new CleanupScope(error => logger.error('settings page cleanup failed', error));
    mountSettingsPage(ctx, dom, form, host.themePreference, settingsScope);
    let active: CleanupScope | null = null;
    let released = false;
    let applied: string | null = null;

    const sync = () => {
      if (released) return;
      const next = adoptConfig(form.getSnapshot().value);
      const signature = JSON.stringify(next);
      if (signature === applied) return;
      applied = signature;
      environment = { ...environment, config: next, logger };
      active?.dispose();
      active = null;
      if (!next.enabled) {
        logger.debug('disabled; native interface retained');
        return;
      }
      const scope = new CleanupScope(error => logger.error('cleanup failed', error));
      try {
        mountTheme(environment, scope);
        /* Composer menus are placed from the assembly layer: the rule spans both
           pages that render the Composer, and the theme layer may not reach the
           compatibility layer. */
        scope.add(mountComposerMenuPlacement(
          document,
          error => logger.error('composer: menu placement observer failed', error),
        ));
        /* The row's readouts are the configuration's to keep or drop, and the
           module that mirrors them also publishes the row's width budget, so it
           mounts either way and reads the switch as an argument. */
        scope.add(mountComposerStats(
          document,
          error => logger.error('composer: statistics readout observer failed', error),
          next.features['composer-stats'],
        ));
        /* The voice seat sits in a different flex container from the permission
           seat, so its place in the status bar is arranged from the compatibility
           layer rather than by `order`. */
        scope.add(mountComposerStatusOrder(
          document,
          error => logger.error('composer: status-bar order observer failed', error),
        ));
        scope.add(mountComposerPlaceholder(
          document,
          error => logger.error('composer: placeholder observer failed', error),
        ));
        /* The permission picker's second line is the one piece of copy this
           plugin writes rather than rewrites, so it is mounted like the other
           Composer compat modules: beside them, on both pages that render the
           control. */
        scope.add(mountPermissionMenu(
          document,
          error => logger.error('composer: permission card observer failed', error),
        ));
        /* The workspace picker's labels come from the host's own locale namespace,
           so the typed ellipsis is rewritten in the rendered text nodes instead. */
        scope.add(mountWorkspaceMenu(
          document,
          error => logger.error('workspace menu: label rewrite failed', error),
        ));
        if (next.features.conversation) {
          /* The header cluster's open control is host-rendered, so its mode and
             its names are annotated from the compatibility layer; the two added
             views are ordinary slot entries. */
          scope.add(mountOpenTargetMode(
            document,
            error => logger.error('header: open-target mode observer failed', error),
          ));
          mountHeaderActions(ctx, environment, scope);
        }
        if (next.features.conversation || next.features['new-session']) {
          mountModelControls(ctx, environment, scope);
        }
        /* Compose the frame-wide pet seat alongside the page features. */
        if (next.features['composer-pet']) {
          mountComposerPet(ctx, environment, scope);
        }
        mountFeatures(FEATURES, environment, scope);
        /* Host class names are hashed per DSH build, so a build this plugin has
           never seen makes every host selector miss. That failure is silent by
           nature — the native interface simply stays — so it is reported as
           soon as the shell's frame identifies the build. */
        scope.add(watchHostBuild(document, status => {
          if (status.state !== 'unknown') return;
          logger.error(
            'unregistered DSH build: the host class names changed, so the CCD styles stay off; '
            + 'refresh compat/host-builds.ts with `node scripts/host-prefixes.mjs <app.asar>`',
          );
        }));
      } catch (error) {
        scope.dispose();
        logger.error('activation failed; native interface retained', error);
        return;
      }
      active = scope;
    };

    const off = form.subscribe(sync);
    sync();
    return () => {
      released = true;
      off();
      settingsScope.dispose();
      active?.dispose();
      active = null;
    };
  }, PLUGIN_ID);
}
