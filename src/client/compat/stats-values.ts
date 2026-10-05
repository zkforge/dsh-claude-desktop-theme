import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

/** Short readout mirrored from native text for wide columns only. */
export const STAT_VALUE_PROPERTY = '--ccd-stat-value';

/** Custom property carrying the width of the Composer's trailing control group. */
export const TRAILING_WIDTH_PROPERTY = '--ccd-trailing-width';

/** Remaining model-button space after leading controls, statistics and gaps. */
export const MODEL_MAX_WIDTH_PROPERTY = '--ccd-model-max-width';

/** The one gap the trailing cluster uses, read to budget the model button. */
export const CLUSTER_GAP_PROPERTY = '--ccd-cluster-gap';

/**
 * Root attribute carrying whether the readouts are drawn, whose values are
 * `on` and `off`.
 *
 * Both states are published rather than only the off one: the stylesheet that
 * hides the cluster keys on `off`, so a document where this module never ran —
 * a frame the observers could not attach to — keeps the host's own readouts
 * instead of losing them to a stylesheet default it cannot correct.
 */
export const STATS_ATTRIBUTE = 'data-ccd-composer-stats';

/**
 * The responsive statistics cluster sits before the model selector. Its dock is
 * a sibling of the card rather than a row child, so its wide-layout offset needs
 * the trailing group's live width. Readouts and their detail dialogs stay owned
 * by the host; wide columns mirror one short segment without changing the host label.
 *
 * The cluster is the configuration's to keep or drop (`features.composer-stats`,
 * off by default): its state is published on the root for the stylesheet, which
 * draws it only while the readouts are on. The width measurements below are
 * outside that switch — they budget the row whether or not the readouts are
 * drawn, and a hidden cluster simply hands its width back to the model button.
 *
 * @param document - renderer document carrying the Composer.
 * @param report - sink for observer failures; the native readouts stay.
 * @param readouts - whether the configuration asks for the plugin's readouts.
 * @returns disposer that disconnects the observers and clears every property.
 */
export function mountComposerStats(
  document: Document,
  report: (error: unknown) => void,
  readouts: boolean,
): Disposer {
  const host = hostSelectors(document);
  let scheduled = 0;
  let trailing: HTMLElement | null = null;
  let root: HTMLElement | null = null;

  const sync = () => {
    scheduled = 0;
    if (readouts) {
      for (const pill of document.querySelectorAll<HTMLElement>(host.statsPill)) {
        const parts = (pill.querySelector(host.statsLabel)?.textContent ?? '')
          .split('·').map(part => part.trim()).filter(Boolean);
        /* The speed readout carries a slash; the usage pill's second segment is
           the cache-hit share the host already prints next to its total
           ("117M tok · 缓存命中 95%"). Mirror the cache hit rather than the
           session total, and fall back to the first segment when the host has no
           billed input to compute a share from. */
        const value = parts.find(part => part.includes('/')) ?? parts.find(part => part.includes('%')) ?? parts[0] ?? '';
        const quoted = value === '' ? '' : JSON.stringify(value);
        if (pill.style.getPropertyValue(STAT_VALUE_PROPERTY) !== quoted) {
          if (quoted === '') pill.style.removeProperty(STAT_VALUE_PROPERTY);
          else pill.style.setProperty(STAT_VALUE_PROPERTY, quoted);
        }
      }
    }
    /* The last measurement is kept across element swaps: the Composer is rebuilt
       when the page changes phase, and clearing the property there would drop the
       statistics cluster back onto the model selector for a frame. */
    const nextRoot = document.querySelector<HTMLElement>(host.composerRoot);
    if (nextRoot !== null) root = nextRoot;
    const nextTrailing = document.querySelector<HTMLElement>(`${host.composerRow} ${host.composerTrailing}`);
    if (nextTrailing !== null) trailing = nextTrailing;
    if (root !== null && trailing !== null && trailing.isConnected) {
      const width = `${Math.round(trailing.getBoundingClientRect().width)}px`;
      if (root.style.getPropertyValue(TRAILING_WIDTH_PROPERTY) !== width) {
        root.style.setProperty(TRAILING_WIDTH_PROPERTY, width);
      }
      const row = document.querySelector<HTMLElement>(host.composerRow);
      const dock = root.querySelector<HTMLElement>(host.composerDock);
      const model = trailing.querySelector<HTMLElement>(host.modelSelectTrigger);
      if (row !== null && dock !== null && model !== null) {
        const style = getComputedStyle(row);
        const available = row.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const leading = Array.from(row.children).filter(child => child !== trailing)
          .map(child => child.getBoundingClientRect().width).filter(width => width > 0);
        const extras = Math.max(0, trailing.getBoundingClientRect().width - model.getBoundingClientRect().width);
        const dockWidth = dock.getBoundingClientRect().width;
        const dockGap = dockWidth > 0 ? parseFloat(getComputedStyle(root).getPropertyValue(CLUSTER_GAP_PROPERTY)) : 0;
        const room = Math.max(0, Math.floor(available - leading.reduce((sum, width) => sum + width, 0)
          - leading.length * parseFloat(style.columnGap) - extras - dockWidth - dockGap));
        const maxWidth = `${room}px`;
        if (root.style.getPropertyValue(MODEL_MAX_WIDTH_PROPERTY) !== maxWidth) {
          root.style.setProperty(MODEL_MAX_WIDTH_PROPERTY, maxWidth);
        }
      }
    }
  };

  /* Straight from the observer: an occluded window throttles animation frames,
     and these values have to be right when the frame is finally painted. */
  const schedule = () => {
    if (scheduled !== 0) return;
    scheduled = 1;
    try {
      sync();
    } finally {
      scheduled = 0;
    }
  };

  let observer: MutationObserver | undefined;
  /* The readout state is a document-wide fact — the host renders the cluster on
     both pages that carry a Composer — and the value is kept so teardown hands
     back whatever the root carried before, like `compat/dom.ts` does for the
     activation gate. */
  const html = document.documentElement;
  const state = readouts ? 'on' : 'off';
  const previous = html.getAttribute(STATS_ATTRIBUTE);
  try {
    observer = new MutationObserver(schedule);
    /* Dragging a panel changes the frame's inline grid tracks, not the window
       size. Native model collapse can also change after a layout pass. Watch
       both; guarded property writes prevent our own styles feeding a loop. */
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['style', 'class', 'data-model-compact'],
    });
    window.addEventListener('resize', schedule);
    /* Published once the observers are live: a run that cannot observe is a run
       that must not take the host's readouts out of the row. */
    html.setAttribute(STATS_ATTRIBUTE, state);
    sync();
  } catch (error) {
    observer?.disconnect();
    window.removeEventListener('resize', schedule);
    report(error);
    return () => {};
  }

  return () => {
    scheduled = 0;
    observer?.disconnect();
    window.removeEventListener('resize', schedule);
    root?.style.removeProperty(TRAILING_WIDTH_PROPERTY);
    root?.style.removeProperty(MODEL_MAX_WIDTH_PROPERTY);
    for (const pill of document.querySelectorAll<HTMLElement>(host.statsPill)) {
      pill.style.removeProperty(STAT_VALUE_PROPERTY);
    }
    if (html.getAttribute(STATS_ATTRIBUTE) === state) {
      if (previous === null) html.removeAttribute(STATS_ATTRIBUTE);
      else html.setAttribute(STATS_ATTRIBUTE, previous);
    }
    root = null;
    trailing = null;
  };
}
