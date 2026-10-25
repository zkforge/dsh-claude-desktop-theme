import type { Context } from '@deepseek-ai/cordis';
import type { ReactElement } from 'react';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import { mountSettingsSection } from '../../compat/settings-section.ts';
import type { SettingsSectionProps } from '../../compat/settings-section.ts';
import { mountMainPanel } from '../../compat/sidebar-panels.ts';
import { en, SETTINGS_NAMESPACE, zh } from './locales.ts';

/** Sidebar row and centre-column page of the plugin's own Theme panel. */
export const THEME_PANEL_ID = 'ccd-theme';
/** After the host's Customize (0) and Scheduled tasks (10) rows. */
const THEME_PANEL_ORDER = 20;

export interface ThemePanelComponents {
  readonly page: (props: SettingsSectionProps) => ReactElement | null;
  readonly glyph: (props: { readonly size?: number }) => ReactElement | null;
}

/**
 * Register the plugin form twice under one dictionary: as a top-level settings
 * section, and as the Theme panel the sidebar lists beside Customize.
 */
export function registerSettingsPage(
  ctx: Context,
  id: string,
  component: (props: SettingsSectionProps) => ReactElement | null,
  panel: ThemePanelComponents,
): Pick<ReturnType<Context['inject']>, 'dispose'> {
  return ctx.inject(['slots', 'locale', 'layout'], child => {
    child.effect(
      () => child.locale.register(SETTINGS_NAMESPACE, { zh, en }),
      'ccd-style: configuration page copy',
    );
    const t = child.locale.bind(SETTINGS_NAMESPACE);
    child.effect(() => mountMainPanel(child, {
      id: THEME_PANEL_ID,
      order: THEME_PANEL_ORDER,
      locale: SETTINGS_NAMESPACE,
      label: () => t('panel'),
      page: panel.page,
      glyph: panel.glyph,
    }), 'ccd-style: theme panel');
    return mountSettingsSection(child, id, SETTINGS_NAMESPACE, () => t('nav'), component);
  });
}
