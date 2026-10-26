import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { SessionCardId } from '../../../shared/session-info.ts';

interface CardBox {
  readonly id: SessionCardId;
  readonly node: HTMLElement;
  readonly rect: DOMRect;
}

/** Move the actual card, keeping its original slot until the pointer commits a new order. */
export function useCardDrag(session: string | null, visible: boolean, reorder: (ids: readonly SessionCardId[]) => void) {
  const finish = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  const reveal = useRef<HTMLElement | null>(null);
  const commit = useRef(reorder);
  commit.current = reorder;
  useEffect(() => () => { finish.current?.(); }, [session, visible]);
  useLayoutEffect(() => {
    if (reveal.current?.isConnected) reveal.current.scrollIntoView({ block: 'nearest' });
    reveal.current = null;
  });

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>, id: SessionCardId) => {
    if (event.button !== 0 || !event.isPrimary) return;
    const target = event.target as Element;
    if (target.closest('a, input, textarea, select, summary, [contenteditable="true"], button:not(.ccd-info-toggle):not(.ccd-info-grip)')) return;
    finish.current?.();
    suppressClick.current = false;
    const node = event.currentTarget;
    const rail = node.parentElement;
    if (rail === null) return;
    const cards: CardBox[] = [...rail.querySelectorAll<HTMLElement>(':scope > [data-ccd-info-card]')].map(card => ({
      id: card.getAttribute('data-ccd-info-card') as SessionCardId, node: card, rect: card.getBoundingClientRect(),
    }));
    const source = cards.find(card => card.id === id);
    if (source === undefined) return;
    const startX = event.clientX, startY = event.clientY, pointer = event.pointerId;
    const scrollTop = rail.scrollTop;
    const controller = new AbortController();
    const options = { signal: controller.signal };
    let active = false;
    let scrollShift = 0;
    let order = cards.map(card => card.id);
    let ended = false;
    const end = (save: boolean) => {
      if (ended) return;
      ended = true;
      controller.abort();
      if (node.hasPointerCapture(pointer)) node.releasePointerCapture(pointer);
      rail.removeAttribute('data-ccd-info-dragging');
      for (const card of cards) {
        card.node.removeAttribute('data-ccd-info-moving');
        card.node.style.removeProperty('transform');
      }
      rail.scrollTop = scrollTop;
      if (finish.current === cancel) finish.current = null;
      if (save && active) { reveal.current = node; commit.current(order); }
    };
    const cancel = () => end(false);
    finish.current = cancel;
    document.addEventListener('pointermove', next => {
      if (next.pointerId !== pointer) return;
      const dx = next.clientX - startX, dy = next.clientY - startY;
      if (!active && Math.hypot(dx, dy) < 5) return;
      next.preventDefault();
      if (!active) {
        active = true;
        suppressClick.current = true;
        rail.setAttribute('data-ccd-info-dragging', '');
        scrollShift = node.getBoundingClientRect().top - source.rect.top;
        node.setAttribute('data-ccd-info-moving', '');
        node.setPointerCapture(pointer);
        window.getSelection()?.removeAllRanges();
      }
      const x = Math.max(8 - source.rect.left, Math.min(dx, innerWidth - source.rect.right - 8));
      const y = Math.max(8 - source.rect.top, Math.min(dy, Math.max(8, innerHeight - source.rect.height - 8) - source.rect.top));
      node.style.transform = `translate3d(${x}px, ${y - scrollShift}px, 0)`;
      const center = source.rect.top + source.rect.height / 2 + y;
      const others = cards.filter(card => card !== source);
      const bounds = rail.getBoundingClientRect();
      const index = next.clientY < Math.max(8, bounds.top) + 24 ? 0
        : next.clientY > Math.min(innerHeight - 8, bounds.bottom) - 24 ? others.length
        : others.filter(card => center > card.rect.top + card.rect.height / 2).length;
      const preview = [...others];
      preview.splice(index, 0, source);
      order = preview.map(card => card.id);
      let top = cards[0]!.rect.top;
      for (const card of preview) {
        if (card !== source) card.node.style.transform = `translateY(${top - card.rect.top - scrollShift}px)`;
        top += card.rect.height + 8;
      }
    }, { ...options, passive: false });
    document.addEventListener('pointerup', next => { if (next.pointerId === pointer) end(true); }, options);
    document.addEventListener('pointercancel', next => { if (next.pointerId === pointer) cancel(); }, options);
    node.addEventListener('lostpointercapture', cancel, options);
    document.addEventListener('keydown', next => {
      if (next.key !== 'Escape') return;
      if (active) { next.preventDefault(); next.stopPropagation(); }
      cancel();
    }, { ...options, capture: true });
    window.addEventListener('blur', cancel, options);
    window.addEventListener('resize', cancel, options);
  };

  const onClickCapture = (event: ReactMouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault(); event.stopPropagation();
  };
  return { onPointerDown, onClickCapture };
}
