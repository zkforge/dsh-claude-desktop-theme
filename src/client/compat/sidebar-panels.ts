import type { Context } from '@deepseek-ai/cordis';
import type { ReactElement } from 'react';
import type { Disposer } from '../contracts/ports.ts';

const SIDEBAR_PANEL_SLOT = 'sidebar.panellist';
const MAIN_SLOT = 'main';

interface PanelSlots {
  inject(name: string, register: () => Disposer): Disposer;
  register(options: Record<string, unknown>, component: (props: never) => ReactElement | null): Disposer;
}

export interface MainPanelRegistration<P> {
  readonly id: string;
  readonly order: number;
  readonly locale: string;
  readonly label: () => string;
  /** The centre column's page while the panel is active. */
  readonly page: (props: P) => ReactElement | null;
  /** The row's glyph, rendered with the column's `{ size, active }`. */
  readonly glyph: (props: { readonly size?: number; readonly active?: boolean }) => ReactElement | null;
}

/** Register a global panel: its sidebar row and the page it opens. */
export function mountMainPanel<P>(ctx: Context, panel: MainPanelRegistration<P>): Disposer {
  const slots = ctx.slots as unknown as PanelSlots;
  const offPage = slots.inject(MAIN_SLOT, () => slots.register(
    { name: MAIN_SLOT, key: panel.id, locale: panel.locale },
    panel.page as (props: never) => ReactElement | null,
  ));
  const offRow = slots.inject(SIDEBAR_PANEL_SLOT, () => slots.register(
    { name: SIDEBAR_PANEL_SLOT, id: panel.id, order: panel.order, label: panel.label, locale: panel.locale },
    panel.glyph as (props: never) => ReactElement | null,
  ));
  return () => { offRow(); offPage(); };
}
