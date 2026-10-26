/**
 * Append the statistics card to the hero Composer stack and position it next
 * to the greeting. The observer recreates the container after phase changes.
 * Render when StatsSource supplies the first completed snapshot.
 */
import { localDayKey, sameStatsDisplay, type StatsRangeId, type StatsSnapshot } from '../../../shared/stats.ts';
import type { CleanupScope } from '../../core/cleanup.ts';
import type { Logger } from '../../contracts/ports.ts';
import { frameScheduler } from '../../compat/frame.ts';
import { hostSelectors } from '../../compat/host-dom.ts';
import { recordsIntroduce, recordsTouch } from '../../compat/mutation-scope.ts';
import { createStatsCard, type StatsCard } from './card.ts';
import type { StatsSource } from './source.ts';
import { buildCardData, INITIAL_STATS_VIEW, type StatsViewState } from './view.ts';

/**
 * The hero-phase conversation root. `data-phase` sits on the conversation root
 * itself (`[data-conversation-content]` is its inner body), so the anchor is
 * read on its own rather than combined with the content attribute.
 */
const HERO = '[data-phase="hero"]';

/** Distance kept between the greeting's lower edge and the card. */
const GAP_PX = 20;

/** Custom property carrying that measured offset; CSS falls back to the default. */
const GAP_PROPERTY = '--ccd-stats-gap';

/** One draw for the footer's book choice, fixed for the lifetime of a mount. */
function stableRandom(): () => number {
  const pick = Math.random();
  return () => pick;
}

/**
 * Keep one card mounted inside the hero stack.
 *
 * @param document - renderer document carrying the conversation page.
 * @param scope - cleanup scope owning the observer, the subscription and the card node.
 * @param logger - sink for observer failures; the native page stays without a card.
 * @param source - snapshot reader the card redraws from.
 */
export function mountStatisticsCard(
  document: Document,
  scope: CleanupScope,
  logger: Logger,
  source: StatsSource,
): void {
  const random = stableRandom();
  const selectors = hostSelectors(document);
  let snapshot: StatsSnapshot | null = source.current;
  let view: StatsViewState = INITIAL_STATS_VIEW;
  let rendered: { snapshot: StatsSnapshot; view: StatsViewState; day: string } | null = null;
  let hero: HTMLElement | null = null;
  let card: StatsCard | null = null;
  let host: HTMLElement | null = null;

  const remove = () => {
    card?.element.remove();
    card = null;
    host = null;
  };

  /* The greeting's height follows its type (and its language), so the offset is
     measured rather than frozen into the stylesheet: the card's `top` is the
     greeting's own top plus its height plus the gap. */
  const measure = () => {
    if (card === null) return;
    const greeting = document.querySelector<HTMLElement>(`${HERO} ${selectors.heroRoot}`);
    if (greeting !== null) card.element.style.setProperty(GAP_PROPERTY, `${greeting.offsetHeight + GAP_PX}px`);
    card.layout();
  };

  const sync = () => {
    hero = document.querySelector<HTMLElement>(HERO);
    const stack = hero?.querySelector<HTMLElement>(selectors.heroComposerStack) ?? null;
    source.setActive(stack !== null);
    if (stack === null || snapshot === null) {
      remove();
      return;
    }
    const now = Date.now(), day = localDayKey(now);
    if (rendered === null || !sameStatsDisplay(rendered.snapshot, snapshot) || rendered.view !== view || rendered.day !== day) {
      rendered = { snapshot, view, day };
      remove();
    }
    if (card !== null && card.element.isConnected && host === stack) {
      measure();
      return;
    }
    remove();
    card = createStatsCard(document, buildCardData(snapshot, view, random, new Date(now)), {
      onTab: tab => {
        /* Re-selecting the current view must not rebuild the card under the
           pointer that just clicked it. */
        if (tab === view.tab) return;
        view = { ...view, tab };
        sync();
      },
      onRange: (range: StatsRangeId) => {
        if (range === view.range) return;
        view = { ...view, range };
        sync();
      },
    });
    // Keep the card between the native greeting and input when the new-page
    // layout is disabled. Only our node moves; React retains its own children.
    const greeting = stack.querySelector<HTMLElement>(selectors.heroRoot);
    if (greeting?.parentElement === stack) greeting.after(card.element);
    else stack.prepend(card.element);
    host = stack;
    measure();
  };

  /* The card is a fixed 480px wide, so a resize only changes how many x-axis
     labels the chart can show. */
  const relayout = () => {
    card?.layout();
  };

  let observer: MutationObserver | undefined;
  /* One pass per paint: the transcript streams many batches between frames and
     the card only has to be connected when a frame is drawn. */
  const frames = frameScheduler(() => sync(), document.defaultView);
  /**
   * Whether a batch can move the card.
   *
   * Three things matter: the hero root the stack lives in, the greeting whose
   * height sets the card's offset, and the card itself (its own header controls
   * write inside it). A batch anywhere else — a streaming transcript on the
   * chat page, the right pane, the sidebar — cannot.
   */
  const relevant = (records: readonly MutationRecord[]): boolean => {
    if (records.some(record => record.type === 'attributes' && record.attributeName === 'data-phase')) return true;
    if (hero !== null && recordsTouch(records, hero)) return true;
    return recordsIntroduce(records, HERO);
  };
  try {
    observer = new MutationObserver(records => {
      if (relevant(records)) frames.schedule();
    });
    /* The phase swap replaces the whole conversation body, so the card has to
       follow it; a guarded insert keeps our own write from feeding the loop. */
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'] });
    sync();
  } catch (error) {
    frames.cancel();
    observer?.disconnect();
    source.setActive(false);
    remove();
    logger.error('statistics: card mount failed', error);
    return;
  }

  window.addEventListener('resize', relayout);
  const unsubscribe = source.subscribe(next => {
    snapshot = next;
    sync();
  });

  scope.add(() => {
    frames.cancel();
    window.removeEventListener('resize', relayout);
    observer?.disconnect();
    unsubscribe();
    source.setActive(false);
    remove();
  });
}
