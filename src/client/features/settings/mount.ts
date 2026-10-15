import type { Context } from '@deepseek-ai/cordis';
import { createElement } from 'react';
import type { ConfigFormPort, DomPort, ThemePreferencePort } from '../../contracts/ports.ts';
import type { CleanupScope } from '../../core/cleanup.ts';
import { ENTRY_ID } from '../../../shared/identity.ts';
import { ConfigPage } from './ConfigPage.tsx';
import { registerSettingsPage } from './register.ts';
import css from './settings.css';
import { mountSettingsSectionIcon } from '../../compat/settings-section.ts';
import { zh, en } from './locales.ts';

/**
 * Register this plugin in the main settings navigation.
 *
 * The page lives outside the activation scope on purpose: switching the
 * interface off releases every style resource, and the page has to survive that
 * to switch it back on.
 * @param ctx - client context, injected for slots and the locale service.
 * @param dom - style port owning the page's stylesheet.
 * @param form - this plugin's configuration form.
 * @param themePreference - the native theme preference face, or null when the
 * theme service does not publish one.
 * @param scope - scope owning the stylesheet, the dictionary and the registration.
 */
export function mountSettingsPage(
  ctx: Context,
  dom: DomPort,
  form: ConfigFormPort,
  themePreference: ThemePreferencePort | null,
  scope: CleanupScope,
): void {
  scope.add(dom.mountStyles(css));
  scope.add(mountSettingsSectionIcon(document, [zh.nav, en.nav]));
  const registration = registerSettingsPage(
    ctx,
    ENTRY_ID,
    props => createElement(ConfigPage, { ...props, form, themePreference }),
  );
  scope.add(() => { void registration.dispose(); });
}
