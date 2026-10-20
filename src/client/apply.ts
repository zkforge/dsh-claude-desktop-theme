import type { Context } from '@deepseek-ai/cordis';
import type { FeatureEnvironment } from './contracts/feature.ts';
import type { Logger } from './contracts/ports.ts';
import { adoptConfig } from '../shared/config.ts';
import { ENTRY_ID, PLUGIN_ID } from '../shared/identity.ts';
import { createHostServices } from './compat/adapter.ts';
import { mountBrowserHeader } from './compat/browser-header.ts';
import { mountComposerMenuPlacement } from './compat/composer-menus.ts';
import { mountEmptyGroups } from './compat/empty-groups.ts';
import { watchHostBuild } from './compat/host-builds.ts';
import { mountComposerStats } from './compat/stats-values.ts';
import { mountHeroChips } from './compat/hero-chips.ts';
import { mountComposerPlaceholder } from './compat/composer-placeholder.ts';
import { mountComposerStatusOrder } from './compat/composer-status-order.ts';
import { mountVoiceWaveform } from './compat/voice-waveform.ts';
import { mountPermissionConfirmation } from './compat/permission-confirmation.ts';
import { mountAgentPresetMenu, mountPermissionMenu } from './compat/permission-menu.ts';
import { mountWorkspaceMenu } from './compat/workspace-menu.ts';
import { mountScrollPills } from './compat/scroll-pill.ts';
import { mountFilesPane } from './compat/files-pane.ts';
import { mountRightPanes } from './compat/right-panes.ts';
import { mountOpenTargetMode } from './compat/open-target.ts';
import { mountSidebarSearch } from './compat/sidebar-search.ts';
import { headerMenuActions } from './compat/header-menu-actions.ts';
import { mountHeaderMenus } from './compat/header-menus.ts';
import { createDomPort } from './compat/dom.ts';
import { CleanupScope } from './core/cleanup.ts';
import { mountFeatures } from './core/mount-features.ts';
import { mountTheme } from './theme/mount.ts';
import { mountModelControls } from './features/model-controls/mount.ts';
import { mountStatusGroups } from './compat/status-groups.ts';
import { mountViewOptions } from './features/view-options/mount.ts';
import { mountContextPanel } from './features/context-panel/mount.ts';
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
export const inject = ['slots', 'theme', 'uiWorkspace', 'configForms', 'sessions', 'workspaces', 'uiSession'];

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
        /* The hero row's two chips are one family: the workspace picker's chip
           takes the preset seat's own width, so both read the same length and
           the mode's label is never the one that gets cut. Unconditional like
           the other Composer compat modules — the row belongs to the host's
           hero phase, not to a switch of ours. */
        scope.add(mountHeroChips(
          document,
          error => logger.error('composer: hero chip width observer failed', error),
        ));
        /* Keep context-ring labels in sync with their percentage-free glyph. */
        scope.add(mountComposerStatusOrder(
          document,
          error => logger.error('composer: status-bar order observer failed', error),
        ));
        scope.add(mountVoiceWaveform(
          document,
          error => logger.error('composer: voice waveform failed', error),
        ));
        scope.add(mountComposerPlaceholder(
          document,
          error => logger.error('composer: placeholder observer failed', error),
        ));
        /* Both pickers share two-line rows, headings and numeric shortcuts. */
        scope.add(mountPermissionMenu(
          document,
          error => logger.error('composer: permission card observer failed', error),
        ));
        scope.add(mountPermissionConfirmation(
          document,
          error => logger.error('composer: permission confirmation observer failed', error),
        ));
        scope.add(mountAgentPresetMenu(
          document,
          error => logger.error('composer: agent preset card observer failed', error),
        ));
        /* The workspace picker's labels come from the host's own locale namespace,
           so the typed ellipsis is rewritten in the rendered text nodes instead. */
        scope.add(mountWorkspaceMenu(
          document,
          error => logger.error('workspace menu: label rewrite failed', error),
        ));
        /* The window's scrollbars span every feature the plugin draws — the
           sidebar's tree, the Files pane, the agent-team panel and the
           Conversation page — so they mount here rather than under one of the
           switches that draw one of those surfaces. */
        scope.add(mountScrollPills(
          document,
          error => logger.error('scrollbars: activity listener failed', error),
        ));
        /* The Files pane's filter field, tree control, tab mark and empty
           column are nodes the host has no counterpart for, so they are
           supplied from the compatibility layer the same way — beside the
           sheet that dresses the pane around them. */
        scope.add(mountFilesPane(
          document,
          error => logger.error('files pane: observer failed', error),
        ));
        /* The panel's views as blocks rather than tabs: the leaf whose module
           takes each view out of the strip into a pane of its own
           (`compat/right-panes.ts`). It needs the panel's own service, so it is
           mounted here rather than from a feature's own mount. */
        scope.add(mountRightPanes(
          ctx,
          document,
          error => logger.error('right panes: observer failed', error),
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
          scope.add(mountHeaderMenus(document, headerMenuActions(ctx), error => logger.error('header menus: operation failed', error)));
        }
        if (next.features.conversation || next.features['new-session']) {
          mountModelControls(ctx, environment, scope);
        }
        /* Compose the frame-wide pet seat alongside the page features. */
        if (next.features['composer-pet']) {
          mountComposerPet(ctx, environment, scope);
        }
        /* The sidebar's view-options card is this plugin's own surface over the
           host's menu, and the empty-group rule is the one view setting the
           plugin owns; both follow the sidebar switch that draws the trigger. */
        if (next.features.sidebar) {
          const view = mountViewOptions(ctx, environment, scope);
          scope.add(mountSidebarSearch(
            document,
            error => logger.error('sidebar: search field could not be placed', error),
          ));
          if (next.view.groupByStatus) {
            scope.add(mountStatusGroups(document, ctx, next.view.showEmptyGroups,
              error => logger.error('sidebar: status grouping failed', error)));
          }
          /* The browsing region's one header line: the state its stylesheet
             parks on, and the word its title line draws. */
          scope.add(mountBrowserHeader(
            document,
            error => logger.error('sidebar: browsing header observer failed', error),
          ));
          scope.add(mountEmptyGroups(
            document,
            !next.view.showEmptyGroups,
            error => logger.error('sidebar: empty-group observer failed', error),
            { source: host.sidebarSessions, settings: view.settings, showAll: view.showAllSessions },
          ));
        }
        /* The context ring's breakdown panel is this plugin's own surface over
           the ring the Composer draws, so it follows the same rule: the switch
           decides whether the ring opens our card or DSH's own panel. */
        if (next.features['context-panel']) {
          mountContextPanel(ctx, environment, scope);
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
