import type { Disposer } from '../contracts/ports.ts';
import { frameScheduler } from './frame.ts';
import { ANCHOR, hostSelectors } from './host-dom.ts';
import { recordsTouch } from './mutation-scope.ts';

/** Marks that the transcript still has content above the scroll viewport. */
export const FADE_TOP_ATTRIBUTE = 'data-ccd-fade-top';

/** Marks that the transcript still has content below the scroll viewport. */
export const FADE_BOTTOM_ATTRIBUTE = 'data-ccd-fade-bottom';

/**
 * Custom property carrying how much of the scroll viewport the resident
 * Composer covers. The bottom fade has to end at the Composer's own top edge:
 * the scroller runs to the bottom of the window, so a stencil pinned to its
 * bottom edge would sit behind the Composer and fade nothing.
 */
export const FADE_BOTTOM_INSET_PROPERTY = '--ccd-fade-bottom-inset';

/**
 * Scroll slack that keeps sub-pixel ranges out. `scrollHeight` is fractional
 * on scaled displays, so an exact `0` test would leave a fade switched on at a
 * viewport that has already reached its tail.
 */
const EDGE_SLACK = 1;

export interface EdgeFadeState {
  readonly top: boolean;
  readonly bottom: boolean;
}

/**
 * Determine whether content extends past each edge of the scroll viewport.
 * The mount publishes those flags and the sticky Composer's top inset for
 * the page's gradient overlays; the Composer is a child of the scroll viewport.
 */
export function edgeFadeState(scrollTop: number, scrollHeight: number, clientHeight: number): EdgeFadeState {
  const range = scrollHeight - clientHeight;
  if (!Number.isFinite(range) || range <= EDGE_SLACK) return { top: false, bottom: false };
  return { top: scrollTop > EDGE_SLACK, bottom: scrollTop < range - EDGE_SLACK };
}

/**
 * Keeps the transcript's edge-fade attributes in step with its scroll state.
 *
 * The scroller is a session-scoped element, so the module re-resolves it from
 * the document and moves its own listener across element swaps. Content growth
 * (streaming), column drags and window resizes all change the answer, so the
 * observer watches the same three signals the host's own view does — DOM
 * mutations, inline framework geometry and the window — rather than animation
 * frames, which an occluded window throttles.
 *
 * @param document - renderer document carrying the Conversation page.
 * @param report - sink for observer failures; the transcript stays usable.
 * @returns disposer that disconnects every observer and clears both attributes.
 */
export function mountConversationFade(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  let scroller: HTMLElement | null = null;
  let page: HTMLElement | null = null;

  const paint = () => {
    if (scroller === null || !scroller.isConnected) return;
    const state = edgeFadeState(scroller.scrollTop, scroller.scrollHeight, scroller.clientHeight);
    toggle(scroller, FADE_TOP_ATTRIBUTE, state.top);
    toggle(scroller, FADE_BOTTOM_ATTRIBUTE, state.bottom);
    /* The Composer is a child of the scroller, so nothing may be masked here
       without masking it too: the stylesheet paints the stencil as two overlays
       on the page body, and the body's own `::after` reads this property. */
    const next = document.querySelector<HTMLElement>(host.conversationBody);
    if (next !== page) {
      if (page !== null) page.style.removeProperty(FADE_BOTTOM_INSET_PROPERTY);
      page = next;
    }
    if (page !== null) publishInset(page, composerInset(scroller, document));
  };

  const sync = () => {
    const next = document.querySelector<HTMLElement>(ANCHOR.conversationScroll);
    if (next !== scroller) {
      if (scroller !== null) {
        scroller.removeEventListener('scroll', schedule);
        clear(scroller);
      }
      scroller = next;
      if (scroller !== null) scroller.addEventListener('scroll', schedule, { passive: true });
    }
    paint();
  };

  /* The transcript streams many mutation batches between two paints; the fade
     is a paint-time fact, so one pass per frame is all it can show. A throttled
     window falls back to a timeout inside the scheduler. */
  const frames = frameScheduler(sync, document.defaultView);
  const schedule = () => frames.schedule();

  /* A batch that wrote outside this page cannot move the transcript's edges:
     the right pane's own drags, another plugin's markup and the sidebar's
     counters all arrive here, and each one would otherwise cost a scroll-geometry
     read. The scroller and the page body are the two boxes the pass measures, so
     a write on either (or an ancestor of either) is the batch's only claim. */
  const relevant = (records: readonly MutationRecord[]): boolean =>
    recordsTouch(records, scroller) || recordsTouch(records, page);

  let observer: MutationObserver | undefined;
  try {
    observer = new MutationObserver(records => {
      if (relevant(records)) schedule();
    });
    /* The transcript grows through inserted nodes and streamed text; a column
       drag writes inline grid tracks; the scroller itself is rebuilt per
       Session. Both attributes this module writes are outside the filter, so
       its own updates cannot re-enter the observer. The inset is inline style
       on the page body, so one extra pass settles it. */
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'style'],
    });
    window.addEventListener('resize', schedule);
    sync();
  } catch (error) {
    frames.cancel();
    observer?.disconnect();
    window.removeEventListener('resize', schedule);
    report(error);
    return () => {};
  }

  return () => {
    frames.cancel();
    observer?.disconnect();
    window.removeEventListener('resize', schedule);
    if (scroller !== null) {
      scroller.removeEventListener('scroll', schedule);
      clear(scroller);
    }
    page?.style.removeProperty(FADE_BOTTOM_INSET_PROPERTY);
    scroller = null;
    page = null;
  };
}

/** Attribute presence is the whole signal; an empty value keeps it readable. */
function toggle(element: HTMLElement, attribute: string, on: boolean): void {
  if (on === element.hasAttribute(attribute)) return;
  if (on) element.setAttribute(attribute, '');
  else element.removeAttribute(attribute);
}

/**
 * How much of the scroller's viewport the Composer's seat covers.
 *
 * The seat is a sticky, in-flow child of the scroller that pins itself to the
 * viewport's bottom while the transcript is scrolled, so it is the line where
 * content actually leaves the page — not the scroller's own bottom edge, which
 * runs to the window edge underneath it. A seat that has not been reached yet
 * (a short transcript, the blank Session) reports no inset.
 */
function composerInset(scroller: HTMLElement, document: Document): number {
  const seat = document.querySelector<HTMLElement>(ANCHOR.composerSeat);
  if (seat === null) return 0;
  const covered = scroller.getBoundingClientRect().bottom - seat.getBoundingClientRect().top;
  if (!Number.isFinite(covered) || covered <= 0) return 0;
  return Math.min(Math.round(covered * 2) / 2, scroller.clientHeight);
}

function publishInset(page: HTMLElement, inset: number): void {
  const value = inset <= 0 ? '' : `${inset}px`;
  if (page.style.getPropertyValue(FADE_BOTTOM_INSET_PROPERTY) === value) return;
  if (value === '') page.style.removeProperty(FADE_BOTTOM_INSET_PROPERTY);
  else page.style.setProperty(FADE_BOTTOM_INSET_PROPERTY, value);
}

function clear(scroller: HTMLElement): void {
  scroller.removeAttribute(FADE_TOP_ATTRIBUTE);
  scroller.removeAttribute(FADE_BOTTOM_ATTRIBUTE);
}
