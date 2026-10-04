import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

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
    const place = () => {
      const a = trigger.getBoundingClientRect(), p = surface.getBoundingClientRect();
      const left = Math.max(12, Math.min(a.right - p.width, innerWidth - p.width - 12));
      const top = Math.max(12, Math.min(a.top - p.height - 8, innerHeight - p.height - 12));
      setPosition(previous => previous.left === left && previous.top === top && previous.visibility === 'visible'
        ? previous : { left, top, visibility: 'visible' });
    };
    place();
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
    const observer = new MutationObserver(place);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });
    const resize = new ResizeObserver(place);
    resize.observe(surface);
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('focusin', onFocus);
    surface.addEventListener('keydown', onKey);
    const autofocus = requestAnimationFrame(() => surface.querySelector<HTMLElement>('[data-autofocus]')?.focus());
    return () => {
      cancelAnimationFrame(autofocus);
      observer.disconnect(); resize.disconnect();
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('focusin', onFocus);
      surface.removeEventListener('keydown', onKey);
      if (surface.matches(':popover-open')) surface.hidePopover();
    };
  }, [anchor, close]);
  return { panel, position };
}
