import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { FeatureEnvironment } from '../../contracts/feature.ts';
import type { CleanupScope } from '../../core/cleanup.ts';
import { menuRowClasses } from '../../compat/host-dom.ts';
import { mountSidebarPanelRows } from '../../compat/sidebar-editor.ts';
import { mountMoreCardRows, sidebarPanelsPort } from '../../compat/sidebar-panels.ts';
import { DSH_SLOTS } from '../../compat/slots.ts';
import { EditSidebarRow, HiddenPanelRows } from './MoreCardRows.tsx';
import { SidebarEditor } from './SidebarEditor.tsx';
import { createEditorState, createHiddenPanels } from './state.ts';
import css from './sidebar-editor.css';

/** List order inside the frame-wide overlay; the search palette is at 50. */
const SIDEBAR_EDITOR_ORDER = 60;
/** `ui-entry-customization`'s Browse and Create rows register without an order
    (0): the hidden panels lead the card and 编辑侧边栏… closes it. */
const HIDDEN_ROWS_ORDER = -10;
const EDIT_ROW_ORDER = 10;

/**
 * Edit sidebar: choose which global panels the column lists.
 *
 * The More card gains 编辑侧边栏… below the host's plugin rows; it opens a
 * dialog of every panel with a checkbox, and an unchecked panel leaves the
 * column for the head of the same card (`compat/sidebar-editor.ts` marks its
 * row, `sidebar-editor.css` hides it). The choice is kept in this window's
 * storage, so it survives reloads and switching the interface off and on;
 * while the interface is off, DSH lists every panel again.
 *
 * @param ctx - client root context carrying the slot and layout services.
 * @param environment - configuration, ports and logging for this activation.
 * @param cleanup - scope owning the styles, the row marks and the registrations.
 */
export function mountSidebarEditor(ctx: Context, environment: FeatureEnvironment, cleanup: CleanupScope): void {
  cleanup.add(environment.dom.mountStyles(css));
  const report = (error: unknown) => environment.logger.error('sidebar editor: operation failed', error);
  const port = sidebarPanelsPort(ctx, document);
  const storage = (() => { try { return document.defaultView?.localStorage; } catch { return undefined; } })();
  const hidden = createHiddenPanels(storage);
  const state = createEditorState();
  const rows = mountSidebarPanelRows(document, port, hidden, report);
  cleanup.add(rows.dispose);
  const registration = ctx.inject(['slots', 'layout'], scope => {
    scope.effect(() => scope.slots.inject(DSH_SLOTS.shellOverlay, () => scope.slots.register({
      name: DSH_SLOTS.shellOverlay, id: 'ccd-sidebar-editor', order: SIDEBAR_EDITOR_ORDER,
      inject: () => ({ state, hidden, port, glyph: rows.glyph }),
    }, SidebarEditor)), 'ccd-style: edit sidebar dialog');
    scope.effect(() => mountMoreCardRows(scope, {
      id: 'ccd-hidden-panels', order: HIDDEN_ROWS_ORDER,
      inject: () => ({ hidden, port, classes: menuRowClasses(document) }),
    }, HiddenPanelRows), 'ccd-style: hidden panel rows');
    scope.effect(() => mountMoreCardRows(scope, {
      id: 'ccd-edit-sidebar', order: EDIT_ROW_ORDER,
      inject: () => ({ state, classes: menuRowClasses(document) }),
    }, EditSidebarRow), 'ccd-style: edit sidebar row');
  });
  cleanup.add(() => {
    state.close();
    void registration.dispose();
  });
}
