import { useSyncExternalStore } from 'react';
import type { SessionInfoPort } from '../../contracts/session-info.ts';

/** The Session rail uses the same header control geometry and selected fill as tools. */
export function SessionInfoButton({ port }: { port: SessionInfoPort }) {
  const { visible, zh } = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
  const label = zh ? `${visible ? '隐藏' : '显示'}会话栏` : `${visible ? 'Hide' : 'Show'} session sidebar`;
  return <button type="button" className="ccd-header-action ccd-session-info-toggle"
    aria-label={label} title={label} aria-pressed={visible} onClick={() => port.toggle()}>
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 6h4M7 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="4.5" cy="6" r=".8" fill="currentColor" /><circle cx="4.5" cy="10" r=".8" fill="currentColor" />
    </svg>
  </button>;
}
