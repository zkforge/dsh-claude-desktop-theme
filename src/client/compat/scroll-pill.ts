import type { Disposer } from '../contracts/ports.ts';

/** Native scrollbars reveal their ink while scrolling, then return to idle. */
export const SCROLLING_ATTRIBUTE = 'data-ccd-scrolling';
export const IDLE_MS = 800;

/**
 * Keep the existing entry-point name for assembly compatibility. Geometry and
 * dragging now belong entirely to native scrollbars; no overlay or per-surface
 * observers are needed. Capture also reaches dynamically inserted scrollers.
 */
export function mountScrollPills(document: Document, report: (error: unknown) => void): Disposer {
  const marks = new Map<HTMLElement, number>();
  const onScroll = (event: Event) => {
    const target = event.target === document ? document.scrollingElement : event.target;
    const surface = target as HTMLElement | null;
    if (!surface || typeof surface.setAttribute !== 'function') return;
    surface.setAttribute(SCROLLING_ATTRIBUTE, '');
    const previous = marks.get(surface);
    if (previous !== undefined) window.clearTimeout(previous);
    marks.set(surface, window.setTimeout(() => {
      marks.delete(surface);
      surface.removeAttribute(SCROLLING_ATTRIBUTE);
    }, IDLE_MS));
  };
  try {
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
  } catch (error) { report(error); }
  return () => {
    document.removeEventListener('scroll', onScroll, { capture: true });
    for (const [surface, timer] of marks) {
      window.clearTimeout(timer);
      surface.removeAttribute(SCROLLING_ATTRIBUTE);
    }
    marks.clear();
  };
}
