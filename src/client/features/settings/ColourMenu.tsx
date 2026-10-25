import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactElement } from 'react';
import { colourToHSV, hsvToColour } from './colours.ts';
import type { HSV } from './colours.ts';

export interface ColourMenuLabels {
  readonly plane: string;
  readonly hue: string;
}

/** A saturation/brightness plane with a hue strip, anchored to the colour pill. */
export function ColourMenu({ id, labelId, anchor, value, labels, onPreview, onSelect, onClose }: {
  readonly id: string;
  readonly labelId: string;
  readonly anchor: HTMLElement;
  readonly value: string;
  readonly labels: ColourMenuLabels;
  readonly onPreview: (value: string) => void;
  readonly onSelect: (value: string) => void;
  readonly onClose: () => void;
}): ReactElement {
  const menu = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState(() => anchor.getBoundingClientRect());
  const [hsv, setHSV] = useState(() => colourToHSV(value));
  const current = useRef(hsv);
  const update = (next: HSV) => {
    current.current = next;
    setHSV(next);
    onPreview(hsvToColour(next));
  };
  const commit = () => onSelect(hsvToColour(current.current));

  useEffect(() => { plane.current?.focus(); }, []);
  useEffect(() => {
    const sync = () => setRect(anchor.getBoundingClientRect());
    const outside = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && !anchor.contains(event.target) && !menu.current?.contains(event.target)) onClose();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
      anchor.querySelector('button')?.focus();
    };
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [anchor, onClose]);

  const point = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    update({ ...current.current, s: clamp((event.clientX - box.left) / box.width), v: 1 - clamp((event.clientY - box.top) / box.height) });
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? .1 : .01;
    const { s, v } = current.current;
    const next = event.key === 'ArrowRight' ? { s: Math.min(1, s + step), v }
      : event.key === 'ArrowLeft' ? { s: Math.max(0, s - step), v }
        : event.key === 'ArrowUp' ? { s, v: Math.min(1, v + step) }
          : event.key === 'ArrowDown' ? { s, v: Math.max(0, v - step) } : null;
    if (next === null) return;
    event.preventDefault();
    update({ ...current.current, ...next });
  };

  const width = Math.min(216, window.innerWidth - 24);
  const height = width;
  const top = rect.bottom + 6 + height > window.innerHeight - 12
    ? Math.max(12, rect.top - 6 - height) : rect.bottom + 6;
  return (
    <div id={id} ref={menu} className="ccd-settings-colour-menu" role="dialog" aria-labelledby={labelId}
      style={{ top, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - 12 - width)), width }}
      onBlur={event => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !anchor.contains(event.relatedTarget)) onClose();
      }}
      onKeyDown={event => {
        if (event.key === 'Tab' && (!event.shiftKey && event.target instanceof HTMLInputElement || event.shiftKey && event.target === plane.current)) {
          anchor.querySelector('button')?.focus();
          onClose();
        }
      }}>
      <div className="ccd-settings-colour-plane" ref={plane} role="slider" tabIndex={0}
        aria-label={labels.plane} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={`${Math.round(hsv.s * 100)}% / ${Math.round(hsv.v * 100)}%`}
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          point(event);
        }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) point(event); }}
        onPointerUp={event => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          point(event);
          event.currentTarget.releasePointerCapture(event.pointerId);
          commit();
        }}
        onPointerCancel={commit} onKeyDown={move}
        onKeyUp={event => { if (event.key.startsWith('Arrow')) commit(); }}>
        <span className="ccd-settings-colour-cursor" aria-hidden="true"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToColour(hsv) }} />
      </div>
      <div className="ccd-settings-colour-hue" style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}>
        <input type="range" min={0} max={360} step={1} value={hsv.h} aria-label={labels.hue}
          onChange={event => update({ ...current.current, h: Number(event.target.value) })}
          onPointerUp={commit} onPointerCancel={commit} onKeyUp={commit} />
        <span className="ccd-settings-colour-cursor" aria-hidden="true"
          style={{ left: `${hsv.h / 360 * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
    </div>
  );
}
