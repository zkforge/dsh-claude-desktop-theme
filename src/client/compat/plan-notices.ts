import type { Disposer } from '../contracts/ports.ts';

const ROW = '[data-chat-flow-kind="command"]';
const MARKER = 'data-ccd-plan-notice';

/** Only the host's short mode acknowledgements, never a plan document or error. */
export function isPlanNotice(text: string): boolean {
  return /^plan\s*(?:[·.]\s*)?(?:Plan mode on\. Use \/plan off to leave\.|Plan mode off\.|Plan mode entry cancelled\.|Entering plan mode \(applies from the next step\)\. Use \/plan off to leave\.|Leaving plan mode \(applies from the next step\)\.)$/u.test(text.trim());
}

/** Keep the logged command intact, withdrawing only its successful visual row. */
export function mountPlanNotices(document: Document, report: (error: unknown) => void): Disposer {
  const marked = new Set<Element>();
  const syncRow = (row: Element) => {
    const success = row.querySelector('[data-state="ok"]');
    const hide = success !== null && isPlanNotice(success.textContent ?? '');
    row.toggleAttribute(MARKER, hide);
    if (hide) marked.add(row);
    else marked.delete(row);
  };
  const inspect = (element: Element) => {
    const row = element.closest(ROW);
    if (row) syncRow(row);
    for (const child of element.querySelectorAll(ROW)) syncRow(child);
  };
  const observer = new MutationObserver(records => {
    try {
      for (const row of marked) if (!row.isConnected) marked.delete(row);
      for (const record of records) {
        const element = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
        if (element) {
          // Only scan inserted subtrees; text/state updates revisit their own row.
          const row = element.closest(ROW);
          if (row) syncRow(row);
        }
        for (const node of record.addedNodes) if (node.nodeType === 1) inspect(node as Element);
      }
    } catch (error) { report(error); }
  });
  try {
    for (const row of document.querySelectorAll(ROW)) syncRow(row);
    observer.observe(document.body, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['data-state'],
    });
  } catch (error) { report(error); }
  return () => {
    observer.disconnect();
    for (const row of marked) row.removeAttribute(MARKER);
    marked.clear();
  };
}
