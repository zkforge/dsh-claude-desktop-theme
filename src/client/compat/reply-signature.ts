import type { PersonalizationConfig } from '../../shared/config.ts';
import type { Disposer } from '../contracts/ports.ts';

/** The host marks only the latest turn ending in a reply as always revealed.
 * Starting another turn clears that marker before its response is complete. */
export const REPLY_SIGNATURE_SEAT = '[data-turn-tail][data-actions-reveal="always"]:has(> [data-clock="end"])';

/** Keep one static decorative signature at the latest settled reply, following host swaps. */
export function mountReplySignature(
  document: Document,
  report: (error: unknown) => void,
  style: PersonalizationConfig['replySignatureStyle'] = 'whale',
): Disposer {
  if (style === 'none') return () => {};
  let mark: HTMLSpanElement | null = null;
  let released = false;
  let pending = false;
  const clear = () => {
    mark?.remove();
    mark = null;
  };
  const sync = () => {
    pending = false;
    if (released) return;
    try {
      const seat = document.querySelector<HTMLElement>(REPLY_SIGNATURE_SEAT);
      if (mark?.parentElement !== seat) clear();
      if (!seat) return;
      if (!mark) {
        mark = document.createElement('span');
        mark.className = `ccd-reply-signature ccd-reply-signature-${style}`;
        mark.setAttribute('aria-hidden', 'true');
        seat.append(mark);
      }
    } catch (error) {
      report(error);
    }
  };
  const observer = new MutationObserver(() => {
    if (pending || released) return;
    pending = true;
    queueMicrotask(sync);
  });
  observer.observe(document.documentElement, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['data-actions-reveal'],
  });
  sync();
  return () => {
    released = true;
    observer.disconnect();
    clear();
  };
}
