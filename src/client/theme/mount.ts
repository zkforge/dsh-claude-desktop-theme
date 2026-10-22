import type { FeatureEnvironment } from '../contracts/feature.ts';
import type { CleanupScope } from '../core/cleanup.ts';
import { resolveThemeTokens, THEME_OVERRIDE_SOURCE } from './tokens.ts';
import composerCss from './composer.css';
import menuCss from './menus.css';
import dialogCss from './dialogs.css';
import scrollbarCss from './scrollbars.css';
import tokenCss from './tokens.css';
import scheduleCss from './schedule.css';
import navigationHistoryCss from './navigation-history.css';

/**
 * Plugin-scoped presentation base: the root activation marker, the design
 * variables, the shared Composer geometry two features depend on (siblings must
 * not import each other), the host popup chrome (DESIGN.md §6.7), the ink the
 * window's scrollbars are painted in and the semantic token overrides.
 *
 * The override layer is recomputed on every mount, so a configuration change
 * releases the previous layer through the same scope that owns the stylesheets
 * and stacks the new one; `overrideTokens` replaces a source's layer wholesale.
 * @param environment - activation services and configuration.
 * @param scope - activation scope owning every resource mounted here.
 */
export function mountTheme(environment: FeatureEnvironment, scope: CleanupScope): void {
  scope.add(environment.dom.activate());
  scope.add(environment.dom.mountStyles(tokenCss));
  scope.add(environment.dom.mountStyles(composerCss));
  scope.add(environment.dom.mountStyles(menuCss));
  scope.add(environment.dom.mountStyles(dialogCss));
  scope.add(environment.dom.mountStyles(scrollbarCss));
  scope.add(environment.dom.mountStyles(scheduleCss));
  scope.add(environment.dom.mountStyles(navigationHistoryCss));
  const tokens = resolveThemeTokens(environment.config);
  if (Object.keys(tokens).length > 0) {
    scope.add(environment.host.theme.overrideTokens(THEME_OVERRIDE_SOURCE, tokens));
  }
}
