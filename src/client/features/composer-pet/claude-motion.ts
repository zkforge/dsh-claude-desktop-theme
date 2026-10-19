import { CLAUDE_FRAMES, CLAUDE_TRACK } from './claude-frames.ts';

export const CLAUDE_REACTION_MS = 250 + CLAUDE_TRACK.length * 50;

/** Each recorded pose lasts 50ms; null restores the static mark after playback. */
export function claudePose(elapsed: number, reducedMotion = false): readonly string[] | null {
  if (reducedMotion || elapsed < 250 || elapsed >= CLAUDE_REACTION_MS) return null;
  return CLAUDE_FRAMES[CLAUDE_TRACK[Math.floor((elapsed - 250) / 50)] ?? 0] ?? null;
}
