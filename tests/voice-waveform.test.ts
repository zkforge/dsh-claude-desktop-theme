import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceVoiceWaveform, type VoiceWaveformHistory } from '../src/client/compat/voice-waveform.ts';

const history = (): VoiceWaveformHistory => ({ heights: Array<number>(18).fill(0), sampledAt: null });

test('a bar keeps its sampled height while moving smoothly left between samples', () => {
  const state = history();
  advanceVoiceWaveform(state, 0, 0);
  advanceVoiceWaveform(state, 100, 12);
  assert.equal(state.heights.at(-1), 6);
  assert.equal(advanceVoiceWaveform(state, 125, 0), 1.625);
  assert.equal(state.heights.at(-1), 6, 'new audio cannot resize an existing bar');
  assert.equal(advanceVoiceWaveform(state, 150, 17), 3.25);
  assert.equal(state.heights.at(-1), 6);
  advanceVoiceWaveform(state, 200, 0);
  assert.equal(state.heights.at(-2), 6, 'the bar moves one seat left with its height intact');
  assert.equal(state.heights.at(-1), 0);
});

test('sample-boundary translation is continuous as the oldest bar leaves', () => {
  const state = history();
  advanceVoiceWaveform(state, 0, 8);
  const before = advanceVoiceWaveform(state, 199.999, 8);
  const index = state.heights.length - 1;
  const beforeX = -3.25 + index * 6.5 - before;
  const after = advanceVoiceWaveform(state, 200, 0);
  const afterX = -3.25 + (index - 1) * 6.5 - after;
  assert.ok(Math.abs(beforeX - afterX) < 0.001);
});

test('silence remains dots and long frame gaps keep the history bounded', () => {
  const state = history();
  advanceVoiceWaveform(state, 0, 0);
  advanceVoiceWaveform(state, 100, 0);
  assert.deepEqual(state.heights, Array<number>(18).fill(0));
  advanceVoiceWaveform(state, 100000, 99);
  assert.equal(state.heights.length, 18);
  assert.ok(state.heights.every(height => height === 8.5));
  advanceVoiceWaveform(state, 100100, Number.NaN);
  assert.equal(state.heights.at(-1), 0);
});
