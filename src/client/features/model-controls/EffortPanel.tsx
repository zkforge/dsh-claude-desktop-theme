import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import type { EffortChoice } from './selection.ts';
import { clamp, drawPixelField, magnet } from './pixels.ts';
import { usePopup } from './popup.ts';

export interface EffortPanelProps {
  readonly anchor: RefObject<HTMLButtonElement>;
  readonly choices: readonly EffortChoice[];
  readonly selected: number;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCommit: (index: number) => void;
  readonly onClose: () => void;
}

/** Presentation-only slider: continuous local preview, one supported choice on release. */
export function EffortPanel({ anchor, choices, selected, disabled, busy, error, onCommit, onClose }: EffortPanelProps) {
  const helpId = useId();
  const { panel, position } = usePopup(anchor, onClose);
  const [value, setValue] = useState(selected);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef(0);
  const dragging = useRef(false);
  const committed = useRef(false);
  const samples = useRef<{ time: number; value: number }[]>([]);
  const lastValue = useRef(selected);
  const [labelIndex, setLabelIndex] = useState(selected);
  const initialLabel = useRef(choices[selected]?.name ?? '');
  const currentLabel = useRef<HTMLSpanElement>(null);
  const outgoingLabel = useRef<HTMLSpanElement>(null);
  const previousLabelIndex = useRef(selected);
  const labelFrame = useRef(0);
  const labelTimer = useRef(0);
  const max = choices.length - 1;
  const index = clamp(Math.round(value), 0, max);
  const name = choices[labelIndex]?.name ?? '';
  // Use the reference's violet treatment for the strongest explicit advertised tier.
  const ultra = max > 0 && index === max && choices[index]?.id !== undefined;
  const publish = (next: number) => { lastValue.current = next; setValue(next); };

  useEffect(() => {
    cancelAnimationFrame(frame.current); dragging.current = false;
    if (!committed.current) { lastValue.current = selected; setValue(selected); setLabelIndex(selected); }
    return () => cancelAnimationFrame(frame.current);
  }, [selected]);

  useEffect(() => {
    if (!ultra || !canvas.current) return;
    const element = canvas.current;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let animation = 0, last = 0, started = performance.now();
    const draw = (time: number) => {
      const rect = element.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
      const width = Math.round(rect.width * ratio), height = Math.round(rect.height * ratio);
      if (element.width !== width || element.height !== height) { element.width = width; element.height = height; }
      if (time - last >= 33 || reduced.matches) { last = time; drawPixelField(element, time - started, reduced.matches); }
      if (!reduced.matches) animation = requestAnimationFrame(draw);
    };
    const restart = () => { cancelAnimationFrame(animation); started = performance.now(); draw(started); };
    const resize = new ResizeObserver(restart);
    resize.observe(element); reduced.addEventListener('change', restart); restart();
    return () => { cancelAnimationFrame(animation); resize.disconnect(); reduced.removeEventListener('change', restart); };
  }, [ultra]);

  const settle = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const target = clamp(Math.round(lastValue.current), 0, max);
    cancelAnimationFrame(frame.current);
    if (disabled) { committed.current = false; publish(selected); setLabelIndex(selected); return; }
    committed.current = true;
    setLabelIndex(target);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || Math.abs(target - lastValue.current) < .001) { publish(target); onCommit(target); return; }
    let position = lastValue.current, velocity = 0, previousTime = performance.now();
    const first = samples.current[0], last = samples.current.at(-1);
    if (first && last) velocity = clamp((last.value - first.value) / Math.max((last.time - first.time) / 1000, .016), -8, 8);
    const step = (time: number) => {
      const delta = Math.min((time - previousTime) / 1000, .032); previousTime = time;
      velocity += (-920 * (position - target) - 40 * velocity) * delta;
      position = clamp(position + velocity * delta, 0, max); publish(position);
      if (Math.abs(position - target) < .001 && Math.abs(velocity) < .01) { frame.current = 0; publish(target); onCommit(target); }
      else frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    // A failed Host selection must return the preview to the saved value too.
    if (error) committed.current = false;
    if (!busy && !dragging.current && frame.current === 0 && !committed.current) { lastValue.current = selected; setValue(selected); setLabelIndex(selected); }
  }, [busy, selected, error]);
  useEffect(() => {
    if (!disabled) return;
    committed.current = false; cancelAnimationFrame(frame.current); dragging.current = false; lastValue.current = selected; setValue(selected); setLabelIndex(selected);
  }, [disabled, selected]);
  useLayoutEffect(() => {
    const currentElement = currentLabel.current;
    const outgoingElement = outgoingLabel.current;
    if (!currentElement || !outgoingElement) return;
    cancelAnimationFrame(labelFrame.current);
    window.clearTimeout(labelTimer.current);
    labelFrame.current = 0;
    labelTimer.current = 0;
    const nextName = choices[labelIndex]?.name ?? '';
    const previousName = currentElement.textContent ?? '';
    const previousIndex = previousLabelIndex.current;
    previousLabelIndex.current = labelIndex;
    currentElement.classList.remove('is-preparing');
    outgoingElement.classList.remove('is-exiting');
    if (previousName === nextName) return;
    outgoingElement.textContent = previousName;
    currentElement.textContent = nextName;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      outgoingElement.textContent = '';
      return;
    }
    const direction = labelIndex > previousIndex ? 1 : -1;
    currentElement.style.setProperty('--label-enter-y', `${direction * 3}px`);
    outgoingElement.style.setProperty('--label-exit-y', `${direction * -3}px`);
    currentElement.classList.add('is-preparing');
    void currentElement.getBoundingClientRect();
    labelFrame.current = requestAnimationFrame(() => {
      labelFrame.current = 0;
      currentElement.classList.remove('is-preparing');
      outgoingElement.classList.add('is-exiting');
    });
    labelTimer.current = window.setTimeout(() => {
      outgoingElement.textContent = '';
      outgoingElement.classList.remove('is-exiting');
      labelTimer.current = 0;
    }, 200);
  }, [labelIndex]);
  useEffect(() => () => {
    cancelAnimationFrame(labelFrame.current);
    window.clearTimeout(labelTimer.current);
  }, []);
  /* Two stops are the least a slider can travel between; a catalog that
     advertises fewer has nothing to pick, so the card draws no empty track. */
  if (max < 1) return null;
  return <div ref={panel} className="ccd-effort" role="dialog" aria-label="Effort" data-ultra={ultra ? '' : undefined}
    style={{ ...position, '--effort-progress': max > 0 ? value / max : 0 } as CSSProperties}>
    <section className="panel">
      <div className="header"><div className="title"><span>Effort</span>
        <span className="level-stage" data-longest={choices.reduce((longest, choice) => choice.name.length > longest.length ? choice.name : longest, '')} aria-live="polite" aria-atomic="true"><span ref={outgoingLabel} className="level-outgoing" aria-hidden="true" /><span ref={currentLabel} className="level-current">{initialLabel.current}</span></span>
      </div><div className="help-wrap"><button type="button" className="help-button" aria-label="About effort levels" aria-describedby={helpId}>
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" /><path d="M9.8 9.2a2.35 2.35 0 0 1 4.55.82c0 1.8-2.35 2.05-2.35 3.7M12 17.2h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      </button><div className="tooltip" id={helpId} role="tooltip">Higher effort means more thorough responses, but takes longer and uses your limits faster.</div></div></div>
      <div className="axis" aria-hidden="true"><span>Faster</span><span>Smarter</span></div>
      <div className="track-shell"><div className="track" aria-hidden="true"><div className="track-fill" /><div className="ultra-fallback" /><canvas ref={canvas} className="pixel-field" /><div className="ticks">{choices.map((choice, i) => <span key={choice.id ?? i} className="tick" style={{ opacity: ultra ? 0 : i === index ? 1 : .82 }} />)}</div></div>
        <input data-autofocus className="range" type="range" min="0" max={Math.max(0, max)} step="0.001" value={value} disabled={disabled || max < 1}
          aria-label="Effort level" aria-valuetext={name} aria-disabled={busy || disabled}
          onPointerDown={event => { if (busy) { event.preventDefault(); return; } committed.current = false; cancelAnimationFrame(frame.current); dragging.current = true; samples.current = [{ time: performance.now(), value: lastValue.current }]; event.currentTarget.setPointerCapture(event.pointerId); }}
          onChange={event => { if (busy) return; const next = dragging.current ? magnet(Number(event.currentTarget.value)) : Number(event.currentTarget.value); publish(next); setLabelIndex(clamp(Math.round(next), 0, max)); const now = performance.now(); samples.current = [...samples.current, { time: now, value: next }].filter(sample => now - sample.time < 90).slice(-5); }}
          onPointerUp={settle}
          onPointerCancel={() => { committed.current = false; dragging.current = false; publish(selected); setLabelIndex(selected); }}
          onBlur={() => { if (committed.current) return; dragging.current = false; cancelAnimationFrame(frame.current); publish(selected); setLabelIndex(selected); }}
          onKeyDown={event => {
            const targets: Record<string, number> = { ArrowLeft: index - 1, ArrowDown: index - 1, PageDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, PageUp: index + 1, Home: 0, End: max };
            const target = targets[event.key];
            if (target === undefined) return;
            event.preventDefault(); if (busy) return; committed.current = true; cancelAnimationFrame(frame.current); const next = clamp(target, 0, max); publish(next); setLabelIndex(next); onCommit(next);
          }} />
      </div>
      {error && <div className="selection-error" role="alert">{error}</div>}
    </section>
  </div>;
}
