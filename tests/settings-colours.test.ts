import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colourToHSV, hsvToColour } from '../src/client/features/settings/colours.ts';

test('the picker preserves primary, grey, default and arbitrary hex colours', () => {
  for (const colour of ['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#808080', '#FCFCFB', '#DA7756', '#123456']) {
    assert.equal(hsvToColour(colourToHSV(colour)), colour);
  }
});

test('the picker expands shorthand and falls back to the default for invalid input', () => {
  assert.equal(hsvToColour(colourToHSV('#abc')), '#AABBCC');
  assert.equal(hsvToColour(colourToHSV('')), '#FCFCFB');
  assert.equal(hsvToColour(colourToHSV('red')), '#FCFCFB');
});

test('the hue strip wraps red and the plane reaches white and black at its edges', () => {
  assert.equal(hsvToColour({ h: 360, s: 1, v: 1 }), '#FF0000');
  assert.equal(hsvToColour({ h: 240, s: 0, v: 1 }), '#FFFFFF');
  assert.equal(hsvToColour({ h: 120, s: 1, v: 0 }), '#000000');
});
