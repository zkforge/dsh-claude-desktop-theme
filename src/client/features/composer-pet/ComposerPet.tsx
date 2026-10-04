import { useEffect, useRef, useState } from 'react';
import { Whale } from './Whale.tsx';
import { pickPetReaction, playPetReaction } from './reactions.ts';
import type { PetPlayback, PetReaction } from './reactions.ts';

/**
 * The hero-page whale. Accepted clicks choose one of three local reactions;
 * busy clicks do nothing, and hiding or unmounting cancels all active frames.
 * It reads no session state and does not trigger any Composer action.
 * @returns the whale mark.
 */
export function ComposerPet() {
  const [hidden, setHidden] = useState(() => document.hidden);
  const [reaction, setReaction] = useState<PetReaction | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const active = useRef<PetPlayback | null>(null);

  useEffect(() => {
    const cancel = () => {
      const playback = active.current;
      active.current = null;
      playback?.cancel();
    };
    const visibility = () => {
      setHidden(document.hidden);
      if (document.hidden) { cancel(); setReaction(null); }
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      cancel();
    };
  }, []);

  const play = () => {
    if (active.current !== null || document.hidden) return;
    const art = button.current?.querySelector<SVGSVGElement>('.ccd-pet-art');
    if (!art) return;
    const next = pickPetReaction();
    const playback = playPetReaction(art, next, window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    active.current = playback;
    setReaction(next);
    void playback.finished.then(() => {
      if (active.current !== playback) return;
      active.current = null;
      setReaction(null);
    });
  };

  return (
    <button ref={button} type="button" className="ccd-composer-pet" aria-label="Play with the whale"
      aria-disabled={hidden || reaction !== null} data-paused={hidden || undefined}
      data-reaction={reaction ?? undefined} onClick={event => { event.stopPropagation(); play(); }}>
      <Whale />
    </button>
  );
}
