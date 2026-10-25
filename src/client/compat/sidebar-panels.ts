import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { ReactElement } from 'react';
import type { Disposer } from '../contracts/ports.ts';
import { panelDisplayName } from './sidebar-navigation.ts';

/**
 * The sidebar's global panels as `ui-sidebar` lists them.
 *
 * Verified against the installed DSH 0.2.1-rc.3 client bundle: `SidebarRoot`
 * reads `sidebar.panellist` entries' `id`, `order` and `label` (a string or a
 * thunk), sorts them by `order`, and renders one `PanelRow` per entry — the
 * entry's component is only the row's glyph, rendered with `{ size, active }`.
 * The centre column renders the `main` keyed entry whose `key` is the active
 * panel id. `ui-sidebar` is outside the SDK baseline, so the boundary stays
 * structural here, like `settings-section.ts`.
 */
export const SIDEBAR_PANEL_SLOT = 'sidebar.panellist';
/** Rows of the panel list's More card; `ui-sidebar` shows More while this list has entries. */
export const SIDEBAR_PANEL_ACTIONS_SLOT = 'sidebar.panellist.actions';
const MAIN_SLOT = 'main';

export interface SidebarPanel {
  readonly id: string;
  /** The name the row shows, after `sidebar-navigation.ts` renamed it. */
  readonly label: string;
}

/** The panel list `ui-sidebar` renders and the one call that opens an entry. */
export interface SidebarPanelsPort {
  /** Every registered panel in the order the column lists them. */
  panels(): readonly SidebarPanel[];
  subscribe(listener: () => void): Disposer;
  /** The panel the centre column shows, or null on a Session. */
  active(): string | null;
  select(id: string): void;
}

interface PanelEntry {
  readonly options: { readonly id?: string; readonly order?: number; readonly label?: string | (() => string) };
}

interface PanelSlots {
  entriesOfSlot(key: string): readonly PanelEntry[];
  subscribe(key: string, fn: () => void): () => void;
  inject(name: string, register: () => Disposer): Disposer;
  register(options: Record<string, unknown>, component: (props: never) => ReactElement | null): Disposer;
}

/**
 * @param ctx - client context carrying the slot and layout services.
 * @param document - the renderer document, whose language names renamed rows.
 */
export function sidebarPanelsPort(ctx: Context, document: Document): SidebarPanelsPort {
  const slots = ctx.slots as unknown as PanelSlots;
  type PanelId = Parameters<typeof ctx.layout.selectPanel>[0];
  return {
    panels() {
      /* The same projection `ui-sidebar` sorts: Array#sort is stable, so equal
         orders keep registration sequence exactly as the column does. */
      return slots.entriesOfSlot(SIDEBAR_PANEL_SLOT).flatMap(({ options }) => {
        if (typeof options.id !== 'string') return [];
        const raw = typeof options.label === 'function' ? options.label() : options.label;
        return [{ id: options.id, order: options.order ?? 0, label: panelDisplayName(document, raw ?? options.id) }];
      }).sort((a, b) => a.order - b.order).map(({ id, label }) => ({ id, label }));
    },
    subscribe(listener) {
      const offEntries = slots.subscribe(SIDEBAR_PANEL_SLOT, listener);
      const offPanel = ctx.layout.panelInfo.subscribe(listener);
      return () => { offEntries(); offPanel(); };
    },
    active: () => ctx.layout.panelInfo.getSnapshot().activePanelId,
    select(id) { ctx.layout.selectPanel(id as PanelId); },
  };
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

/**
 * Add rows to the panel list's More card. `PanelMoreMenu` renders every
 * `sidebar.panellist.actions` entry, by `order`, inside its `Menu` list with
 * `{ entries, onOpen, onPinnedChange, onDismiss }`; `inject`'s face is merged
 * over those owner props.
 */
export function mountMoreCardRows<P>(
  ctx: Context,
  entry: { readonly id: string; readonly order: number; readonly inject: () => Record<string, unknown> },
  rows: (props: P) => ReactElement | null,
): Disposer {
  const slots = ctx.slots as unknown as PanelSlots;
  return slots.inject(SIDEBAR_PANEL_ACTIONS_SLOT, () => slots.register(
    { name: SIDEBAR_PANEL_ACTIONS_SLOT, id: entry.id, order: entry.order, inject: entry.inject },
    rows as (props: never) => ReactElement | null,
  ));
}
