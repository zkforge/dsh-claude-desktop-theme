import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client';
import type {
  BlankSessionsPort, ConfigFormPort, ConfigFormsPort, ContextProjectionPort, ContextProjectionRead,
  HostServices, SidebarSessionsPort, ThemePreferencePort,
} from '../contracts/ports.ts';
import { readContextView } from '../../shared/context.ts';
import { TARGET_DSH_VERSION } from '../../shared/identity.ts';
import { blankSessionIds } from './blank-session-rows.ts';

/**
 * `ctx.configForms` is provided by the DSH settings layer
 * (`@deepseek-ai/dsh-client-ui-settings`) and is declared here structurally
 * because that package is not part of this plugin's type baseline. Lookup is
 * by this plugin's loader entry id, which its bundle patch fixes.
 */
function resolveConfigForms(ctx: Context): ConfigFormsPort {
  const service = (ctx as Context & { configForms?: ConfigFormsPort }).configForms;
  if (typeof service?.get !== 'function') {
    throw new Error(`DSH ${TARGET_DSH_VERSION} settings transport (configForms) is required`);
  }
  return {
    get(namespace): ConfigFormPort {
      const form = service.get(namespace);
      if (typeof form?.getSnapshot !== 'function' || typeof form.subscribe !== 'function') {
        throw new Error(`configForms.get(${namespace}) did not return a configuration form`);
      }
      return form;
    },
  };
}

/**
 * Build the theme service's preference face.
 *
 * `getTheme`／`setTheme` are the service's only read and write entries and
 * `theme/change` is its only change signal (see `ThemeRuntime`), so the plugin's
 * Appearance control is another surface for the native preference rather than a
 * second switch of its own. A build that does not publish them yields null and
 * the page keeps its other rows; activation is not failed over an optional
 * control.
 * @param ctx - client context carrying the theme service and its event bus.
 * @returns the port, or null when this build cannot read or write the preference.
 */
export function createThemePreferencePort(ctx: Context): ThemePreferencePort | null {
  const theme = ctx.theme;
  if (typeof theme?.getTheme !== 'function' || typeof theme.setTheme !== 'function'
    || typeof ctx.on !== 'function') return null;
  return {
    preference: () => theme.getTheme().preference,
    set: preference => theme.setTheme(preference),
    subscribe(listener) {
      const off = ctx.on('theme/change', () => listener());
      return () => { off(); };
    },
  };
}

/**
 * Build the provisional-New-Session face over the client session list.
 *
 * `ctx.sessions.list` is the Session Controller's catalog store and the only
 * source of the `blank` fact the column filters on; the Host owns the flag and
 * the plugin neither writes nor mirrors it. `sessions` is declared in the
 * plugin's own `inject` list, so the service is resolved rather than probed. A
 * build whose list lacks these two members yields null and the native rows stay
 * exactly as they are — the column loses a presentation filter, not its list.
 *
 * @param ctx - client context carrying the session service.
 * @returns the port, or null when this build does not publish a session list.
 */
function resolveBlankSessions(ctx: Context): BlankSessionsPort | null {
  const list = ctx.sessions?.list;
  if (typeof list?.getSnapshot !== 'function' || typeof list.subscribe !== 'function') return null;
  return {
    ids: () => blankSessionIds(list.getSnapshot()),
    subscribe: listener => list.subscribe(listener),
  };
}

/** Read collapsed membership from the same two catalogs the host browser uses. */
export function createSidebarSessionsPort(ctx: Context): SidebarSessionsPort | null {
  const sessions = ctx.sessions?.list;
  const workspaces = ctx.workspaces?.list;
  if (typeof sessions?.getSnapshot !== 'function' || typeof sessions.subscribe !== 'function'
    || typeof workspaces?.getSnapshot !== 'function' || typeof workspaces.subscribe !== 'function') return null;
  return {
    hasHistory() {
      const catalog = sessions.getSnapshot();
      if (catalog.phase !== 'ready') return null;
      return catalog.ids.some(id => {
        const row = catalog.byId[id];
        return row !== undefined && row.origin !== 'subagent' && !(row.blank && row.parentId === undefined);
      });
    },
    populatedGroups(filter, nested) {
      const catalog = sessions.getSnapshot();
      const registry = workspaces.getSnapshot();
      if (catalog.phase !== 'ready' || registry.phase !== 'ready') return null;
      const archived = new Set(registry.archivedSessionIds);
      const populated = new Set<string>();
      const matches = (id: typeof catalog.ids[number]) => {
        const row = catalog.byId[id];
        if (row === undefined || row.origin === 'subagent' || (row.blank && row.parentId === undefined)) return false;
        return filter === 0 ? !archived.has(id) : filter === 2 ? archived.has(id) : true;
      };
      const assigned = new Set(registry.items.flatMap(workspace => workspace.sessionIds));
      if (catalog.ids.some(id => !assigned.has(id) && matches(id))) populated.add('');
      for (const workspace of registry.items) {
        if (workspace.sessionIds.some(matches)) populated.add(workspace.workspaceId);
      }
      // Tree mode keeps empty ancestor folders when a descendant has history.
      if (nested) {
        const path = (value: string) => value.replace(/\\/gu, '/').replace(/\/+$/u, '') + '/';
        const occupiedPaths = registry.items.filter(row => populated.has(row.workspaceId)).map(row => path(row.path));
        for (const row of registry.items) {
          if (occupiedPaths.some(child => child.startsWith(path(row.path)))) populated.add(row.workspaceId);
        }
      }
      return populated;
    },
    subscribe(listener) {
      const offSessions = sessions.subscribe(listener);
      let offWorkspaces: () => void;
      try { offWorkspaces = workspaces.subscribe(listener); }
      catch (error) { offSessions(); throw error; }
      return () => { offWorkspaces(); offSessions(); };
    },
  };
}

/** One session's projection values, as the session list carries them. */
interface SessionProjectionValues {
  readonly contextPressure?: {
    readonly contextWindow?: number;
    readonly pressureTokens?: number;
    readonly projectedTokens?: number;
  };
  readonly contextBreakdown?: {
    readonly systemTokens?: number;
    readonly toolsTokens?: number;
    readonly messageTokens?: number;
  };
  /** This plugin's own key; read leniently, because its shape is ours alone. */
  readonly ccdContext?: unknown;
}

/** A non-negative finite count, or zero. */
function counted(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Build the context ring's data face over the client session list.
 *
 * `ctx.sessions.list` is the Session Controller's catalog store and the one
 * place the browser sees host-computed projections: `contextPressure` is the
 * ring's own occupancy, `contextBreakdown` its three-way composition, and
 * `ccdContext` this plugin's rows — all of them wire values the host shipped,
 * carried for sessions that were never opened as well as the live one. Reading
 * them here rather than recomputing them in the browser is what keeps the
 * panel's header identical to the ring beside it.
 *
 * A session with no capacity yet is null: the host's own `ContextMeter` renders
 * nothing in that state either, so the ring the panel hangs from is not there
 * to open.
 *
 * @param ctx - client context carrying the session service.
 * @returns the port, or null when this build does not publish a session list.
 */
export function createContextProjections(ctx: Context): ContextProjectionPort | null {
  const list = ctx.sessions?.list;
  if (typeof list?.getSnapshot !== 'function' || typeof list.subscribe !== 'function') return null;
  return {
    read(sessionId): ContextProjectionRead | null {
      /* The catalog keys its rows by the branded `SessionId`; this port takes
         the plain string the DOM carries, so the map is read structurally. */
      const bySession = list.getSnapshot().projectionsBySession as
        | Readonly<Record<string, { readonly values?: unknown }>>
        | undefined;
      const values = (bySession?.[sessionId]?.values ?? {}) as SessionProjectionValues;
      const pressure = values.contextPressure;
      const window = counted(pressure?.contextWindow);
      if (window === 0) return null;
      const breakdown = values.contextBreakdown;
      return {
        window,
        /* The ring's own occupancy: a route that projects a shadow price wins
           over the raw pressure, exactly as `contextOccupancy` decides it. */
        used: counted(pressure?.projectedTokens ?? pressure?.pressureTokens),
        systemTokens: counted(breakdown?.systemTokens),
        toolsTokens: counted(breakdown?.toolsTokens),
        messageTokens: counted(breakdown?.messageTokens),
        breakdown: readContextView(values.ccdContext),
      };
    },
    subscribe: listener => list.subscribe(listener),
  };
}

/** This compatibility boundary targets the pinned SDK, not arbitrary DSH versions. */
export function createHostServices(ctx: Context): HostServices {
  const slots = ctx.slots;
  const theme = ctx.theme;
  const workspace = ctx.uiWorkspace;
  if (typeof slots?.inject !== 'function' || typeof slots.register !== 'function'
    || typeof theme?.overrideTokens !== 'function'
    || typeof workspace?.startSession !== 'function') {
    throw new Error(`DSH ${TARGET_DSH_VERSION} UI services are required`);
  }
  return {
    slots,
    theme,
    themePreference: createThemePreferencePort(ctx),
    blankSessions: resolveBlankSessions(ctx),
    sidebarSessions: createSidebarSessionsPort(ctx),
    contextProjections: createContextProjections(ctx),
    configForms: resolveConfigForms(ctx),
    workspace: {
      openSession: target => workspace.openSession(target),
      openWorkspace: (id, beforeOpen) => workspace.openWorkspace(id, beforeOpen),
      startSession: id => workspace.startSession(id),
    },
  };
}
