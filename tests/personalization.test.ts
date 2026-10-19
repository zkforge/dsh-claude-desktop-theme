import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Config } from '../src/host/index.ts';
import { adoptConfig, DEFAULT_PERSONALIZATION, resolveConfig } from '../src/shared/config.ts';
import { claudeGreeting, mountHeroGreeting } from '../src/client/compat/hero-greeting.ts';
import { claudePose, CLAUDE_REACTION_MS } from '../src/client/features/composer-pet/claude-motion.ts';
import { CLAUDE_IDLE, CLAUDE_TRACK, CLAUDE_FRAMES } from '../src/client/features/composer-pet/claude-frames.ts';

test('existing installs keep their whale and native greeting; choices are independent', () => {
  assert.deepEqual(adoptConfig({}).personalization, DEFAULT_PERSONALIZATION);
  assert.deepEqual(resolveConfig({ personalization: { petStyle: 'claude' } }).personalization,
    { petStyle: 'claude', greetingStyle: 'explore', greetingName: '' });
  assert.deepEqual(adoptConfig({ personalization: {
    greetingStyle: 'claude', greetingName: '  Kai\n  Zou  ',
  } }).personalization, { petStyle: 'whale', greetingStyle: 'claude', greetingName: 'Kai Zou' });
});

test('invalid stored variants fall back, strict writes are rejected', () => {
  assert.deepEqual(adoptConfig({ personalization: {
    petStyle: 'unknown', greetingStyle: false, greetingName: 1,
  } }).personalization, DEFAULT_PERSONALIZATION);
  assert.throws(() => resolveConfig({ personalization: { petStyle: 'unknown' } }), /petStyle/);
  assert.throws(() => resolveConfig({ personalization: { greetingStyle: 'unknown' } }), /greetingStyle/);
  const schema = Config as unknown as (input: unknown) => unknown;
  assert.doesNotThrow(() => schema({ personalization: { petStyle: 'claude', greetingStyle: 'claude', greetingName: 'Kai' } }));
  assert.throws(() => schema({ personalization: { petStyle: 'unknown' } }), /petStyle/);
  assert.throws(() => schema({ personalization: { greetingName: 'x'.repeat(65) } }), /greetingName/);
  assert.equal(adoptConfig({ personalization: { greetingName: 'x'.repeat(100) } }).personalization.greetingName.length, 64);
});

test('the click sequence returns to idle and reduced motion never plays the laptop poses', () => {
  assert.equal(claudePose(0), null);
  assert.equal(claudePose(249), null);
  assert.equal(claudePose(250), CLAUDE_FRAMES[CLAUDE_TRACK[0]!]);
  assert.equal(claudePose(300), CLAUDE_FRAMES[CLAUDE_TRACK[1]!]);
  assert.equal(claudePose(CLAUDE_REACTION_MS - 1), CLAUDE_FRAMES[CLAUDE_TRACK.at(-1)!]);
  assert.equal(claudePose(CLAUDE_REACTION_MS), null);
  for (let time = 0; time < CLAUDE_REACTION_MS; time += 50) assert.equal(claudePose(time, true), null);
  assert.ok(CLAUDE_FRAMES.some(frame => frame[3] !== ''), 'the recording includes the laptop');
});

test('greeting is optional personalization and original heading nodes survive mounting and release', () => {
  assert.equal(claudeGreeting(''), 'What’s up next?');
  assert.equal(claudeGreeting('zoukai'), 'What’s up next, zoukai?');
  class Element {
    isConnected = true;
    children: Element[] = [];
    parent: Element | null = null;
    textContent = '';
    attributes = new Map<string, string>();
    append(...nodes: Element[]) { nodes.forEach(node => { node.parent = this; this.children.push(node); }); }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
      this.parent = null;
    }
  }
  const heading = new Element();
  const originalText = new Element(); originalText.textContent = '探索未知之境';
  heading.append(originalText);
  let signedOut = false;
  let label: { textContent: string } | null = { textContent: '  zoukai  ' };
  const account = {
    getAttribute: () => String(signedOut),
    querySelector: () => label,
  };
  const document = {
    body: {}, documentElement: { lang: 'zh-CN' }, querySelectorAll: () => [heading],
    querySelector: (selector: string) => selector === '.ZogL4G_trigger' ? account : null,
    createElement: () => new Element(), createElementNS: () => new Element(),
  } as unknown as Document;
  const original = globalThis.MutationObserver;
  let sync: () => void = () => {};
  let disconnected = false;
  globalThis.MutationObserver = class {
    constructor(callback: () => void) { sync = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  } as unknown as typeof MutationObserver;
  try {
    const release = mountHeroGreeting(document, { ...DEFAULT_PERSONALIZATION, greetingStyle: 'claude', greetingName: '<Kai>' });
    sync();
    assert.equal(heading.children.length, 2, 'repeated mutations add no duplicate heading');
    assert.equal(heading.children[0], originalText);
    assert.equal(heading.children[1]?.children[1]?.textContent, 'What’s up next, <Kai>?');
    release();
    assert.deepEqual(heading.children, [originalText]);
    assert.equal(heading.attributes.has('data-ccd-greeting-style'), false);
    assert.equal(disconnected, true);
    const releaseAccount = mountHeroGreeting(document, { ...DEFAULT_PERSONALIZATION, greetingStyle: 'claude' });
    const title = () => heading.children[1]?.children[1]?.textContent;
    assert.equal(title(), 'What’s up next, zoukai?', 'Latin account name uses English even in a Chinese app');
    label = { textContent: '张三' };
    sync();
    assert.equal(title(), '接下来想做什么，张三？', 'a changed Chinese name updates the existing title');
    label = null;
    sync();
    assert.equal(title(), '接下来想做什么，张三？', 'collapsing the sidebar retains the name');
    signedOut = true;
    sync();
    assert.equal(title(), '接下来想做什么？', 'sign-out clears the cached account name');
    signedOut = false;
    label = { textContent: '' };
    sync();
    assert.equal(title(), '接下来想做什么？', 'a loading profile does not show an old account name');
    label.textContent = 'Alice';
    sync();
    assert.equal(title(), 'What’s up next, Alice?', 'late profile text updates without reopening the page');
    releaseAccount();
  } finally { globalThis.MutationObserver = original; }
});

/** Sample the exported pixel rectangles; the expected gaps come from the reference. */
function inkAt(path: string, x: number, y: number): boolean {
  return [...path.matchAll(/M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v([\d.]+)h-[\d.]+Z/gu)]
    .some(([, left, top, width, height]) => x >= Number(left) && x < Number(left) + Number(width)
      && y >= Number(top) && y < Number(top) + Number(height));
}

test('recorded standing pose keeps the gaps between all four feet transparent', () => {
  const pose = CLAUDE_FRAMES[CLAUDE_TRACK[0]!]!;
  for (const x of [9, 16, 24]) {
    assert.equal(inkAt(pose[0]!, x, 22) || inkAt(pose[1]!, x, 22), false,
      `the exterior gap at ${x},22 must not be filled as a body pinhole`);
  }
});


test('idle mark matches the reference width, feet spacing and two black eyes', () => {
  const body = CLAUDE_IDLE[0]!;
  const eyes = CLAUDE_IDLE[2]!;
  assert.equal(inkAt(body, 28.75, 1), true);
  assert.equal(inkAt(body, 29.25, 1), false, 'the body ends at 29, not 30');
  for (const x of [7, 13, 22, 28]) assert.equal(inkAt(body, x, 22), true);
  for (const x of [10, 17, 25]) assert.equal(inkAt(body, x, 22), false);
  assert.equal(inkAt(body, 7, 23.75), false, 'the reference is 23.5px tall');
  assert.equal(inkAt(eyes, 10, 4), true);
  assert.equal(inkAt(eyes, 24, 4), true);
  assert.equal(inkAt(eyes, 11.75, 4), true, 'the left eye grows inward to 3px');
  assert.equal(inkAt(eyes, 23.25, 4), true, 'the right eye grows inward to 3px');
  assert.equal(inkAt(eyes, 12.25, 4), false, 'the middle gap stays clear');
});


test('greeting language follows the name, falling back to the document language without a name', () => {
  assert.equal(claudeGreeting('Alice', 'zh-CN'), 'What’s up next, Alice?');
  assert.equal(claudeGreeting('李明', 'en'), '接下来想做什么，李明？');
  assert.equal(claudeGreeting('Kai 张', 'en'), '接下来想做什么，Kai 张？');
  assert.equal(claudeGreeting('', 'zh-CN'), '接下来想做什么？');
  assert.equal(claudeGreeting('', 'en'), 'What’s up next?');
});

test('retrieving the laptop keeps all four upright feet at the idle anchors', () => {
  for (const frame of [...Array.from({ length: 13 }, (_, i) => i), 50, 51, 52, 53, 54, 55, 56]) {
    const pose = CLAUDE_FRAMES[CLAUDE_TRACK[frame]!]!;
    for (let y = 17.5; y < 24; y += 0.5) {
      for (let x = 0; x < 35; x += 0.5) {
        assert.equal(inkAt(pose[0]!, x, y) || inkAt(pose[1]!, x, y), inkAt(CLAUDE_IDLE[0]!, x, y),
          `frame ${frame}: foot at ${x},${y} moved during the upright phase`);
      }
    }
  }
});

test('typing keeps the projected foot positions while the near hand is free to move', () => {
  const reference = CLAUDE_FRAMES[CLAUDE_TRACK[25]!]!;
  for (let frame = 18; frame < 46; frame++) {
    const pose = CLAUDE_FRAMES[CLAUDE_TRACK[frame]!]!;
    for (let y = 18; y < 24; y++) {
      for (let x = y < 20 ? 8 : 3; x < 35; x++) {
        assert.equal(inkAt(pose[0]!, x, y) || inkAt(pose[1]!, x, y),
          inkAt(reference[0]!, x, y) || inkAt(reference[1]!, x, y), `frame ${frame}: a planted foot moved`);
      }
    }
  }
});

test('eye edges never expose an old transparent cutout in a recorded face', () => {
  for (const [frame, pose] of CLAUDE_FRAMES.entries()) {
    const eyes = [...pose[2]!.matchAll(/M(-?[\d.]+) (-?[\d.]+)h([\d.]+)v([\d.]+)h-[\d.]+Z/gu)];
    for (const [, left, top, width, height] of eyes) {
      for (let y = Number(top); y < Number(top) + Number(height); y++) {
        const face = (x: number) => inkAt(pose[0]!, x, y) || inkAt(pose[1]!, x, y);
        for (let x = Number(left) - 1; x < Number(left) + Number(width) + 1; x++) {
          if (inkAt(pose[2]!, x, y)) {
            assert.equal(face(x), true, `frame ${frame}: the face needs paint behind eye ${x},${y}`);
            continue;
          }
          const occupied = (at: number) => face(at) || inkAt(pose[2]!, at, y);
          const before = Array.from({ length: 40 }, (_, step) => x - step - 1).some(occupied);
          const after = Array.from({ length: 40 }, (_, step) => x + step + 1).some(occupied);
          if (before && after) assert.equal(face(x), true, `frame ${frame}: old eye cutout at ${x},${y}`);
        }
      }
    }
  }
});
