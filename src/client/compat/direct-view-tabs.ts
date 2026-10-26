import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

const SOURCE = 'data-ccd-view-more-source';
const PROXY = 'data-ccd-direct-trajectory';
const OPENING = 'data-ccd-direct-view-opening';
const isTrajectory = (value: string) => value === '轨迹' || value === 'Trajectory';

/** Hide only the native overflow launcher. If the host folds Trajectory, add
 * a direct button that delegates to its native menu action on explicit click.
 * The header, its slot registrations, stores and summary styles stay native. */
export function mountDirectViewTabs(document: Document, report: (error: unknown) => void): Disposer {
  const selectors = hostSelectors(document);
  const states = new Map<HTMLElement, { source: HTMLElement; button: HTMLButtonElement | null }>();
  let pending: HTMLButtonElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued = false;
  let disposed = false;
  const finish = (close = true) => {
    const trigger = pending;
    pending = null;
    clearTimeout(timer);
    document.documentElement.removeAttribute(OPENING);
    if (close && trigger?.isConnected && trigger.getAttribute('aria-expanded') === 'true') trigger.click();
  };
  const openTrajectory = (trigger: HTMLButtonElement) => {
    finish();
    pending = trigger;
    document.documentElement.setAttribute(OPENING, '');
    if (trigger.getAttribute('aria-expanded') !== 'true') trigger.click();
    timer = setTimeout(finish, 1200);
    schedule();
  };
  const sync = () => {
    queued = false;
    if (disposed) return;
    try {
      if (pending) {
        const menu = document.querySelector<HTMLElement>('[class*="_viewsMoreMenu"]');
        if (menu) {
          const action = [...menu.querySelectorAll<HTMLElement>('button, [role="menuitem"]')]
            .find(row => isTrajectory(row.textContent?.trim() ?? ''));
          action?.click();
          finish(action === undefined);
        }
      }
      for (const [root, state] of states) if (!root.isConnected) {
        state.source.removeAttribute(SOURCE); state.button?.remove(); states.delete(root);
      }
      for (const root of document.querySelectorAll<HTMLElement>(selectors.conversationTabs)) {
        const trigger = root.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
        if (!trigger) continue;
        let source: HTMLElement = trigger;
        while (source.parentElement && source.parentElement !== root) source = source.parentElement;
        if (!source.hasAttribute(SOURCE)) source.setAttribute(SOURCE, '');
        let state = states.get(root);
        if (!state) { state = { source, button: null }; states.set(root, state); }
        else if (state.source !== source) { state.source.removeAttribute(SOURCE); state.source = source; }
        const nativeTabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter(tab => !tab.hasAttribute(PROXY));
        if (nativeTabs.some(tab => isTrajectory(tab.getAttribute('aria-label') ?? tab.textContent?.trim() ?? ''))) {
          state.button?.remove(); state.button = null; continue;
        }
        const chat = nativeTabs.find(tab => ['对话', 'Chat'].includes(tab.getAttribute('aria-label') ?? tab.textContent?.trim() ?? ''));
        if (!chat) continue;
        const label = (chat.getAttribute('aria-label') ?? chat.textContent?.trim()) === 'Chat' ? 'Trajectory' : '轨迹';
        if (!state.button) {
          const button = document.createElement('button');
          button.type = 'button'; button.setAttribute('role', 'tab'); button.setAttribute(PROXY, '');
          button.textContent = label;
          button.addEventListener('click', () => {
            const current = root.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
            if (current) openTrajectory(current);
          });
          state.button = button;
        }
        const button = state.button;
        const active = trigger.getAttribute('aria-label')?.includes(label) === true && chat.getAttribute('aria-selected') !== 'true';
        const selected = String(active);
        const className = selectors.conversationTab.slice(1) + (active ? ` ${selectors.conversationTabActive.slice(1)}` : '');
        if (button.className !== className) button.className = className;
        if (button.getAttribute('aria-selected') !== selected) button.setAttribute('aria-selected', selected);
        const tablist = root.querySelector('[role="tablist"]') ?? root;
        if (button.parentElement !== tablist) tablist.append(button);
      }
    } catch (error) { finish(); report(error); }
  };
  const schedule = () => {
    if (queued || disposed) return;
    queued = true; queueMicrotask(sync);
  };
  const observer = new MutationObserver(records => {
    if (pending || records.some(record => {
      const element = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
      return element?.closest(selectors.conversationTabs) || [...record.addedNodes].some(node => node.nodeType === 1
        && ((node as Element).matches(selectors.conversationTabs) || (node as Element).querySelector(selectors.conversationTabs)));
    }) || [...states.keys()].some(root => !root.isConnected)) schedule();
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['aria-label', 'aria-selected', 'aria-expanded', 'class'] });
  sync();
  return () => {
    disposed = true; observer.disconnect(); finish();
    for (const state of states.values()) { state.source.removeAttribute(SOURCE); state.button?.remove(); }
    states.clear();
  };
}
