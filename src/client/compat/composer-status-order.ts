import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

/**
 * The Composer status bar's seat order, and the context ring's accessible name.
 *
 * Host facts (DSH `0.2.0-rc.2`, read from the installed `app.asar`):
 *
 * - The status bar is `ui-conversation`'s `InputBar` control row
 *   (`.yhfFVG_row`). Its flex children are the leading `.yhfFVG_tools` group —
 *   command button, then `.yhfFVG_modes` holding the `conversation.input.permission`
 *   and `conversation.input.plan` seats — and the trailing `.yhfFVG_trailing`
 *   group — the model seat, then the `conversation.input.activity` seat, then the
 *   absolutely positioned send/stop buttons.
 * - `@deepseek-ai/dsh-experimental-client-ui-voice-input` registers its control
 *   into `conversation.input.activity`. The renderer seats every slot entry in a
 *   `display: contents` outlet (`div[data-slot="…"]`, see
 *   `dsh-client-ui-renderer`'s `SlotOutlet`), so the seat the slot occupies is
 *   that outlet's parent element.
 * - `ContextMeter` (`ui-conversation`'s skeleton) renders the ring's trigger
 *   with an accessible name carrying the reading, and returns nothing at all
 *   until the token meter knows both a numerator and the context window.
 *
 * The voice control therefore sits one flex container away from the permission
 * control it is asked to follow, and `order` cannot cross containers: the seat
 * itself has to move. It is moved into `.yhfFVG_modes`, immediately after the
 * permission seat and before the plan seat, and marked with
 * {@link VOICE_SEAT_ATTRIBUTE} so the stylesheet and the release path can find
 * it.
 *
 * Moving a node React owns is only safe while React never removes that node from
 * the parent it was moved out of. It does not: `InputBar` renders the seat under
 * two guards, `input === void 0` and `sessionId === void 0` — `input` is the
 * shell's own store snapshot, which exists as soon as the shell does — and the
 * `conversation.composer.bar` entry that owns the whole Composer is a
 * `session-maybe` slot, whose documented contract is that such an entry adopts
 * its first session in place and remounts, as one deleted subtree, on every later
 * identity change. Within one instance the seat is therefore only ever inserted,
 * never removed. Moving the *ring* instead is not available at all: `InputBar`
 * unmounts the ring whenever the voice control expands, and React would then call
 * `removeChild` on a parent the node no longer belongs to.
 *
 * The seat goes back to its recorded host position — and the mark comes off —
 * whenever the host switches the row to the voice control's capture layout
 * (`InputBar` hides `.yhfFVG_tools` and lets `.yhfFVG_trailing` span the row), so
 * that layout keeps the host's own geometry, and again on release.
 */

/** Mark on a relocated voice seat; the composer sheet reads it. */
export const VOICE_SEAT_ATTRIBUTE = 'data-ccd-voice-seat';

/** Slotted seat of the voice control; the renderer's outlet is its child. */
const ACTIVITY_OUTLET = '[data-slot="conversation.input.activity"]';

/** Seat the voice control is inserted before, which lands it after the permission seat. */
const PLAN_OUTLET = '[data-slot="conversation.input.plan"]';

/** Seat whose parent is the `.yhfFVG_modes` group the permission seat lives in. */
const PERMISSION_OUTLET = '[data-slot="conversation.input.permission"]';

/** The voice control's own capture-row marker, set for every non-idle phase. */
const VOICE_CAPTURE_ROW = '[data-voice-activity]';

/** One percentage reading, with the spacing the host copy puts around it. */
const PERCENT_READING = /\s*\d+(?:[.,]\d+)?\s*%/u;

/** Where one seat belongs in the host's own tree. */
interface Home {
  readonly parent: Element;
  readonly next: ChildNode | null;
}

/**
 * Keep the voice control beside the permission control, and the context ring's
 * accessible name free of the percentage it no longer shows.
 *
 * @param document - renderer document carrying the Composer.
 * @param report - sink for observer failures; the host's own order stays.
 * @returns disposer that restores every seat and label it touched.
 */
export function mountComposerStatusOrder(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  /** The host's own position per relocated seat, recorded before the first move. */
  const homes = new WeakMap<HTMLElement, Home>();
  /** The host's own accessible name per ring trigger. */
  const labels = new WeakMap<Element, string>();
  let scheduled = false;

  /** Every voice seat currently in the document. */
  const seats = (): HTMLElement[] => Array.from(document.querySelectorAll(ACTIVITY_OUTLET))
    .map(outlet => outlet.parentElement)
    .filter((seat): seat is HTMLElement => seat !== null && seat.isConnected);

  /** The recorded host position of one seat, taken before this module moves it. */
  const home = (seat: HTMLElement): Home | null => {
    const known = homes.get(seat);
    if (known !== undefined) return known;
    const parent = seat.parentElement;
    if (parent === null) return null;
    const position: Home = { parent, next: seat.nextSibling };
    homes.set(seat, position);
    return position;
  };

  /** Hand one seat back to the host's own tree. */
  const release = (seat: HTMLElement): void => {
    seat.removeAttribute(VOICE_SEAT_ATTRIBUTE);
    const position = home(seat);
    if (position === null || !position.parent.isConnected) return;
    if (seat.parentElement === position.parent) return;
    /* A recorded sibling that React has since replaced is no anchor; the
       seat then appends, which is the same place on screen because this plugin
       takes the send/stop buttons out of the flow (`composer.css`). */
    const next = position.next !== null && position.next.parentNode === position.parent ? position.next : null;
    position.parent.insertBefore(seat, next);
  };

  const orderSeats = (): void => {
    const tools = document.querySelector<HTMLElement>(host.composerTools);
    const modes = document.querySelector(PERMISSION_OUTLET)?.parentElement ?? null;
    for (const seat of seats()) {
      /* `InputBar` hides the leading group for the voice control's capture row
         and lets the trailing group span the row, so the seat belongs back in
         the host's own tree for that state. The voice bundle's own
         `data-voice-activity` marker is that same state and, being a stable
         attribute, still reads on a build whose class hashes are unknown. */
      const capturing = seat.querySelector(VOICE_CAPTURE_ROW) !== null
        || (tools !== null && tools.hasAttribute('hidden'));
      if (capturing || modes === null) {
        if (seat.hasAttribute(VOICE_SEAT_ATTRIBUTE)) release(seat);
        continue;
      }
      if (seat.parentElement === modes) continue;
      home(seat);
      modes.insertBefore(seat, modes.querySelector(PLAN_OUTLET));
      seat.setAttribute(VOICE_SEAT_ATTRIBUTE, 'permission');
    }
  };

  const nameRings = (): void => {
    for (const trigger of document.querySelectorAll<HTMLElement>(host.contextMeterTrigger)) {
      const label = trigger.getAttribute('aria-label');
      if (label === null) continue;
      const stripped = label.replace(PERCENT_READING, ' ').replace(/\s+/gu, ' ').trim();
      /* A label that is nothing but the reading keeps the host's own text: an
         empty accessible name would be worse than the number. */
      if (stripped === '' || stripped === label) continue;
      labels.set(trigger, label);
      trigger.setAttribute('aria-label', stripped);
    }
  };

  const restoreLabels = (): void => {
    for (const trigger of document.querySelectorAll<HTMLElement>(host.contextMeterTrigger)) {
      const label = labels.get(trigger);
      if (label !== undefined) trigger.setAttribute('aria-label', label);
    }
  };

  const sync = (): void => {
    orderSeats();
    nameRings();
  };

  /* Straight from the observer, like `compat/stats-values.ts`: an occluded window
     throttles frames, and the seat has to be right before the next paint — an
     observer callback runs before it, so a missed sync would be visible. */
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    try {
      sync();
    } finally {
      scheduled = false;
    }
  };

  let observer: MutationObserver | undefined;
  try {
    observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'aria-label'],
    });
    sync();
  } catch (error) {
    observer?.disconnect();
    report(error);
    return () => {};
  }

  return () => {
    observer?.disconnect();
    for (const seat of seats()) if (seat.hasAttribute(VOICE_SEAT_ATTRIBUTE)) release(seat);
    restoreLabels();
  };
}
