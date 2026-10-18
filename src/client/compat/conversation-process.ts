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

  /** Open one disclosure without taking the reader's caret or scroll position. */
  const open = (button: HTMLButtonElement) => {
    if (button.disabled || button.getAttribute('aria-expanded') !== 'false') return;
    const focused = document.activeElement;
    button.click();
    // Host handlers focus their disclosure; background expansion must not
    // steal the Composer's caret or scroll an old turn into view.
    if (document.activeElement === button) {
      button.blur();
      if (focused?.isConnected && 'focus' in focused) {
        (focused as HTMLElement).focus({ preventScroll: true });
      }
    }
  };

  /**
   * Whether one mutation record can concern a process disclosure.
   *
   * The observer's attribute filter has already narrowed attributes to the two
   * names; what remains is the target check. An `aria-expanded` record cannot
   * be the write this module just made — that click set `true`, and only a
   * fold back to `false` is actionable.
   */
  const relevant = (record: MutationRecord): boolean => {
    if (record.type === 'attributes') {
      const target = record.target as Element;
      return typeof target.matches === 'function'
        && target.matches(`${ANCHOR.turnProcess}, ${ANCHOR.stepProcessToggle}`)
        && target.getAttribute('aria-expanded') === 'false';
    }
    return record.addedNodes.length > 0;
  };

  /**
   * Open the disclosures one batch of mutations introduced.
   *
   * The transcript keeps every settled turn in the DOM, so a document-wide
   * sweep on each mutation would re-read every button already opened — a cost
   * that grows with the conversation. Records name what actually changed:
   * inserted subtrees are searched once, and an attribute record names the one
   * disclosure the host folded. A batch that changed nothing relevant costs no
   * query at all.
   */
  const act = (records: readonly MutationRecord[]) => {
    if (!records.some(relevant)) return;
    for (const record of records) {
      // A newly inserted subtree makes the batch relevant, but unrelated
      // aria-expanded records in that batch still belong to their own menus.
      if (!relevant(record)) continue;
      if (record.type === 'attributes') {
        const target = record.target as Element;
        if (typeof (target as HTMLElement).click === 'function'
          && target.getAttribute('aria-expanded') === 'false') {
          open(target as HTMLButtonElement);
        }
        continue;
      }
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const element = node as Element;
        if (typeof element.matches !== 'function') continue;
        if (element.matches(`${ANCHOR.turnProcess}, ${ANCHOR.stepProcessToggle}`)) {
          open(element as HTMLButtonElement);
        }
        for (const button of element.querySelectorAll<HTMLButtonElement>(
          `${ANCHOR.turnProcess}, ${ANCHOR.stepProcessToggle}`,
        )) open(button);
      }
    }
  };

  const sync = (records?: readonly MutationRecord[]) => {
    pending = false;
    if (released) return;
    try {
      if (records === undefined) {
        /* The mount's own first pass: whatever history is already rendered. */
        for (const button of document.querySelectorAll<HTMLButtonElement>(
          `${ANCHOR.turnProcess}, ${ANCHOR.stepProcessToggle}`,
        )) open(button);
        return;
      }
      act(records);
    } catch (error) {
      report(error);
    }
  };
  let observer: MutationObserver | undefined;
  try {
    observer = new MutationObserver(records => {
      if (pending || released) {
        /* This batch arrived while another pass was queued. `pending` would
           drop it, and a replacement container can be delivered in that batch:
           run the new records directly instead of losing them. */
        if (!released) {
          try { act(records); } catch (error) { report(error); }
        }
        return;
      }
      pending = true;
      const batch = records.slice();
      queueMicrotask(() => sync(batch));
    });
    observer.observe(document.body, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['aria-expanded', 'disabled'],
    });
  } catch (error) {
    /* A frame that cannot observe has nothing to release and no safe state to
       claim: the disclosures stay the host's. */
    observer?.disconnect();
    report(error);
    return () => {};
  }
  sync();
  return () => {
    released = true;
    observer?.disconnect();
  };
}
