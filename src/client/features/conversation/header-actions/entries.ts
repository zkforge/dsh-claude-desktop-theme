import { ANCHOR } from '../../../compat/host-dom.ts';
import type { SessionMenuRow } from '../../../compat/session-menu.ts';
import type { SidebarRightPort } from '../../../contracts/ports.ts';
import { DSH_SLOTS, OVERRIDE_PRIORITY } from '../../../compat/slots.ts';
import type { HeaderActionProps } from './HeaderActionButton.tsx';

/**
 * What this plugin contributes to the conversation header.
 *
 * The mounts in `mount.ts` are wiring: they resolve the panel's face, keep one
 * registration per seat, and hand it a component. *What* is offered — which
 * slot, in what order, at what shadowing rank, under which condition — is
 * decided here, so the contract can be read and tested without a renderer.
 */

/**
 * The right panel's own file list (`ui-sidebar-files`): the Session's project
 * directory, as a tree, in the same panel the terminal and browser views open
 * into.
 */
export const FILES_KIND = 'files';

/**
 * List orders inside `conversation.session.header.utilities`.
 *
 * The project folder leads the row, so it carries the lowest order of every
 * entry there is — below the retired open-in-app control (-10) and the native
 * scheduled-tasks entry (-5), not only below this plugin's own views: the
 * reference draws the folder as the cluster's first control, whatever a Session
 * happens to carry. The two views then land directly before the native session
 * menu at 0 and keep it as the cluster's closing entry.
 */
export const FOLDER_ORDER = -11;
export const TERMINAL_ORDER = -2;
export const BROWSER_ORDER = -1;

/** The views this plugin exposes in the utilities group, in cluster order. */
export const VIEWS = [
  { id: 'ccd-folder', kind: FILES_KIND, order: FOLDER_ORDER },
  { id: 'ccd-terminal', kind: 'terminal', order: TERMINAL_ORDER },
  { id: 'ccd-browser', kind: 'browser', order: BROWSER_ORDER },
] as const;

/**
 * Registration key of the corner retirement. The seat is a *single* cell, so
 * the entry carries no id of its own — this key names it in the mount's own
 * bookkeeping, where a registration is replaced at most once.
 */
export const CORNER_ENTRY = 'header-corner';

/** Opens or focuses one right-panel view for the Session whose header was used. */
export type OpenViewKind = (kind: string, sessionId: string) => void;

/**
 * The utilities entry for one right-panel view.
 *
 * `id` and `order` are what make the entry a *list* cell: the panel's existing
 * entries keep their own seats, and this one takes the position its order names.
 *
 * @param view - the entry's identity and the page kind it opens.
 * @param labels - localised copy, by view kind.
 * @param open - opens the kind for the slot's own Session id.
 * @returns the options the registry is called with.
 */
export function utilitiesEntry(
  view: (typeof VIEWS)[number],
  labels: Record<(typeof VIEWS)[number]['kind'] | typeof FILES_KIND, string>,
  open: OpenViewKind,
) {
  return {
    name: DSH_SLOTS.sessionHeaderUtilities,
    id: view.id,
    order: view.order,
    /* Slot scopes are strings; the panel's own face takes them as they come. */
    inject: (sessionId: string): HeaderActionProps => ({
      label: labels[view.kind],
      kind: view.kind,
      open: () => { open(view.kind, sessionId); },
    }),
  };
}

/**
 * The corner seat's retirement: the cell the reference leaves empty.
 *
 * That seat's shipped occupant is `ui-sidebar-right`'s collapsed-panel expand
 * control, and this interface does not want it: hovering it drew a control the
 * reference has no room for, and the action it carries lives in the Session menu
 * instead ({@link sidebarExpandRow}). Registering below the occupant's rank
 * ({@link OVERRIDE_PRIORITY}) takes the cell, and the entry's component renders
 * nothing — a structural retirement rather than a control hidden in place, so
 * nothing of the displaced button stays behind: no hover surface, no tooltip and
 * no hit area.
 *
 * @returns the options the registry is called with.
 */
export function cornerRetirement() {
  return {
    name: DSH_SLOTS.sessionHeaderCorner,
    priority: OVERRIDE_PRIORITY,
  };
}

/**
 * The Session menu's row that puts a collapsed right panel back on screen.
 *
 * Two facts decide it, and both are read fresh: the frame carries the host's own
 * `data-rightbar-collapsed` (the panel's column has no width) and the panel's
 * face can expand it again. The action is the panel's own method rather than a
 * click on a hidden control, so the column's state stays entirely the panel's.
 *
 * @param sidebar - the right-Sidebar face the header was built over.
 * @param document - the renderer document whose frame reports the panel's state.
 * @param label - localised row copy.
 * @returns the row the menu module keeps in the header's ⋮ list while it holds.
 */
export function sidebarExpandRow(sidebar: SidebarRightPort, document: Document, label: string): SessionMenuRow {
  return {
    label,
    wanted: () => typeof sidebar.toggleExpanded === 'function'
      && document.querySelector(ANCHOR.rightbarCollapsed) !== null,
    act: () => { sidebar.toggleExpanded?.(); },
  };
}
