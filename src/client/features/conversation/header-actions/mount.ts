import { useSyncExternalStore } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { FeatureEnvironment } from '../../../contracts/feature.ts';
import type { CleanupScope } from '../../../core/cleanup.ts';
import type { Disposer } from '../../../contracts/ports.ts';
import { headerLabels } from '../../../compat/header-labels.ts';
import { mountSessionMenuRow } from '../../../compat/session-menu.ts';
import { DSH_SLOTS } from '../../../compat/slots.ts';
import { HeaderActionButton } from './HeaderActionButton.tsx';
import { BlankHeaderActions } from './BlankHeaderActions.tsx';
import { CORNER_ENTRY, VIEWS, cornerRetirement, sidebarExpandRow, utilitiesEntry } from './entries.ts';
import { openView, resolveSidebarRight, resolveSidebarTabs } from './sidebar-view.ts';
import css from './header-actions.css';
import menuCss from './header-menus.css';

/**
 * Add terminal, browser and project folder to the conversation header, and move the
 * collapsed panel's re-entry action into the Session menu.
 *
 * The header's trailing group is a native list slot — `ui-open-in-app`,
 * `ui-schedule` and `session-log-export` all register into `utilities` — so the
 * plugin takes three more entries rather than replacing or reordering anything.
 * Each entry appears only while its tab kind is registered in the panel's own
 * registry, so a build without that view keeps the native cluster intact and
 * never shows a button that cannot open anything.
 *
 * The corner seat is different, and deliberately so. It is a *single* cell whose
 * shipped occupant is `ui-sidebar-right`'s collapsed-panel expand control; the
 * plugin shadows that occupant with the blank page's three view buttons,
 * visible only under the host's headerBlank state, and puts the expand action
 * into the Session menu's ⋮ list (`compat/session-menu.ts`), only while the panel
 * is collapsed. Nothing about the panel's own state changes hands: the menu row
 * calls the panel's own service method.
 *
 * @param ctx - client context carrying the injected services.
 * @param environment - feature environment for logging and style mounting.
 * @param cleanup - scope owning the stylesheet, the registrations and their Fiber.
 */
export function mountHeaderActions(ctx: Context, environment: FeatureEnvironment, cleanup: CleanupScope): void {
  cleanup.add(environment.dom.mountStyles(css));
  cleanup.add(environment.dom.mountStyles(menuCss));
  const registration = ctx.inject(['slots', 'sidebarRight', 'sidebarRightTabs'], scope => {
    const sidebar = resolveSidebarRight(scope);
    const tabs = resolveSidebarTabs(scope);
    if (sidebar === undefined || tabs === undefined) {
      environment.logger.debug('header-actions: right-Sidebar services are unavailable; native header retained');
      return () => {};
    }
    const copy = headerLabels(document);
    /* Every entry reads its copy from this one table, so a control cannot keep
       the label of the view it replaced. */
    const labels: Record<(typeof VIEWS)[number]['kind'], string> = {
      files: copy.files,
      terminal: copy.terminal,
      browser: copy.browser,
    };
    /** One entry per seat this module has taken, so a later sync never doubles it. */
    const live = new Map<string, Disposer>();
    const register = (key: string, entry: () => Disposer) => {
      if (live.has(key)) return;
      live.set(key, entry());
    };
    const withdraw = (key: string) => {
      live.get(key)?.();
      live.delete(key);
    };
    /** Open one view of the on-screen Session from a header control. */
    const openKind = (kind: string, slotSessionId: unknown) => {
      try {
        openView(sidebar, kind, String(slotSessionId));
      } catch (error) {
        environment.logger.error(`header-actions: the ${kind} view rejected the request`, error);
      }
    };
    /** One list entry in the utilities group, registered only while it is declared. */
    const takeView = (view: (typeof VIEWS)[number]) => scope.slots.inject(
      DSH_SLOTS.sessionHeaderUtilities,
      () => scope.slots.register(utilitiesEntry(view, labels, openKind), HeaderActionButton),
    );
    const subscribeViews = (listener: () => void) => typeof tabs.subscribe === 'function'
      ? tabs.subscribe(listener) : () => {};
    // A primitive snapshot stays stable between registry changes.
    const viewSnapshot = () => VIEWS.map(view => tabs.get(view.kind) === undefined ? '' : view.kind).join(',');
    const useAvailableViews = () => {
      const kinds = useSyncExternalStore(subscribeViews, viewSnapshot).split(',');
      return VIEWS.filter(view => kinds.includes(view.kind));
    };
    /** The corner remains available when the host hides blank-session utilities. */
    const takeCorner = () => scope.slots.inject(
      DSH_SLOTS.sessionHeaderCorner,
      () => scope.slots.register({
        ...cornerRetirement(),
        inject: sessionId => ({
          labels,
          useAvailableViews,
          open: (kind: (typeof VIEWS)[number]['kind']) => { openKind(kind, sessionId); },
        }),
      }, BlankHeaderActions),
    );
    const sync = () => {
      for (const view of VIEWS) {
        if (tabs.get(view.kind) === undefined) withdraw(view.kind);
        else register(view.kind, () => takeView(view));
      }
      register(CORNER_ENTRY, takeCorner);
    };
    const unsubscribe = typeof tabs.subscribe === 'function' ? tabs.subscribe(sync) : () => {};
    const menuRow = mountSessionMenuRow(
      document,
      sidebarExpandRow(sidebar, document, copy.expand),
      error => environment.logger.error('header-actions: the session menu row failed', error),
    );
    try {
      sync();
    } catch (error) {
      unsubscribe();
      menuRow();
      for (const dispose of live.values()) dispose();
      live.clear();
      environment.logger.error('header-actions: the header views could not be registered', error);
      return () => {};
    }
    return () => {
      unsubscribe();
      menuRow();
      for (const dispose of live.values()) dispose();
      live.clear();
    };
  });
  cleanup.add(() => { void registration.dispose(); });
}
