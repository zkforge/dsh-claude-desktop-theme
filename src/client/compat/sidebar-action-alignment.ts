import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

/** Share the tree's actual trailing edge, including its native scrollbar gutter. */
export function mountSidebarActionAlignment(document: Document): Disposer {
  const host = hostSelectors(document);
  const originals = new Map<HTMLElement, string>();
  const resize = new ResizeObserver(() => sync());
  const watched = new Set<Element>();
  const sync = (): void => {
    for (const sidebar of document.querySelectorAll<HTMLElement>(host.sidebarRoot)) {
      const header = sidebar.querySelector<HTMLElement>(host.browserSectionHeader);
      const row = sidebar.querySelector<HTMLElement>(host.workspaceRow);
      if (header === null || row === null) continue;
      if (!originals.has(header)) originals.set(header, header.style.paddingRight);
      for (const element of [header, row]) {
        if (!watched.has(element)) { watched.add(element); resize.observe(element); }
      }
      if (header.getBoundingClientRect().width === 0 || row.getBoundingClientRect().width === 0) continue;
      const inset = Math.max(0, header.getBoundingClientRect().right - row.getBoundingClientRect().right);
      const value = `${inset}px`;
      if (header.style.paddingRight !== value) header.style.paddingRight = value;
    }
    for (const element of watched) {
      if (!element.isConnected) { resize.unobserve(element); watched.delete(element); }
    }
    for (const [header, original] of originals) {
      if (!header.isConnected) { header.style.paddingRight = original; originals.delete(header); }
    }
  };
  const mutations = new MutationObserver(sync);
  mutations.observe(document.documentElement, { childList: true, subtree: true });
  sync();
  return () => {
    mutations.disconnect(); resize.disconnect();
    for (const [header, original] of originals) header.style.paddingRight = original;
  };
}
