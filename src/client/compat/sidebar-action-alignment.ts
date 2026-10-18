import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { frameScheduler } from './frame.ts';
import { recordsIntroduce, recordsTouch } from './mutation-scope.ts';

/** Share the tree's actual trailing edge, including its native scrollbar gutter. */
export function mountSidebarActionAlignment(document: Document): Disposer {
  const host = hostSelectors(document);
  const originals = new Map<HTMLElement, string>();
  const resize = new ResizeObserver(() => frames.schedule());
  const watched = new Set<Element>();
  let sidebars: HTMLElement[] = [];
  const sync = (): void => {
    sidebars = [...document.querySelectorAll<HTMLElement>(host.sidebarRoot)];
    const live = new Set<Element>();
    const updates: { header: HTMLElement; value: string }[] = [];
    for (const sidebar of sidebars) {
      const header = sidebar.querySelector<HTMLElement>(host.browserSectionHeader);
      const row = sidebar.querySelector<HTMLElement>(host.workspaceRow);
      if (header === null || row === null) continue;
      if (!originals.has(header)) originals.set(header, header.style.paddingRight);
      for (const element of [header, row]) {
        live.add(element);
        if (!watched.has(element)) { watched.add(element); resize.observe(element); }
      }
      const headerBox = header.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      if (headerBox.width === 0 || rowBox.width === 0) continue;
      const inset = Math.max(0, headerBox.right - rowBox.right);
      const value = `${inset}px`;
      updates.push({ header, value });
    }
    // Complete all layout reads before changing any header's geometry.
    for (const { header, value } of updates) {
      if (header.style.paddingRight !== value) header.style.paddingRight = value;
    }
    for (const element of watched) {
      if (!live.has(element)) { resize.unobserve(element); watched.delete(element); }
    }
    for (const [header, original] of originals) {
      if (!live.has(header)) { header.style.paddingRight = original; originals.delete(header); }
    }
  };
  const frames = frameScheduler(sync, document.defaultView);
  const mutations = new MutationObserver(records => {
    if (sidebars.some(sidebar => recordsTouch(records, sidebar))
      || recordsIntroduce(records, host.sidebarRoot)) frames.schedule();
  });
  mutations.observe(document.documentElement, { childList: true, subtree: true });
  sync();
  return () => {
    frames.cancel(); mutations.disconnect(); resize.disconnect();
    for (const [header, original] of originals) header.style.paddingRight = original;
    originals.clear(); watched.clear(); sidebars = [];
  };
}
