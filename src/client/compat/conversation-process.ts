import type { Disposer } from '../contracts/ports.ts';
import { ANCHOR } from './host-dom.ts';

/**
 * Reveal process containers through the host's own handlers. Changing CSS alone
 * leaves hidden reasoning and process members under the host's collapse policy.
 * Leaf reasoning/tool disclosures keep their independent state. Stable hooks
 * come from ui-chat's TurnProcessNodeView and ChatGroupSeat in DSH rc.2.
 */
export function mountConversationProcess(document: Document, report: (error: unknown) => void): Disposer {
  let released = false;
  let pending = false;
  const sync = () => {
    pending = false;
    if (released) return;
    try {
      const focused = document.activeElement;
      for (const button of document.querySelectorAll<HTMLButtonElement>(
        `${ANCHOR.turnProcess}, ${ANCHOR.stepProcessToggle}`,
      )) {
        if (!button.disabled && button.getAttribute('aria-expanded') === 'false') {
          button.click();
          // Host handlers focus their disclosure; background expansion must not
          // steal the Composer's caret or scroll an old turn into view.
          if (document.activeElement === button) {
            button.blur();
            if (focused?.isConnected && 'focus' in focused) {
              (focused as HTMLElement).focus({ preventScroll: true });
            }
          }
        }
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
  observer.observe(document.body, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['aria-expanded', 'disabled'],
  });
  sync();
  return () => {
    released = true;
    observer.disconnect();
  };
}
