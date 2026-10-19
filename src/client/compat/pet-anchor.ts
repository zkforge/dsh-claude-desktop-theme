import { hostAnchors } from './host-dom.ts';
import type { Disposer } from '../contracts/ports.ts';

/** Where the frame-wide seat is drawn, in viewport coordinates. */
export interface PetAnchor { readonly left: number; readonly top: number }

/** One observed, disposable source of the seat's position. */
export interface PetAnchorSource {
  /** Current position, or null while the seat has no card to sit on. */
  getSnapshot(): PetAnchor | null;
  /** Observe position changes; returns the releaser. */
  subscribe(listener: () => void): Disposer;
  /** Release every observer and listener this source installed. */
  dispose(): void;
}

/** The artwork's box: a 32 × 24 pixel grid drawn at 1:1, as `Whale.tsx` renders it. */
export const PET_BOX = Object.freeze({ width: 32, height: 24 });

/** Inset from the Composer card's trailing edge; `pet.css` draws the seat with
    the measured numbers, and the test asserts the two agree. */
export const PET_INSET = 12;

/**
 * Publish the top trailing corner of the hero Composer card in viewport
 * coordinates for shell.overlay. The DSH conversation root's data-phase=hero
 * selects new sessions; hidden, missing or unlaid-out cards publish null.
 * @returns position source whose dispose releases all listeners and observers.
 */
export function createPetAnchor(document: Document, report: (error: unknown) => void, box: { readonly width: number; readonly height: number; readonly inset?: number } = PET_BOX): PetAnchorSource {
  const anchors = hostAnchors(document);
  const listeners = new Set<() => void>();
  let value: PetAnchor | null = null;
  let card: HTMLElement | null = null;
  let size: ResizeObserver | undefined;
  let released = false;

  const publish = (next: PetAnchor | null) => {
    if (value?.left === next?.left && value?.top === next?.top) return;
    value = next;
    for (const listener of [...listeners]) listener();
  };

  /**
   * Watch the hero card.
   *
   * The seat is drawn only on the new-session page, so the watchers exist only
   * while that page does. A seat that stayed subscribed to every `style`/`class`
   * write and every scroll of the whole window would keep measuring a page it is
   * not on; instead the phase is re-read cheaply (one selector query) on the
   * signals that can change it, and the expensive watchers are attached and
   * detached with the page.
   */
  let watching = false;
  let observer: MutationObserver | undefined;
  let phaseObserver: MutationObserver | undefined;
  const attach = () => {
    if (watching) return;
    watching = true;
    observer?.observe(document.body, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['style', 'class', 'data-phase'],
    });
    window.addEventListener('resize', sync);
    document.addEventListener('scroll', sync, true);
    document.addEventListener('visibilitychange', sync);
    if (card !== null) size?.observe(card);
  };
  const detach = () => {
    if (!watching) return;
    watching = false;
    observer?.disconnect();
    size?.disconnect();
    window.removeEventListener('resize', sync);
    document.removeEventListener('scroll', sync, true);
    document.removeEventListener('visibilitychange', sync);
  };

  const sync = () => {
    if (released) return;
    const next = document.querySelector<HTMLElement>(anchors.composerCardHero);
    if (next === null) {
      detach();
      card = null;
      publish(null);
      return;
    }
    if (!watching) attach();
    if (next !== card) {
      if (card !== null) size?.disconnect();
      card = next;
      if (card !== null) size?.observe(card);
    }
    const rect = card.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || document.hidden) {
      publish(null);
      return;
    }
    publish({
      left: Math.round(rect.right - box.width - (box.inset ?? PET_INSET)),
      top: Math.round(rect.top - box.height),
    });
  };

  try {
    observer = new MutationObserver(sync);
    /* The hero-to-conversation swap replaces the card, so the seat has to hear
       about it even while its own watchers are detached. This gate runs on
       structure alone: it re-reads the page only when a mutation introduces a
       conversation root (or flips its phase), so transcript streaming while a
       conversation is up costs a subtree test, not a measurement. */
    phaseObserver = new MutationObserver(records => {
      /* While the hero is watched, its own observer already hears every change
         that can move the seat. The gate only has to notice the hero coming
         back after a conversation: a root inserted with a phase, or an existing
         root's phase attribute flipping. */
      if (watching) return;
      const arrived = records.some(record => record.type === 'attributes'
        ? record.attributeName === 'data-phase'
        : [...record.addedNodes].some(node => node.nodeType === 1
          && (((node as Element).matches?.('[data-phase]') ?? false)
            || ((node as Element).querySelector?.('[data-phase]') ?? null) !== null)));
      if (!arrived) return;
      sync();
    });
    /* A layout-only change (column drag, card growth, a font swap) moves the
       corner without a mutation, and this seat is placed in JavaScript, so it
       cannot follow the card through CSS the way the in-card seat does. The
       ResizeObserver is that missing signal — the one deliberate exception to
       the "observers only" rule in ARCHITECTURE.md, which excludes it as a
       *liveness* signal; here it only refines an already-published position,
       and a throttled delivery while the window is hidden is harmless because
       a hidden document publishes null anyway. */
    if (typeof ResizeObserver === 'function') size = new ResizeObserver(sync);
    sync();
    phaseObserver.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['data-phase'],
    });
  } catch (error) {
    observer?.disconnect();
    phaseObserver?.disconnect();
    detach();
    size?.disconnect();
    size = undefined;
    listeners.clear();
    report(error);
    return inertAnchor();
  }

  return {
    getSnapshot: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose() {
      if (released) return;
      released = true;
      phaseObserver?.disconnect();
      /* `detach` releases the card and size observers with the watchers it
         owns; a seat that never watched still holds the size observer it was
         built with, so that one is released here. */
      const attached = watching;
      detach();
      if (!attached) size?.disconnect();
      size = undefined;
      listeners.clear();
      card = null;
      value = null;
    },
  };
}

/** A source with nothing to publish; the seat stays off and the native UI stays. */
function inertAnchor(): PetAnchorSource {
  return {
    getSnapshot: () => null,
    subscribe: () => () => {},
    dispose: () => {},
  };
}
