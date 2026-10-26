import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { ContextProjectionPort } from '../contracts/ports.ts';
import type { SessionInfoPort, SessionInfoSnapshot } from '../contracts/session-info.ts';
import {
  SESSION_ENVIRONMENT_PATH, infoRecord, sessionMetrics, showSessionInfo, type SessionEnvironment,
} from '../../shared/session-info.ts';
import { frameScheduler } from './frame.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsInTranscript } from './mutation-scope.ts';

const MARKER = 'data-ccd-session-info';
const RESERVE = 280;
const OPEN_STORAGE = 'ccd-session-info-open';

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
    const overlay = document.querySelector('[data-sidebar-right-panel][data-sidebar-right-open]') !== null;
    const visible = requested && !document.hidden && rect !== undefined && showSessionInfo(rect.width, rect.height, snapshot.visible, overlay)
      && !document.querySelector('[data-sidebar-right-panel="fullscreen"][data-sidebar-right-open], [data-ccd-pane-expanded]');
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
    attributeFilter: ['data-content-phase', 'data-conversation-session', 'data-sidebar-right-panel', 'data-sidebar-right-open', 'data-ccd-pane-expanded', 'hidden', 'style'] });
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
    dispose() {
      disposed = true;
      request?.abort(); request = null;
      clearInterval(timer); frames.cancel(); observer.disconnect(); language.disconnect(); resize.disconnect();
      offSessions(); offWorkspaces(); listeners.clear(); body?.removeAttribute(MARKER);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('resize', schedule); window.removeEventListener('focus', schedule);
    },
  };
}
