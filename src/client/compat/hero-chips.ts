import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

/** Measured hero row width, also reserved in the Composer tools group. */
export const HERO_CHIP_WIDTH_PROPERTY = '--ccd-workspace-seat';

/**
 * Measure the complete workspace/preset row, whose chips size to their content.
 * Reserve that width plus one gap in the tools group to separate the permission
 * button. Observe label, font and viewport-driven size changes.
 */
export function mountHeroChips(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  /** Composer stack the measured width is published on. */
  let stack: HTMLElement | null = null;
  /** The complete row, independent of the tools group's reserved padding. */
  let seat: HTMLElement | null = null;
  let sizes: ResizeObserver | undefined;
  let mutations: MutationObserver | undefined;

  /** Republish the seat's width, rounded to the px the stylesheet consumes. */
  const measure = (): void => {
    if (stack === null || seat === null || !seat.isConnected) return;
    const width = seat.getBoundingClientRect().width;
    /* A seat the host has not laid out yet (a hidden row, a collapsing session)
       measures zero and would cap both chips to nothing. */
    if (width <= 0) return;
    const value = `${Math.round(width)}px`;
    if (stack.style.getPropertyValue(HERO_CHIP_WIDTH_PROPERTY) !== value) {
      stack.style.setProperty(HERO_CHIP_WIDTH_PROPERTY, value);
    }
  };

  /** Re-bind the seat React owns and read its current width. */
  const sync = (): void => {
    const row = document.querySelector<HTMLElement>(host.heroWorkspaceRow);
    const nextStack = row?.closest<HTMLElement>(host.composerStack) ?? null;
    if (nextStack !== stack) {
      stack?.style.removeProperty(HERO_CHIP_WIDTH_PROPERTY);
      stack = nextStack;
    }
    const nextSeat = row;
    if (nextSeat !== seat) {
      seat = nextSeat;
      sizes?.disconnect();
      if (seat !== null) sizes?.observe(seat);
    }
    measure();
  };

  const release = (): void => {
    stack?.style.removeProperty(HERO_CHIP_WIDTH_PROPERTY);
  };

  try {
    sizes = new ResizeObserver(() => { measure(); });
    mutations = new MutationObserver(() => { sync(); });
    mutations.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    sync();
  } catch (error) {
    sizes?.disconnect();
    mutations?.disconnect();
    release();
    report(error);
    return () => {};
  }

  return () => {
    sizes?.disconnect();
    mutations?.disconnect();
    release();
    stack = null;
    seat = null;
  };
}
