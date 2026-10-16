import type { Disposer } from '../contracts/ports.ts';

/** The host marks only the latest turn ending in a reply as always revealed.
 * Starting another turn clears that marker before its response is complete. */
export const REPLY_SIGNATURE_SEAT = '[data-turn-tail][data-actions-reveal="always"]:has(> [data-clock="end"])';

/** Keep one playful signature at the latest settled reply, following host swaps. */
export function mountReplySignature(document: Document, report: (error: unknown) => void): Disposer {
  let button: HTMLButtonElement | null = null;
  let animation: Animation | undefined;
  let released = false;
  let pending = false;
  const clear = () => {
    animation?.cancel();
    animation = undefined;
    if (button) {
      button.onclick = null;
      button.remove();
      button = null;
    }
  };
  const sync = () => {
    pending = false;
    if (released) return;
    try {
      const seat = document.querySelector<HTMLElement>(REPLY_SIGNATURE_SEAT);
      if (button?.parentElement !== seat) clear();
      if (!seat) return;
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'ccd-reply-signature';
        button.onclick = () => {
          animation?.cancel();
          if (document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
          animation = button?.animate([
            { transform: 'rotate(0deg)' },
            { transform: 'rotate(-18deg)' },
            { transform: 'rotate(16deg)' },
            { transform: 'rotate(-11deg)' },
            { transform: 'rotate(7deg)' },
            { transform: 'rotate(0deg)' },
          ], { duration: 700, easing: 'ease-in-out' });
        };
        seat.append(button);
      }
      const label = document.documentElement.lang.startsWith('zh') ? '晃晃鲸鱼尾巴' : 'Wiggle the whale tail';
      button.setAttribute('aria-label', label);
      button.title = label;
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
    attributeFilter: ['data-actions-reveal', 'lang'],
  });
  sync();
  return () => {
    released = true;
    observer.disconnect();
    clear();
  };
}
