import type { PersonalizationConfig } from '../../shared/config.ts';
import type { Disposer } from '../contracts/ports.ts';

export type RunningPhase = 'waiting' | 'thinking' | 'tool' | 'responding' | 'approval';

/** Native clock owns time, including when reopening a turn already in progress. */
export function runningDuration(label: string): string {
  return label.match(/(?:\d+\s*(?:hours?|minutes?|seconds?|[hms]|小时|分钟|分|秒)\s*)+/iu)?.[0]?.trim() ?? '';
}

export function runningPhase(root: Element): RunningPhase {
  if (root.querySelector('[data-state="awaiting-approval"], [data-cordis-status="awaiting-approval"]')) return 'approval';
  if (root.querySelector('[data-chat-flow-kind="tool-call"] :is([data-state="running"], [data-state="preparing"], [data-cordis-status="running"], [data-cordis-status="client-pending"])')) return 'tool';
  if (root.querySelector('[data-variant="think"][data-state="running"]')) return 'thinking';
  if (root.querySelector('[data-chat-flow-kind="assistant-step"] [data-streaming]:not([data-variant="think"]):not(:empty)')) return 'responding';
  return 'waiting';
}

const labels: Record<RunningPhase, string> = {
  waiting: 'Waiting for Claude…', thinking: 'Thinking…', tool: 'Using tools…',
  responding: 'Responding…', approval: 'Waiting for approval…',
};

/** Add a presentation sibling, leaving React's whale, clock and text untouched. */
export function mountRunningStatus(document: Document, style: PersonalizationConfig['runningStyle'],
  report: (error: unknown) => void): Disposer {
  if (style !== 'claude') return () => {};
  const seats = new Map<HTMLElement, { view: HTMLElement; clock: HTMLElement; label: HTMLElement; phase: RunningPhase | null }>();
  let pending = false;
  let released = false;
  const remove = (seat: HTMLElement, view: HTMLElement) => {
    view.remove();
    seat.removeAttribute('data-ccd-running-style');
  };
  const sync = () => {
    pending = false;
    if (released) return;
    try {
      for (const [seat, state] of seats) if (!seat.isConnected) {
        remove(seat, state.view);
        seats.delete(seat);
      }
      for (const seat of document.querySelectorAll<HTMLElement>('[data-chat-running]')) {
        let state = seats.get(seat);
        if (!state) {
          const view = document.createElement('span');
          view.className = 'ccd-running-content';
          const icon = document.createElement('span');
          icon.className = 'ccd-running-star';
          icon.setAttribute('aria-hidden', 'true');
          const clock = document.createElement('span');
          clock.setAttribute('aria-hidden', 'true');
          const label = document.createElement('span');
          label.className = 'ccd-running-label';
          label.setAttribute('role', 'status');
          view.append(icon, clock, label);
          state = { view, clock, label, phase: null };
          seats.set(seat, state);
          seat.setAttribute('data-ccd-running-style', 'claude');
          seat.append(view);
        }
        // Read only the native content sibling, never our own clock text.
        const native = [...seat.children].find(child => child !== state.view && child.querySelector('svg'));
        const duration = runningDuration(native?.textContent ?? '');
        const clock = duration ? `${duration} · ` : '';
        if (state.clock.textContent !== clock) state.clock.textContent = clock;
        const phase = runningPhase(seat.parentElement ?? seat);
        if (phase !== state.phase) {
          state.phase = phase;
          state.label.textContent = labels[phase];
          if (!document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            state.label.animate?.([{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'translateY(0)' }],
              { duration: 180, easing: 'ease-out' });
          }
        }
      }
    } catch (error) { report(error); }
  };
  const observer = new MutationObserver(records => {
    // Ignore our presentation writes; clock ticks and streaming changes remain observable.
    if (pending || records.every(record => {
      const element = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
      return !!element?.closest('.ccd-running-content');
    })) return;
    pending = true;
    queueMicrotask(sync);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['data-state', 'data-cordis-status', 'data-streaming'] });
  sync();
  return () => {
    released = true;
    observer.disconnect();
    for (const [seat, state] of seats) remove(seat, state.view);
    seats.clear();
  };
}
