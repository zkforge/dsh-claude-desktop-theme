import type { Context } from '@deepseek-ai/cordis';
import type { ReactElement } from 'react';
import type {} from '@deepseek-ai/dsh-client-locale/client';
import { mountSettingsSection } from '../../compat/settings-section.ts';
import type { SettingsSectionProps } from '../../compat/settings-section.ts';
import { en, SETTINGS_NAMESPACE, zh } from './locales.ts';

/** Register the plugin form as a top-level settings section with localized copy. */
export function registerSettingsPage(
  ctx: Context,
  id: string,
  component: (props: SettingsSectionProps) => ReactElement | null,
): Pick<ReturnType<Context['inject']>, 'dispose'> {
  return ctx.inject(['slots', 'locale'], child => {
    child.effect(
      () => child.locale.register(SETTINGS_NAMESPACE, { zh, en }),
      'ccd-style: configuration page copy',
    );
    const t = child.locale.bind(SETTINGS_NAMESPACE);
    return mountSettingsSection(child, id, SETTINGS_NAMESPACE, () => t('nav'), component);
  });
}
