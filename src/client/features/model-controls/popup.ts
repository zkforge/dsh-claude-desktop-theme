import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

interface Size { width: number; height: number }

/**
 * The panel's border box, kept between placements.
 *
 * Its size changes only when its own content does, which the resize observer
 * below already reports, so each placement can read the trigger alone instead
 * of forcing a second layout of the surface. The first read is the seeding one:
 * the panel has been shown by the time `place()` runs, so its box is real.
 *
 * @param surface - the popover element.
 * @returns the cached size, and a way to re-read it when the observer fires.
 */
export function cachedSize(surface: Element): { current: () => Size; refresh: () => void } {
  let size: Size | null = null;
  const read = (): Size => {
    const { width, height } = surface.getBoundingClientRect();
    size = { width, height };
    return size;
  };
  return { current: () => size ?? read(), refresh: read };
}

/** Viewport-clamped top-layer surface; focus and observers die with the panel. */
export function usePopup(anchor: RefObject<HTMLButtonElement>, close: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, visibility: 'hidden' as 'hidden' | 'visible' });
  useLayoutEffect(() => {
    const surface = panel.current, trigger = anchor.current;
    if (!surface || !trigger) return;
    /* The Composer row/container and shell.overlay have separate stacking
       contexts. A manual popover escapes those contexts without moving the
       React tree or changing the existing outside-click and focus handling.
       The supported DSH Electron runtime supplies the native Popover API. */
    surface.setAttribute('popover', 'manual');
    surface.showPopover();
    const size = cachedSize(surface);
    const place = () => {
      const a = trigger.getBoundingClientRect(), p = size.current();
      const left = Math.max(12, Math.min(a.right - p.width, innerWidth - p.width - 12));
      const top = Math.max(12, Math.min(a.top - p.height - 8, innerHeight - p.height - 12));
      setPosition(previous => previous.left === left && previous.top === top && previous.visibility === 'visible'
        ? previous : { left, top, visibility: 'visible' });
    };
    place();
    /* The panel's own slider writes its inline style on every pointer move, and
       this observer sees all body `style` writes: coalescing to one placement
       per paint is what keeps a drag from measuring the panel per event. */
    let placed = 0;
    let placementTimer: ReturnType<typeof setTimeout> | undefined;
    const schedulePlace = () => {
      if (placed !== 0 || placementTimer !== undefined) return;
      const run = () => { placed = 0; placementTimer = undefined; place(); };
      if (typeof requestAnimationFrame === 'function') placed = requestAnimationFrame(run);
      else placementTimer = setTimeout(run, 16);
    };
    const onPointer = (event: PointerEvent) => {
      if (!surface.contains(event.target as Node) && !trigger.contains(event.target as Node)) close();
    };
    const onFocus = (event: FocusEvent) => {
      if (!surface.contains(event.target as Node) && !trigger.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); trigger.focus(); close(); }
      if (event.key !== 'Tab') return;
      const targets = Array.from(surface.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'));
      const first = targets[0], last = targets.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const observer = new MutationObserver(schedulePlace);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });
    /* A content change resizes the surface; this observer is that
       notification, so it is also the hook that refreshes the cached box. */
    const resize = new ResizeObserver(() => { size.refresh(); schedulePlace(); });
    resize.observe(surface);
    /* The surface is viewport-clamped, so a window resize can change its box
       even when its content does not; re-read it there before placing. */
    const onResize = () => { size.refresh(); schedulePlace(); };
    window.addEventListener('resize', onResize);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('focusin', onFocus);
    surface.addEventListener('keydown', onKey);
    const autofocus = requestAnimationFrame(() => surface.querySelector<HTMLElement>('[data-autofocus]')?.focus());
    return () => {
      cancelAnimationFrame(autofocus);
      if (placed !== 0) cancelAnimationFrame(placed);
      if (placementTimer !== undefined) clearTimeout(placementTimer);
      observer.disconnect(); resize.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('focusin', onFocus);
      surface.removeEventListener('keydown', onKey);
      if (surface.matches(':popover-open')) surface.hidePopover();
    };
  }, [anchor, close]);
  return { panel, position };
}
