import type { Disposer } from '../contracts/ports.ts';
import { recordsInTranscript } from './mutation-scope.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SOURCE = '[data-voice-activity="recording"] > svg:not([data-ccd-voice-waveform])';
const COUNT = 18; // One extra bar at each clipped edge.
const INTERVAL = 100;
const PITCH = 6.5;

export interface VoiceWaveformHistory {
  heights: number[];
  sampledAt: number | null;
}

/** Sample each bar once, then translate the history continuously. A bar's
 * height stays fixed for its entire trip from the right edge to the left. */
export function advanceVoiceWaveform(history: VoiceWaveformHistory, now: number, level: number): number {
  history.sampledAt ??= now;
  const elapsed = Math.max(0, now - history.sampledAt);
  const steps = Math.floor(elapsed / INTERVAL);
  if (steps > 0) {
    const height = Number.isFinite(level) ? Math.max(0, Math.min(17, level)) / 2 : 0;
    const added = Math.min(COUNT, steps);
    history.heights.splice(0, added);
    history.heights.push(...Array<number>(added).fill(height));
    history.sampledAt += steps * INTERVAL;
  }
  return (elapsed % INTERVAL) / INTERVAL * PITCH;
}

/** Render reference geometry from the host's real audio samples. Keep its SVG
 * mounted and untouched: its recording effect owns those original line nodes.
 * The separate presentation SVG cannot enter the host's line-node snapshot. */
export function mountVoiceWaveform(document: Document, report: (error: unknown) => void): Disposer {
  const view = document.defaultView;
  if (view === null) return () => {};
  const mounted = new Map<SVGSVGElement, { overlay: SVGSVGElement; lines: SVGLineElement[]; samples: SVGLineElement[]; history: VoiceWaveformHistory }>();
  let frame = 0;
  let disposed = false;

  const draw = (now: number): void => {
    frame = 0;
    for (const [source, state] of mounted) {
      if (!source.isConnected || !source.matches(SOURCE)) {
        state.overlay.remove();
        mounted.delete(source);
        continue;
      }
      // Average the latest three real samples only when a new bar is born.
      const latest = state.samples.slice(-3).map(line =>
        Math.max(0, (Number(line.getAttribute('y2')) - Number(line.getAttribute('y1'))) / 2 - 1));
      const level = latest.reduce((sum, value) => sum + value, 0) / latest.length;
      const offset = advanceVoiceWaveform(state.history, now, level);
      state.lines.forEach((line, index) => {
        const height = state.history.heights[index] ?? 0;
        const x = String(-PITCH / 2 + index * PITCH - offset);
        line.setAttribute('x1', x);
        line.setAttribute('x2', x);
        line.setAttribute('y1', String(10 - height));
        line.setAttribute('y2', String(10 + height));
      });
    }
    if (mounted.size > 0 && !disposed) frame = view.requestAnimationFrame(draw);
  };

  const sync = (): void => {
    if (disposed) return;
    try {
      for (const source of document.querySelectorAll<SVGSVGElement>(SOURCE)) {
        if (mounted.has(source)) continue;
        const samples = Array.from(source.querySelectorAll<SVGLineElement>('line'));
        if (samples.length !== 80) continue; // Unknown host geometry retains its native waveform.
        const overlay = document.createElementNS(SVG_NS, 'svg');
        overlay.setAttribute('data-ccd-voice-waveform', '');
        overlay.setAttribute('viewBox', '0 0 104 20');
        overlay.setAttribute('preserveAspectRatio', 'none');
        overlay.setAttribute('aria-hidden', 'true');
        const lines = Array.from({ length: COUNT }, (_, index) => {
          const line = document.createElementNS(SVG_NS, 'line');
          const x = String(-PITCH / 2 + index * PITCH);
          line.setAttribute('x1', x);
          line.setAttribute('x2', x);
          line.setAttribute('y1', '10');
          line.setAttribute('y2', '10');
          overlay.append(line);
          return line;
        });
        source.after(overlay);
        mounted.set(source, { overlay, lines, samples, history: { heights: Array<number>(COUNT).fill(0), sampledAt: null } });
      }
      if (frame === 0 && mounted.size > 0) frame = view.requestAnimationFrame(draw);
    } catch (error) {
      report(error);
    }
  };

  const observer = new MutationObserver(records => { if (!recordsInTranscript(records)) sync(); });
  observer.observe(document.body, { subtree: true, childList: true });
  sync();
  return () => {
    disposed = true;
    observer.disconnect();
    if (frame !== 0) view.cancelAnimationFrame(frame);
    for (const state of mounted.values()) state.overlay.remove();
    mounted.clear();
  };
}
