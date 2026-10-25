import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLAUDE_FRAMES, CLAUDE_GROUND_Y, CLAUDE_IDLE, CLAUDE_TRACK } from '../src/client/features/composer-pet/claude-frames.ts';

/** Rasterize the half-pixel rectangles so checks cover visible geometry. */
function pixels(path: string): Set<string> {
  const result = new Set<string>();
  const rectangles = path.matchAll(/M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v([\d.]+)h(-[\d.]+)Z/g);
  let parsed = '';
  for (const match of rectangles) {
    parsed += match[0];
    const [left, top, width, height, closing] = match.slice(1).map(Number) as [number, number, number, number, number];
    assert.equal(width + closing, 0, 'each contour rectangle closes');
    for (const value of [left, top, width, height]) assert.ok(Number.isInteger(value * 2), 'keep the reference half-pixel grid');
    for (let y = top * 2; y < (top + height) * 2; y++) {
      for (let x = left * 2; x < (left + width) * 2; x++) result.add(`${x},${y}`);
    }
  }
  assert.equal(parsed, path, 'every drawing command was rasterized');
  return result;
}

function neighbors(key: string): string[] {
  const [x, y] = key.split(',').map(Number) as [number, number];
  return [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`];
}

function assertConnected(mask: Set<string>, message: string) {
  const unseen = new Set(mask);
  const pending = [unseen.values().next().value!];
  unseen.delete(pending[0]!);
  while (pending.length > 0) {
    for (const key of neighbors(pending.pop()!)) {
      if (unseen.delete(key)) pending.push(key);
    }
  }
  assert.equal(unseen.size, 0, message);
}

test('every pose keeps the body connected and all four feet on the same ground', () => {
  for (const [index, pose] of [CLAUDE_IDLE, ...CLAUDE_FRAMES].entries()) {
    const body = pixels(pose[0]);
    assertConnected(body, `pose ${index}: no detached feet or body fragments`);

    const ground = [...body].filter(key => Number(key.split(',')[1]) === CLAUDE_GROUND_Y * 2 - 1)
      .map(key => Number(key.split(',')[0])).filter(x => x >= 8 && x < 64).sort((a, b) => a - b);
    // The near hand can touch the ground to the left of the four feet.
    const contacts = ground.filter((x, i) => i === 0 || x !== ground[i - 1]! + 1);
    assert.equal(contacts.length, 4, `pose ${index}: four separate foot contacts`);
    for (const start of contacts) {
      let width = 0;
      while (ground.includes(start + width)) width++;
      assert.equal(width, 6, `pose ${index}: no narrowed foot tips or half-pixel nicks`);
    }
    const bottom = Math.max(...[...body].map(key => Number(key.split(',')[1]))) + 1;
    assert.equal(bottom / 2, CLAUDE_GROUND_Y, `pose ${index}: no floating or sinking`);
  }
});

test('recording fringes cannot become grey artwork on the body or feet', () => {
  for (const [index, pose] of [CLAUDE_IDLE, ...CLAUDE_FRAMES].entries()) {
    assert.equal(pose.length, 4, 'only body, intentional shade, eyes and laptop are painted');
    for (const key of pixels(pose[3])) {
      const x = Number(key.split(',')[0]);
      assert.ok(x < 12, `pose ${index}: the laptop layer must not carry grey body or leg edges`);
    }
  }
});

test('typing overlaps square hands within one hand’s width and alternates their strokes', () => {
  const strokes: number[] = [];
  const sequence = CLAUDE_TRACK.slice(16, 46).map(index => CLAUDE_FRAMES[index]!);
  for (const pose of sequence) {
    const body = [...pixels(pose[0])].map(key => key.split(',').map(Number) as [number, number]);
    const shade = pixels(pose[1]);
    const hands = body.filter(([x]) => x < 6);
    const nearHand = hands.filter(([x, y]) => !shade.has(`${x},${y}`));
    const farEdge = hands.filter(([x]) => x < -3);
    const xs = hands.map(([x]) => x);
    assert.equal(Math.min(...xs), -6, 'both hands stay directly in front of the body');
    assert.equal(Math.max(...xs) - Math.min(...xs) + 1, 12, 'overlapping hands occupy only 6px outside the body');
    const nearTop = Math.min(...nearHand.map(([, y]) => y));
    const nearBottom = Math.max(...nearHand.map(([, y]) => y)) + 1;
    assert.equal(nearBottom - nearTop, 12, 'the front hand remains a 6px square');
    assert.equal(nearHand.length, 9 * 12, 'the front square exposes 4.5px beside the body without rear shading');
    const farTop = Math.min(...farEdge.map(([, y]) => y));
    const farBottom = Math.max(...farEdge.map(([, y]) => y)) + 1;
    assert.equal(farBottom - farTop, 12, 'the rear square keeps its height through the longer stroke');
    assert.equal(farEdge.length, 3 * 12, 'the hands are staggered horizontally by only 1.5px');
    for (const [x, y] of farEdge) assert.ok(shade.has(`${x},${y}`), 'the exposed rear edge keeps its depth shading');
    const stroke = Math.sign(farTop - nearTop);
    if (stroke !== 0 && stroke !== strokes.at(-1)) strokes.push(stroke);
    assert.equal(pose[3], sequence[0]![3], 'the keyboard stays still beneath the hands');
  }
  assert.deepEqual(strokes, [1, -1, 1, -1, 1, -1, 1, -1, 1, -1], 'the hands take turns pressing');
});

test('the laptop keeps a continuous edge when it is folded back against the hand', () => {
  const returning = [...CLAUDE_FRAMES].reverse().find(pose => pose[3] !== '')!;
  const laptop = pixels(returning[3]);
  assert.ok(laptop.size > 0);
  assertConnected(laptop, 'the returning laptop must not break into isolated grey strips');
});

test('eyes and shading stay on a complete body, and every pose fits the seated viewBox', () => {
  for (const [index, pose] of [CLAUDE_IDLE, ...CLAUDE_FRAMES].entries()) {
    const body = pixels(pose[0]);
    for (const layer of [pose[1], pose[2]]) {
      for (const key of pixels(layer)) assert.ok(body.has(key), `pose ${index}: a detail cannot become a detached fragment`);
    }
    for (const layer of pose) {
      for (const key of pixels(layer)) {
        const [x, y] = key.split(',').map(Number) as [number, number];
        assert.ok(x >= -30 && x < 74 && y + 1 >= -26 && y + 1 < 48, `pose ${index}: no clipping after seating`);
      }
    }
  }
});
