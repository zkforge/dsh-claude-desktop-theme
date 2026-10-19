import type { Disposer } from '../contracts/ports.ts';
import { ANCHOR, hostSelectors } from './host-dom.ts';

/**
 * The window's scrollbars: thin, dark, and there only while something moves
 * (DESIGN.md §三).
 *
 * Two mechanisms, one look.
 *
 * **The ink.** Every scroller inside `theme/scrollbars.css`'s scope keeps the
 * host's own track, thumb box and navigation, and this module publishes the
 * moment one is moving as {@link SCROLLING_ATTRIBUTE}; the sheet keeps the ink
 * switched off until it sees that attribute, so no surface in the window
 * carries a bar at rest. A listener on the document's capture phase sees every
 * element scroll in one place — scroll events do not bubble, but they do travel
 * down — and clears the mark again once the surface has been still for
 * {@link IDLE_MS}.
 *
 * **The pill.** The five page-level surfaces — the Conversation page, the
 * transcript column, the sidebar's tree, the Files pane and the agent-team panel
 * — go one step further and keep no ink at all: {@link PILL_SURFACE_ATTRIBUTE}
 * takes their track's thumb out of the painting, and a floating pill
 * ({@link PILL_ATTRIBUTE}, all of them in one fixed layer) follows the scroll
 * position instead. That pill is the short capsule the reference draws. The
 * painted thumb cannot be it: its length is the content's share of the track, so
 * a surface that only just overflows — a short conversation, a panel with one
 * page of content — paints a bar the height of its own viewport. The pill is
 * capped at {@link PILL_MAX} instead, and never shorter than {@link PILL_MIN}.
 *
 * The pill is centred on the painted thumb it stands in for, and sits inside the
 * track's own strip at the edge, so it is where the pointer expects: the host's
 * thumb — invisible, but still laid out and still the thing that drags — is
 * directly underneath it, and a drag that starts anywhere on the pill grabs
 * that bar.
 *
 * Everything here is written on elements the host owns, so the disposer puts
 * each mark back: attributes off, layer gone, listeners removed.
 */

/** Marks a surface whose bar is the floating pill rather than the track's ink. */
export const PILL_SURFACE_ATTRIBUTE = 'data-ccd-scroll-pill';

/** Marks a surface in motion — and, on a pill, the pill that belongs to it. */
export const SCROLLING_ATTRIBUTE = 'data-ccd-scrolling';

/** The one fixed layer every pill is painted in. */
export const PILL_LAYER_ATTRIBUTE = 'data-ccd-scroll-layer';

/** Identifies one floating pill. */
export const PILL_ATTRIBUTE = 'data-ccd-scroll-thumb';

/**
 * How long a mark survives after the last scroll event. The reference's own
 * overlay scroller fades out about this long after the wheel stops; long enough
 * to read the position between two flicks, short enough that a resting window
 * carries no ink.
 */
export const IDLE_MS = 800;

/** Leave enough time to move from the model rows onto their scrollbar. */
const MODEL_IDLE_MS = 2200;

/** The pill's longest and shortest length, in CSS pixels. */
const PILL_MAX = 96;
const PILL_MIN = 36;

/**
 * The pill's own box: 4px of ink, one pixel in from the scroller's edge, which
 * keeps it inside the host's 5px track — the strip the pointer has to be on for
 * a drag to reach the scrollbar under it.
 */
const PILL_WIDTH = 4;
const PILL_INSET = 1;

/**
 * Slack on the scroll range. `scrollHeight` is fractional on scaled displays,
 * so an exact `0` test would leave a pill on a surface that has nothing to
 * scroll.
 */
const OVERFLOW_SLACK = 1;

interface Pill {
  readonly surface: HTMLElement;
  readonly element: HTMLElement;
  /** The surface's own listener, kept so release can remove exactly this one. */
  readonly onScroll: () => void;
  timer: number;
}

/**
 * The element behind one scroll event, or null when there is none.
 * @param target - the event's target: an element, or the document itself for
 * the page's own scroll.
 * @returns the element to mark, when it can carry an attribute.
 */
function asScroller(target: EventTarget | null): HTMLElement | null {
  const candidate = target as Partial<HTMLElement> | null;
  if (candidate === null || typeof candidate !== 'object') return null;
  return typeof candidate.setAttribute === 'function' && typeof candidate.removeAttribute === 'function'
    ? candidate as HTMLElement
    : null;
}

/**
 * The surfaces the pill replaces the ink on. All five are page-level chrome the
 * reader scrolls by the screenful; the host's popup cards and this plugin's own
 * panels keep the painted bar (it appears while they scroll, like every other
 * surface in the sheet's scope), because they are short-lived and their tracks
 * are narrower.
 * @param document - renderer document carrying the interface.
 * @returns the selectors, resolved for the build on screen.
 */
export function pillSurfaces(document: Document): readonly string[] {
  const host = hostSelectors(document);
  return [
    ANCHOR.conversationScroll,
    host.chatViewScroll,
    host.browserList,
    host.filesBody,
    host.teamBody,
  ];
}

/**
 * Follow the interface's five page-level scrollers with a floating pill each,
 * and mark every other scroller while it moves.
 *
 * @param document - renderer document carrying the interface.
 * @param report - sink for observer failures; the host's own bars stay usable.
 * @returns disposer that removes every pill, mark and listener.
 */
export function mountScrollPills(document: Document, report: (error: unknown) => void): Disposer {
  const layer = document.createElement('div');
  layer.setAttribute(PILL_LAYER_ATTRIBUTE, '');
  document.body.append(layer);
  const pills = new Map<HTMLElement, Pill>();
  const marks = new Map<HTMLElement, number>();

  /* One listener for every surface the sheet paints: scroll events do not
     bubble, but a capture listener on the document still sees each of them, so
     the mark costs one listener rather than one per scroller — including the
     ones that only exist while a message is on screen. The attribute is inert
     outside the sheet's scope: nothing else in the document reads it. */
  const onScroll = (event: Event) => {
    /* Every element scroll in the document arrives here, and the page's own
       scroll reports the document as its target. The test is the host's own
       `instanceof HTMLElement` written structurally: a node from another realm
       (a plugin's own iframe) answers to it too. */
    const surface = asScroller(event.target);
    if (surface === null) return;
    /* A pill surface paints no ink, so its mark would only be dead weight — and
       the sheet's reveal rule reads the mark. */
    if (surface.hasAttribute(PILL_SURFACE_ATTRIBUTE)) return;
    surface.setAttribute(SCROLLING_ATTRIBUTE, '');
    const pending = marks.get(surface);
    if (pending !== undefined) window.clearTimeout(pending);
    marks.set(surface, window.setTimeout(() => {
      marks.delete(surface);
      surface.removeAttribute(SCROLLING_ATTRIBUTE);
    }, surface.classList?.contains('ccd-model-options') ? MODEL_IDLE_MS : IDLE_MS));
  };

  /** Put one pill where its surface's own thumb is, or take it away. */
  const place = (pill: Pill) => {
    const surface = pill.surface;
    if (!surface.isConnected) return;
    const track = surface.clientHeight;
    const content = surface.scrollHeight;
    const range = content - track;
    if (track <= 0 || range <= OVERFLOW_SLACK) {
      pill.element.style.display = 'none';
      return;
    }
    const box = surface.getBoundingClientRect();
    const thumb = (track / content) * track;
    const length = Math.min(PILL_MAX, Math.max(PILL_MIN, thumb));
    const centre = (surface.scrollTop / range) * (track - thumb) + thumb / 2;
    const top = Math.min(Math.max(centre - length / 2, 0), track - length);
    pill.element.style.display = '';
    pill.element.style.height = `${length}px`;
    pill.element.style.transform =
      `translate(${box.right - PILL_INSET - PILL_WIDTH}px, ${box.top + top}px)`;
  };

  /** Show one pill, and arm the fade that takes it away again. */
  const awaken = (pill: Pill) => {
    pill.element.setAttribute(SCROLLING_ATTRIBUTE, '');
    if (pill.timer !== 0) window.clearTimeout(pill.timer);
    pill.timer = window.setTimeout(() => {
      pill.timer = 0;
      pill.element.removeAttribute(SCROLLING_ATTRIBUTE);
    }, IDLE_MS);
  };

  const adopt = (surface: HTMLElement) => {
    const element = document.createElement('div');
    element.setAttribute(PILL_ATTRIBUTE, '');
    element.style.display = 'none';
    layer.append(element);
    const pill: Pill = {
      surface,
      element,
      onScroll: () => {
        place(pill);
        awaken(pill);
      },
      timer: 0,
    };
    surface.setAttribute(PILL_SURFACE_ATTRIBUTE, '');
    surface.addEventListener('scroll', pill.onScroll, { passive: true });
    pills.set(surface, pill);
    place(pill);
  };

  const release = (pill: Pill) => {
    /* The listener is the surface's, not this closure's: a mount that is
       released and then adopted again would otherwise leave the old handler
       running against a removed pill, once per past mount. */
    pill.surface.removeEventListener('scroll', pill.onScroll);
    if (pill.timer !== 0) window.clearTimeout(pill.timer);
    pill.surface.removeAttribute(PILL_SURFACE_ATTRIBUTE);
    pill.element.remove();
    pills.delete(pill.surface);
  };

  const sync = () => {
    /* A Session switch rebuilds the scrollers, and every panel's own body
       arrives and leaves with its pane: both sides of the map move. */
    for (const pill of [...pills.values()]) {
      if (!pill.surface.isConnected) release(pill);
    }
    for (const selector of pillSurfaces(document)) {
      for (const surface of document.querySelectorAll<HTMLElement>(selector)) {
        if (!pills.has(surface)) adopt(surface);
      }
    }
    for (const pill of pills.values()) place(pill);
  };

  let observer: MutationObserver | undefined;
  const onResize = () => sync();
  try {
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize);
    /* Content growth moves the pill without a scroll event — a Session row
       arriving in the tree, an image settling in the transcript. Character data
       is deliberately outside the net: streaming text grows the transcript on
       every token, and that surface is scrolling while it does. */
    observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
  } catch (error) {
    observer?.disconnect();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('scroll', onScroll, { capture: true });
    for (const pill of [...pills.values()]) release(pill);
    layer.remove();
    report(error);
    return () => {};
  }

  return () => {
    observer?.disconnect();
    window.removeEventListener('resize', onResize);
    document.removeEventListener('scroll', onScroll, { capture: true });
    for (const pill of [...pills.values()]) release(pill);
    for (const [surface, timer] of marks) {
      window.clearTimeout(timer);
      surface.removeAttribute(SCROLLING_ATTRIBUTE);
    }
    marks.clear();
    layer.remove();
  };
}
