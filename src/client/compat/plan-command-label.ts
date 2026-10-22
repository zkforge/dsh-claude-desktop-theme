import type { Disposer } from '../contracts/ports.ts';

const OPTIONS = '[data-trigger-menu] [role="option"]';
const COPY = new Map([['计划', '创建计划任务'], ['Plan', 'Create a plan task']]);

/** Clarify the command entry without changing its token, draft, or native handlers. */
export function mountPlanCommandLabel(document: Document, report: (error: unknown) => void): Disposer {
  const drawn = new Map<Text, { original: string; replacement: string }>();
  const draw = (row: Element) => {
    const name = row.querySelector('[class$="_itemName"]');
    const alias = row.querySelector('[class$="_itemAlias"]')?.textContent?.trim();
    const node = name?.firstChild;
    if (node?.nodeType !== 3) return;
    const original = node.nodeValue ?? '';
    const replacement = COPY.get(original);
    if (replacement === undefined || (alias !== undefined && alias !== 'plan')) return;
    // English has no alias: the host suppresses it when label and token coincide.
    if (alias === undefined && original !== 'Plan') return;
    node.nodeValue = replacement;
    drawn.set(node as Text, { original, replacement });
  };
  const inspect = (element: Element) => {
    if (element.matches(OPTIONS)) draw(element);
    const row = element.closest(OPTIONS);
    if (row) draw(row);
    for (const option of element.querySelectorAll(OPTIONS)) draw(option);
  };
  const observer = new MutationObserver(records => {
    try {
      for (const node of drawn.keys()) if (!node.isConnected) drawn.delete(node);
      for (const record of records) {
        const element = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
        if (element?.closest('[data-trigger-menu]')) {
          const row = element.closest(OPTIONS);
          if (row) draw(row);
        }
        for (const node of record.addedNodes) if (node.nodeType === 1) inspect(node as Element);
      }
    } catch (error) { report(error); }
  });
  try {
    for (const row of document.querySelectorAll(OPTIONS)) draw(row);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  } catch (error) { report(error); }
  return () => {
    observer.disconnect();
    for (const [node, copy] of drawn) {
      if (node.isConnected && node.nodeValue === copy.replacement) node.nodeValue = copy.original;
    }
    drawn.clear();
  };
}
