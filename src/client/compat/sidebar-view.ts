import type { Context } from '@deepseek-ai/cordis';
import type { SidebarRightPort, SidebarRightTabsPort } from '../contracts/ports.ts';

/** Read the cross-plugin right-Sidebar face, or nothing when this build lacks it. */
export function resolveSidebarRight(scope: Context): SidebarRightPort | undefined {
  const service = (scope as Context & { sidebarRight?: SidebarRightPort }).sidebarRight;
  if (typeof service?.openTab !== 'function' || typeof service.focus !== 'function') return undefined;
  return service;
}

/** Read the tab-type registry that decides which views exist in this build. */
export function resolveSidebarTabs(scope: Context): SidebarRightTabsPort | undefined {
  const registry = (scope as Context & { sidebarRightTabs?: SidebarRightTabsPort }).sidebarRightTabs;
  return typeof registry?.get === 'function' ? registry : undefined;
}

/**
 * Address one file the way the Files tree does, so both share a preview tab.
 *
 * Restates `fileAddressFor` from `dsh-util-workspace-path`, which is not part
 * of this plugin's runtime baseline: a path inside the Session's root becomes
 * relative, any other keeps its leading slash, and the host owns resolution.
 *
 * @param sessionId - Session authorizing the read.
 * @param root - that Session's root, when known.
 * @param path - absolute or root-relative path, in either separator spelling.
 */
export function fileAddress(sessionId: string, root: string | undefined, path: string): string {
  const encode = (value: string) => encodeURIComponent(value).replace(/%3A/giu, ':');
  const normalized = path.replaceAll('\\', '/');
  const base = root?.replaceAll('\\', '/').replace(/\/+$/u, '') ?? '';
  const inside = base !== '' && normalized.startsWith(`${base}/`);
  const relative = inside ? normalized.slice(base.length + 1) : normalized.replace(/^(?:\.\/)+/u, '');
  return `dsh-resource://file/session/${encode(sessionId)}/${relative.split('/').map(encode).join('/')}`;
}

/**
 * Focus the Session's existing view of this kind, or open a new one.
 *
 * `openTab` places a page at the address the panel records pages under, which
 * would front an already-open view for kinds that allow one instance; the
 * inventory snapshot lets the header focus that tab instead of stacking a
 * second one. Terminal views may legitimately be multiple, so the first match
 * wins — the panel's own guide still offers a new one. A build whose face does
 * not carry the inventory falls back to plain `openTab`.
 *
 * @param sidebar - the right-Sidebar face.
 * @param kind - page type to reveal.
 * @param sessionId - Session whose header was clicked.
 */
export function openView(sidebar: SidebarRightPort, kind: string, sessionId: string): void {
  const tabs = typeof sidebar.openTabs?.getSnapshot === 'function' ? sidebar.openTabs.getSnapshot() : [];
  const existing = tabs.find(tab => tab.sessionId === sessionId && tab.kind === kind);
  if (existing === undefined) sidebar.openTab(kind);
  else sidebar.focus(existing.tabId);
}
