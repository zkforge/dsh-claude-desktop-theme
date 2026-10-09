import type { ImplementedFeature } from '../../contracts/feature.ts';
import { mountAccountMenu } from '../../compat/account-menu.ts';
import { mountBlankSessionRows } from '../../compat/blank-session-rows.ts';
import { mountSidebarNavigation } from '../../compat/sidebar-navigation.ts';
import { probeHost } from '../../compat/host-dom.ts';
import accountMenuCss from './account-menu.css';
import sidebarCss from './sidebar.css';
import navigationCss from './navigation.css';
import { SIDEBAR_NAVIGATION_ICONS } from './navigation-icons.ts';

/**
 * Sidebar presentation: compact navigation rows, flat project groups and a
 * calmer foot. Every entry DSH registers — New Session, the global panel list,
 * the workspace browser and Settings — stays exactly where the host put it; the
 * account menu is reshaped, never re-authored.
 *
 * The one list policy this module owns is the provisional New Session row: DSH
 * creates the Session as soon as New Session is used, and the host marks that
 * row `blank` until the first message. The column keeps the row out of the list
 * (see `compat/blank-session-rows.ts`), so the entry appears with the first sent
 * message rather than with the click that opened the page.
 */
export const sidebarFeature: ImplementedFeature = {
  id: 'sidebar',
  status: 'implemented',
  task: 'ARCHITECTURE.md#界面模块',
  mount(environment, scope) {
    /* The stylesheets are inert until the host renders the column, so they are
       mounted unconditionally: a feature enabled while another panel is on
       screen must still style the sidebar when the column comes back. */
    const probe = probeHost(document);
    if (!probe.sidebar) environment.logger.debug('sidebar: column not mounted yet');
    scope.add(environment.dom.mountStyles(sidebarCss));
    scope.add(environment.dom.mountStyles(accountMenuCss));
    scope.add(environment.dom.mountStyles(navigationCss));
    scope.add(mountSidebarNavigation(
      document, SIDEBAR_NAVIGATION_ICONS,
      error => environment.logger.error('sidebar: navigation observer failed', error),
    ));
    scope.add(mountAccountMenu(
      document,
      error => environment.logger.error('sidebar: account menu observer failed', error),
    ));
    const blankSessions = environment.host.blankSessions;
    if (blankSessions === null) {
      environment.logger.debug('sidebar: session list unavailable; blank rows stay native');
      return;
    }
    scope.add(mountBlankSessionRows(
      document,
      blankSessions,
      error => environment.logger.error('sidebar: blank-session filter failed', error),
    ));
  },
};
