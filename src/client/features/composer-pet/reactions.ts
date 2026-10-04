/** Local reactions only: the pet does not read or change a session. */
export type PetReaction = 'spout' | 'hop' | 'wag';

const durations: Record<PetReaction, number> = { spout: 1050, hop: 680, wag: 900 };

/** Equal thirds, sampled once per accepted click. */
export function pickPetReaction(random: () => number = Math.random): PetReaction {
  const draw = random();
  return draw < 1 / 3 ? 'spout' : draw < 2 / 3 ? 'hop' : 'wag';
}

export interface PetPlayback {
  /** Resolves on completion or cancellation, including component disposal. */
  readonly finished: Promise<void>;
  cancel(): void;
}

type Pose = readonly [offset: number, x: number, y: number, angle: number, sx: number, sy: number];
const poses: Record<PetReaction, readonly Pose[]> = {
  hop: [[0, 0, 0, 0, 1, 1], [.12, 0, 1, 0, 1.09, .84], [.29, 0, -8, -5, .94, 1.07],
    [.47, 0, -10, -3, 1, 1], [.72, 0, 0, 0, 1.1, .86], [.86, 0, -2, 0, .98, 1.02], [1, 0, 0, 0, 1, 1]],
  spout: [[0, 0, 0, 0, 1, 1], [.16, 0, 1, -3, 1.05, .93], [.32, 0, -2, 3, .98, 1.02],
    [.58, 0, -1, 0, 1, 1], [.8, 0, 0, 0, 1, 1], [1, 0, 0, 0, 1, 1]],
  wag: [[0, 0, 0, 0, 1, 1], [.2, -1, 0, -3, 1, 1], [.4, 1, 0, 3, 1, 1],
    [.6, -1, 0, -2, 1, 1], [.8, 1, 0, 2, 1, 1], [1, 0, 0, 0, 1, 1]],
};

/**
 * Play the approved preview's poses on the existing 32 × 24 artwork. Per-frame
 * easing keeps pixel swaps discrete without quantizing the whole timeline.
 * No filled final frames: cancellation and completion restore the idle art.
 */
export function playPetReaction(art: SVGSVGElement, reaction: PetReaction, reducedMotion: boolean): PetPlayback {
  const animations: Animation[] = [];
  const completions: Promise<Animation>[] = [];
  const animate = (part: string, frames: Keyframe[], easing = 'linear', duration = durations[reaction]) => {
    const node = art.querySelector<SVGElement>(`.ccd-pet-${part}`);
    if (!node) throw new Error(`Missing whale artwork part: ${part}`);
    const animation = node.animate(frames.map(frame => ({ easing, ...frame })), { duration, fill: 'none' });
    animations.push(animation);
    /* Observe rejection immediately: a later part can fail to animate, in
       which case the already-created animations must still be cancelled. */
    const completion = animation.finished;
    void completion.catch(() => {});
    completions.push(completion);
  };

  try {
    if (reducedMotion) {
      animate('eye', [{ opacity: 0 }, { opacity: 0 }], 'linear', 200);
      animate('eye-shut', [{ opacity: 1 }, { opacity: 1 }], 'linear', 200);
    } else {
      animate('body', poses[reaction].map(([offset, x, y, angle, sx, sy]) => ({
        offset, transform: `translate(${x}px, ${y}px) rotate(${angle}deg) scale(${sx}, ${sy})`,
      })));
      if (reaction === 'hop') {
        animate('tail', [{ transform: 'translateY(0)' }, { transform: 'translateY(-2px)', offset: .3 },
          { transform: 'translateY(0)' }], 'steps(4, end)');
      } else if (reaction === 'spout') {
        animate('spout-stem', [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .23 },
          { opacity: 1, offset: .24 }, { opacity: 1, offset: .44 }, { opacity: 0, offset: .51 },
          { opacity: 0, offset: 1 }], 'steps(1, end)');
        const droplets = [['left', -5, 2], ['right', 5, 2], ['top', 0, -3]] as const;
        for (const [part, x, y] of droplets) {
          animate(`spout-${part}`, [
            { opacity: 0, transform: 'translate(0, 0)', offset: 0 },
            { opacity: 0, transform: 'translate(0, 0)', offset: .28 },
            { opacity: 1, transform: 'translate(0, 0)', offset: .3 },
            { opacity: 1, transform: `translate(${x}px, ${-4 + y}px)`, offset: .5 },
            { opacity: 1, transform: `translate(${x * 1.4}px, ${y}px)`, offset: .65 },
            { opacity: 0, transform: `translate(${x * 1.6}px, ${y + 3}px)`, offset: .76 },
            { opacity: 0, offset: 1 },
          ], 'steps(4, end)');
        }
      } else {
        animate('tail', [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-17deg)', offset: .2 },
          { transform: 'rotate(11deg)', offset: .4 }, { transform: 'rotate(-14deg)', offset: .6 },
          { transform: 'rotate(9deg)', offset: .8 }, { transform: 'rotate(0deg)' }], 'steps(3, end)');
        animate('fin', [{ transform: 'translateY(0)' }, { transform: 'translateY(-2px)', offset: .22 },
          { transform: 'translateY(0)', offset: .4 }, { transform: 'translateY(-1px)', offset: .6 },
          { transform: 'translateY(0)' }], 'steps(2, end)');
      }
      const blinkStart = reaction === 'spout' ? .23 : reaction === 'wag' ? .08 : .66;
      const blinkEnd = reaction === 'spout' ? .73 : reaction === 'wag' ? .3 : .83;
      animate('eye', [{ opacity: 1, offset: 0 }, { opacity: 0, offset: blinkStart },
        { opacity: 1, offset: blinkEnd }, { opacity: 1, offset: 1 }], 'steps(1, end)');
      animate('eye-shut', [{ opacity: 0, offset: 0 }, { opacity: 1, offset: blinkStart },
        { opacity: 0, offset: blinkEnd }, { opacity: 0, offset: 1 }], 'steps(1, end)');
    }
  } catch (error) {
    for (const animation of animations) animation.cancel();
    throw error;
  }

  return {
    finished: Promise.allSettled(completions).then(() => {}),
    cancel() { for (const animation of animations) animation.cancel(); },
  };
}
