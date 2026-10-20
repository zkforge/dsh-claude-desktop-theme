import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsInTranscript } from './mutation-scope.ts';

/* Keep the host context ring's accessible name free of its hidden percentage.
 * Voice controls retain their React-owned parent; composer.css positions their
 * painted boxes inside the input surface without relocating any host nodes.
 */
/** One percentage reading, with the spacing the host copy puts around it. */
const PERCENT_READING = /\s*\d+(?:[.,]\d+)?\s*%/u;

/** Name context rings and suppress the host's portaled dictation hint. */
export function mountComposerStatusOrder(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  /** The host's own accessible name per ring trigger. */
  const labels = new WeakMap<Element, string>();
  const tooltips = new Set<Element>();
  let scheduled = false;

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
    nameRings();
    // The host portals this bubble to body without an owner id. Match its
    // localized label while the voice trigger exists, independent of hover so
    // withdrawing the pointer cannot reveal the bubble during its exit.
    for (const tooltip of tooltips) if (!tooltip.isConnected) tooltips.delete(tooltip);
    if (!document.querySelector('[data-slot="conversation.input.activity"] button')) return;
    for (const tooltip of document.querySelectorAll('[role="tooltip"][data-portal]')) {
      const label = tooltip.textContent?.trim();
      if (label !== '听写' && label !== 'Dictate') continue;
      tooltip.setAttribute('data-ccd-dictation-tooltip', '');
      tooltips.add(tooltip);
    }
  };

  /* Straight from the observer, like `compat/stats-values.ts`: an occluded window
     throttles frames; update accessible names before the next paint. */
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
    observer = new MutationObserver(records => { if (!recordsInTranscript(records)) schedule(); });
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'],
    });
    sync();
  } catch (error) {
    observer?.disconnect();
    report(error);
    return () => {};
  }

  return () => {
    observer?.disconnect();
    restoreLabels();
    for (const tooltip of tooltips) tooltip.removeAttribute('data-ccd-dictation-tooltip');
    tooltips.clear();
  };
}
