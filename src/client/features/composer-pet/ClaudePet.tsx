import { useEffect, useRef, useState } from 'react';
import { CLAUDE_IDLE } from './claude-frames.ts';
import { claudePose, CLAUDE_REACTION_MS } from './claude-motion.ts';

/** Reference pixel companion: take out a laptop, type, then return to standing. */
export function ClaudePet() {
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [hidden, setHidden] = useState(() => document.hidden);
  const frame = useRef<number | null>(null);
  const reduced = useRef(false);
  const cancel = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  useEffect(() => {
    const visibility = () => {
      setHidden(document.hidden);
      if (document.hidden) { cancel(); setElapsed(null); }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => { cancel(); document.removeEventListener('visibilitychange', visibility); };
  }, []);
  const play = () => {
    if (frame.current !== null || document.hidden) return;
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    setElapsed(0);
    const tick = (now: number) => {
      const time = now - start;
      if (time >= (reduced.current ? 200 : CLAUDE_REACTION_MS)) {
        frame.current = null;
        setElapsed(null);
        return;
      }
      setElapsed(time);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  return (
    <button type="button" className="ccd-composer-pet ccd-claude-pet" aria-label="Play with Claude"
      aria-disabled={hidden || elapsed !== null} data-paused={hidden || undefined}
      onClick={event => { event.stopPropagation(); play(); }}>
      <ClaudeArt elapsed={elapsed} reducedMotion={reduced.current} />
    </button>
  );
}

/** One shared drawing path for idle and recorded poses, also used by previews. */
export function ClaudeArt({ elapsed = null, reducedMotion = false }: {
  readonly elapsed?: number | null; readonly reducedMotion?: boolean;
}) {
  const paths = (elapsed === null ? null : claudePose(elapsed, reducedMotion)) ?? CLAUDE_IDLE;
  const blink = elapsed !== null && (reducedMotion || elapsed < 150);
  return (
    <svg className="ccd-claude-art" viewBox="-15 -13 52 37" width="52" height="37"
      shapeRendering="crispEdges" aria-hidden="true">
      {paths.map((path, index) => (
        <path key={index} className={['ccd-claude-body', 'ccd-claude-shade', 'ccd-claude-eyes', 'ccd-claude-laptop'][index]}
          d={blink && index === 2 ? 'M9 4h3v.5H9ZM23 4h3v.5h-3Z' : path} />
      ))}
    </svg>
  );
}
