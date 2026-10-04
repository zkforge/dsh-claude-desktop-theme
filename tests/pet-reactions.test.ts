import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickPetReaction, playPetReaction } from '../src/client/features/composer-pet/reactions.ts';
import type { PetReaction } from '../src/client/features/composer-pet/reactions.ts';

function artwork(options: { missing?: string; fails?: string } = {}) {
  const frames: { part: string; keyframes: Keyframe[]; options: KeyframeAnimationOptions }[] = [];
  const pending: { finish(): void; cancel(): void }[] = [];
  let cancelled = 0;
  const art = {
    querySelector(selector: string) {
      const part = selector.replace('.ccd-pet-', '');
      if (part === options.missing) return null;
      return {
        animate(keyframes: Keyframe[], timing: KeyframeAnimationOptions) {
          if (part === options.fails) throw new Error('animation unavailable');
          let resolve: (animation: Animation) => void = () => {};
          let reject: (error: Error) => void = () => {};
          const finished = new Promise<Animation>((yes, no) => { resolve = yes; reject = no; });
          const animation = { finished, cancel() { cancelled++; reject(new Error('cancelled')); } } as Animation;
          frames.push({ part, keyframes, options: timing });
          pending.push({ finish() { resolve(animation); }, cancel() { animation.cancel(); } });
          return animation;
        },
      };
    },
  } as unknown as SVGSVGElement;
  return { art, frames, pending, get cancelled() { return cancelled; } };
}

test('one random draw chooses one of the three equal probability intervals', () => {
  for (const [draw, expected] of [[0, 'spout'], [1 / 3 - Number.EPSILON, 'spout'],
    [1 / 3, 'hop'], [2 / 3 - Number.EPSILON, 'hop'], [2 / 3, 'wag'], [1 - Number.EPSILON, 'wag']] as const) {
    let draws = 0;
    assert.equal(pickPetReaction(() => { draws++; return draw; }), expected);
    assert.equal(draws, 1);
  }
});

test('a reaction stays busy until every body and facial animation completes', async () => {
  for (const reaction of ['spout', 'hop', 'wag'] as const) {
    const f = artwork();
    const playback = playPetReaction(f.art, reaction, false);
    let finished = false;
    void playback.finished.then(() => { finished = true; });
    assert.ok(f.pending.length > 1);
    for (const animation of f.pending.slice(0, -1)) animation.finish();
    await Promise.resolve();
    assert.equal(finished, false, reaction);
    f.pending.at(-1)?.finish();
    await playback.finished;
    assert.equal(finished, true, reaction);
    assert.ok(f.frames.every(frame => frame.options.fill === 'none'), 'completion restores the idle artwork');
  }
});

test('cancellation releases every animated part and resolves completion without a rejection', async () => {
  const f = artwork();
  const playback = playPetReaction(f.art, 'spout', false);
  playback.cancel();
  await playback.finished;
  assert.equal(f.cancelled, f.pending.length);
});

test('reduced motion gives only a short closed-eye response, with no body or water movement', async () => {
  for (const reaction of ['spout', 'hop', 'wag'] satisfies PetReaction[]) {
    const f = artwork();
    const playback = playPetReaction(f.art, reaction, true);
    assert.deepEqual(f.frames.map(frame => frame.part), ['eye', 'eye-shut']);
    assert.ok(f.frames.every(frame => frame.options.duration === 200));
    assert.ok(f.frames.every(frame => frame.keyframes.every(keyframe => keyframe.transform === undefined)));
    f.pending.forEach(animation => animation.finish());
    await playback.finished;
  }
});

test('partial animation failures cancel every part already acquired', async () => {
  for (const options of [{ missing: 'fin' }, { fails: 'fin' }]) {
    const f = artwork(options);
    assert.throws(() => playPetReaction(f.art, 'wag', false));
    assert.ok(f.pending.length > 0);
    assert.equal(f.cancelled, f.pending.length);
    await Promise.resolve();
  }
});
