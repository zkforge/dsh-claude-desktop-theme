import type { Context } from '@deepseek-ai/cordis';
import type { ReactElement } from 'react';
import type { Disposer } from '../contracts/ports.ts';

/**
 * Public list slot declared by ui-settings-general's SettingsRoot.
 * Verified against the installed DSH 0.2.0-rc.2 client bundle: the navigation
 * reads id, order and label; the selected section receives close and locale t.
 * This provider is outside our SDK baseline, so keep its boundary structural.
 */
export const SETTINGS_SECTION_SLOT = 'settings.section';

export interface SettingsSectionProps {
  readonly t?: (key: string, params?: Record<string, unknown>) => string;
}

interface SettingsSectionSlots {
  inject(name: string, register: () => Disposer): Disposer;
  register(options: {
    name: string;
    id: string;
    order: number;
    label: () => string;
    locale: string;
  }, component: (props: SettingsSectionProps) => ReactElement | null): Disposer;
}

/** Register an independently navigable section once the host declares its slot. */
export function mountSettingsSection(
  ctx: Context,
  id: string,
  locale: string,
  label: () => string,
  component: (props: SettingsSectionProps) => ReactElement | null,
): Disposer {
  const slots = ctx.slots as unknown as SettingsSectionSlots;
  return slots.inject(SETTINGS_SECTION_SLOT, () => slots.register({
    name: SETTINGS_SECTION_SLOT,
    id,
    order: 20,
    label,
    locale,
  }, component));
}

/**
 * SettingsRoot hardcodes icons by id, with a gear for extension sections.
 * It emits no section id on navigation buttons. Match our localized label only
 * inside the settings dialog navigation, and leave React's SVG intact.
 */
export function mountSettingsSectionIcon(document: Document, labels: readonly string[]): Disposer {
  const marked = new Set<Element>();
  const update = () => {
    const matches = new Set<Element>();
    for (const button of document.querySelectorAll('[role="dialog"][data-shortcut-modal="settings"] nav button')) {
      if (labels.includes(button.textContent?.trim() ?? '')) matches.add(button);
    }
    for (const button of marked) {
      if (!matches.has(button)) {
        button.removeAttribute('data-ccd-settings-icon');
        marked.delete(button);
      }
    }
    for (const button of matches) {
      button.setAttribute('data-ccd-settings-icon', '');
      marked.add(button);
    }
  };
  const observer = new MutationObserver(update);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  update();
  return () => {
    observer.disconnect();
    for (const button of marked) button.removeAttribute('data-ccd-settings-icon');
    marked.clear();
  };
}
