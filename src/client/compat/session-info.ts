import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ContextProjectionPort, SidebarRightPort } from '../contracts/ports.ts';
import type { SessionInfoPort, SessionInfoSnapshot } from '../contracts/session-info.ts';
import {
  SESSION_ENVIRONMENT_PATH, SESSION_SKILL_PATH, infoRecord, sessionMetrics, showSessionInfo, type SessionEnvironment,
} from '../../shared/session-info.ts';
import { frameScheduler } from './frame.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsInTranscript } from './mutation-scope.ts';
import { fileAddress, openView, resolveSidebarRight } from './sidebar-view.ts';

const MARKER = 'data-ccd-session-info';
const RESERVE = 316;
const OPEN_STORAGE = 'ccd-session-info-open';

/** The Remote `dsh-client-ui-skill` reads the Session's catalog through. */
interface SkillCatalogRemote {
  list(scope: { sessionId: SessionId }, signal?: AbortSignal): Promise<
    { ok: true; value: { skills: readonly { name: string; path?: string }[] } }
    | { ok: false; error: { message: string } }>;
}

/** Owns only added marks and subscriptions; host React nodes keep their parents. */
export function createSessionInfoPort(ctx: Context, document: Document, projections: ContextProjectionPort | null): SessionInfoPort {
  const listeners = new Set<() => void>();
  let body: HTMLElement | null = null;
  let disposed = false;
  let request: AbortController | null = null;
  let requestSession: string | null = null;
  let loadedAt = 0;
  let previousValues: unknown;
  let requested = true;
  try { requested = document.defaultView?.localStorage.getItem(OPEN_STORAGE) !== 'false'; } catch { /* Keep the default when storage is unavailable. */ }
  let snapshot: SessionInfoSnapshot = {
    session: null, visible: false, left: 0, top: 0, height: 0,
    zh: document.documentElement.lang.toLowerCase().startsWith('zh'),
    workspace: '', cwd: '', context: null, metrics: sessionMetrics({}), environment: null, environmentState: 'loading',
  };
  const publish = (next: SessionInfoSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const loadEnvironment = (force = false) => {
    const session = snapshot.session;
    if (disposed || !snapshot.visible || document.hidden || session === null || request !== null) return;
    if (!force && requestSession === session && Date.now() - loadedAt < 30_000) return;
    const controller = new AbortController();
    request = controller;
    requestSession = session;
    const deadline = setTimeout(() => controller.abort(), 10_000);
    void (async () => {
      try {
        const response = await fetch(`${SESSION_ENVIRONMENT_PATH}?session=${encodeURIComponent(session)}`, { signal: controller.signal });
        if (response.status === 404) {
          const missingDirectory = infoRecord(await response.json().catch(() => null))['error'] === 'missing-directory';
          if (!disposed && !controller.signal.aborted && snapshot.session === session) {
            publish({ ...snapshot, environment: null, environmentState: missingDirectory ? 'error' : 'restart' });
          }
          return;
        }
        const raw = infoRecord(response.ok ? await response.json() : null);
        if (typeof raw['cwd'] !== 'string' || !['ready', 'not-repo', 'error'].includes(String(raw['git']))) throw new Error('Environment unavailable');
        const environment: SessionEnvironment = {
          cwd: raw['cwd'], branch: typeof raw['branch'] === 'string' ? raw['branch'] : null,
          detached: raw['detached'] === true, git: raw['git'] as SessionEnvironment['git'],
          worktree: typeof raw['worktree'] === 'boolean' ? raw['worktree'] : null,
          homes: Object.fromEntries(Object.entries(infoRecord(raw['homes'])).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
        };
        if (!disposed && !controller.signal.aborted && snapshot.session === session) {
          publish({ ...snapshot, environment, environmentState: 'ready' });
        }
      } catch {
        if (!disposed && request === controller && snapshot.visible && snapshot.session === session) {
          publish({ ...snapshot, environment: null, environmentState: 'error' });
        }
      } finally {
        clearTimeout(deadline);
        if (request === controller) { request = null; loadedAt = Date.now(); }
      }
    })();
  };

  /* The plugin does not require these services, so reading `ctx.sidebarRight`
     or `ctx.remote.skills` throws "without inject"; only an injected scope can reach them. */
  let sidebar: SidebarRightPort | undefined;
  const sidebarService = ctx.inject(['sidebarRight'], scope => {
    sidebar = resolveSidebarRight(scope);
    return () => { sidebar = undefined; };
  });
  let skills: SkillCatalogRemote | undefined;
  const skillService = ctx.inject(['remote', 'remote.skills'], scope => {
    skills = (scope.remote as unknown as { skills: SkillCatalogRemote }).skills;
    return () => { skills = undefined; };
  });

  /** Run one navigation against the on-screen Session; the panel throws without one. */
  const navigate = (open: (sidebar: SidebarRightPort, session: SessionId) => void) => {
    if (sidebar === undefined || snapshot.session === null) return;
    try { open(sidebar, snapshot.session as SessionId); }
    catch (error) { console.error('[ccd] session card link failed:', error); }
  };
  const openFile = (path: string) => navigate((sidebar, session) => {
    sidebar.openResource(fileAddress(session, ctx.sessions.list.getSnapshot().byId[session]?.cwd, path));
  });

  const resize = new ResizeObserver(() => frames.schedule());
  const sync = () => {
    if (disposed) return;
    const found = [...document.querySelectorAll<HTMLElement>('[data-conversation-content][data-conversation-session][data-content-phase="active"]')]
      .find(node => node.closest(hostSelectors(document).conversationRoot) !== null && node.getBoundingClientRect().width > 0) ?? null;
    if (body !== found) {
      body?.removeAttribute(MARKER);
      resize.disconnect();
      body = found;
      if (body !== null) resize.observe(body);
    }
    const rect = body?.getBoundingClientRect();
    const session = body?.getAttribute('data-conversation-session') ?? null;
    // The host retains hidden rightbars for background sessions, including
    // their open/fullscreen state. Only this Session's visible panel counts.
    const panel = [...document.querySelectorAll<HTMLElement>('[data-sidebar-right-panel][data-sidebar-right-open]')]
      .find(node => node.getAttribute('data-sidebar-right-session') === session
        && node.closest('[hidden], [aria-hidden="true"]') === null) ?? null;
    const overlay = panel !== null;
    const visible = requested && !document.hidden && rect !== undefined && showSessionInfo(rect.width, rect.height, snapshot.visible, overlay)
      && panel?.getAttribute('data-sidebar-right-panel') !== 'fullscreen' && !document.querySelector('[data-ccd-pane-expanded]');
    if (visible) body?.setAttribute(MARKER, overlay ? 'overlay' : 'rail');
    else body?.removeAttribute(MARKER);
    const list = ctx.sessions.list.getSnapshot();
    const id = session as SessionId;
    const values = session === null ? undefined : list.projectionsBySession[id]?.values;
    const row = session === null ? undefined : list.byId[id];
    const workspace = session === null ? undefined : ctx.workspaces.list.getSnapshot().items.find(item => (item.sessionIds as readonly string[]).includes(session));
    const workingDirectory = infoRecord(values)['workingDirectory'];
    const cwd = typeof workingDirectory === 'string' && workingDirectory !== '' ? workingDirectory : row?.cwd ?? workspace?.path ?? '';
    const changed = snapshot.session !== session;
    const directoryChanged = snapshot.cwd !== cwd;
    if (changed || directoryChanged || !visible) {
      request?.abort(); request = null;
      if (changed || directoryChanged) { requestSession = null; loadedAt = 0; }
    }
    const next = {
      ...snapshot, session, visible, left: Math.round((rect?.right ?? 0) - RESERVE),
      top: Math.round(rect?.top ?? 0), height: Math.max(0, Math.floor(rect?.height ?? 0)),
      zh: document.documentElement.lang.toLowerCase().startsWith('zh'), workspace: workspace?.title ?? '', cwd,
      ...(values !== previousValues || changed ? { context: session === null ? null : projections?.read(session) ?? null, metrics: sessionMetrics(infoRecord(values)) } : {}),
      ...(changed || directoryChanged ? { environment: null, environmentState: 'loading' as const } : {}),
    };
    previousValues = values;
    if (Object.keys(next).some(key => next[key as keyof SessionInfoSnapshot] !== snapshot[key as keyof SessionInfoSnapshot])) publish(next);
    loadEnvironment();
  };
  const frames = frameScheduler(sync, document.defaultView);
  const schedule = () => frames.schedule();
  const observer = new MutationObserver(records => {
    if (recordsInTranscript(records)) return;
    if (records.some(record => !(record.target instanceof Element && record.target.closest('[data-ccd-session-cards]')))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-content-phase', 'data-conversation-session', 'data-sidebar-right-session', 'data-sidebar-right-panel', 'data-sidebar-right-open', 'data-ccd-pane-expanded', 'hidden', 'aria-hidden', 'style'] });
  const language = new MutationObserver(schedule);
  language.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  const offSessions = ctx.sessions.list.subscribe(schedule);
  const offWorkspaces = ctx.workspaces.list.subscribe(schedule);
  const timer = setInterval(() => loadEnvironment(), 30_000);
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('resize', schedule);
  window.addEventListener('focus', schedule);
  sync();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    toggle() {
      requested = !snapshot.visible;
      try { document.defaultView?.localStorage.setItem(OPEN_STORAGE, String(requested)); } catch { /* Retain the preference in memory. */ }
      sync();
    },
    retry: () => loadEnvironment(true),
    openFile,
    openSkill(name) {
      const session = snapshot.session as SessionId | null;
      const catalog = skills;
      if (session === null || catalog === undefined) return;
      void (async () => {
        try {
          const result = await ctx.sessions.using(session, { source: 'workspaceOperation' }, () => catalog.list({ sessionId: session }));
          if (!result.ok) throw new Error(result.error.message);
          let path: unknown = result.value.skills.find(skill => skill.name === name)?.path;
          /* `skills/list` drops the directory packaged skills such as the bundled Office set publish. */
          if (path === undefined) {
            const query = new URLSearchParams({ session, name });
            path = infoRecord(await (await fetch(`${SESSION_SKILL_PATH}?${query}`)).json().catch(() => null))['path'];
          }
          if (typeof path !== 'string') throw new Error(`Skill "${name}" has no file`);
          if (!disposed && snapshot.session === session) openFile(path);
        } catch (error) { console.error('[ccd] session card link failed:', error); }
      })();
    },
    openFilesView: () => navigate((sidebar, session) => {
      openView(sidebar, 'files', session);
      if (sidebar.isExpanded?.() === false) sidebar.toggleExpanded?.();
    }),
    dispose() {
      disposed = true;
      request?.abort(); request = null;
      void sidebarService.dispose();
      void skillService.dispose();
      clearInterval(timer); frames.cancel(); observer.disconnect(); language.disconnect(); resize.disconnect();
      offSessions(); offWorkspaces(); listeners.clear(); body?.removeAttribute(MARKER);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('resize', schedule); window.removeEventListener('focus', schedule);
    },
  };
}
