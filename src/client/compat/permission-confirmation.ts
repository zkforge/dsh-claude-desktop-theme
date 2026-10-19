import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

const TITLES = new Set([
  '确认启用完全权限？', '确认启用自动审查（实验）？',
  'Enable Full access?', 'Enable Auto review (experimental)?',
]);
const ACKNOWLEDGED = 'data-ccd-permission-acknowledged';

/** Remove the redundant acknowledgement step from permission confirmations.
 * The native handler still updates React; only the user can press Enable.
 * Other RiskConfirmation callers retain their acknowledgement controls. */
export function mountPermissionConfirmation(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const changed = new Set<HTMLInputElement>();
  const hidden = new Set<HTMLElement>();
  const sync = () => {
    for (const input of changed) if (!input.isConnected) changed.delete(input);
    for (const label of hidden) if (!label.isConnected) hidden.delete(label);
    for (const dialog of document.querySelectorAll<HTMLElement>(host.riskConfirmation)) {
      if (!TITLES.has(dialog.getAttribute('aria-label') ?? '')) continue;
      const label = dialog.querySelector<HTMLElement>(host.riskAcknowledgement);
      const input = label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const confirm = dialog.querySelector<HTMLButtonElement>(host.riskConfirmAction);
      if (!label || !input || !confirm || input.disabled) continue;
      if (!input.checked) {
        changed.add(input);
        input.click();
      }
      // Wait for React's controlled state, rather than forcing disabled=false.
      if (!input.checked || confirm.disabled) continue;
      if (!hidden.has(label)) {
        if (document.activeElement === input) {
          dialog.querySelector<HTMLButtonElement>(host.riskCancelAction)?.focus({ preventScroll: true });
        }
        label.setAttribute(ACKNOWLEDGED, '');
        hidden.add(label);
      }
    }
  };
  const observer = new MutationObserver(() => {
    try { sync(); } catch (error) { report(error); }
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  try { sync(); } catch (error) { report(error); }
  return () => {
    observer.disconnect();
    for (const label of hidden) label.removeAttribute(ACKNOWLEDGED);
    for (const input of changed) if (input.isConnected && input.checked && !input.disabled) input.click();
    hidden.clear();
    changed.clear();
  };
}
