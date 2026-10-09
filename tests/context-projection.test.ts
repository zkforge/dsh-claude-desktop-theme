import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONTEXT_KEY, CONTEXT_STATE_VERSION, contextBreakdown, emptyContextView, formatPercent,
  formatTokens, readContextView, shortenPath, toolLabel,
} from '../src/shared/context.ts';
import {
  KIND_INSTRUCTIONS, applyContextEvent, createContextProjection, initContextState, viewContext,
} from '../src/host/context/unit.ts';
import { readCompactionPolicy } from '../src/host/context/compaction.ts';
import type { PricedEvent } from '../src/host/context/pricing.ts';

/*
 * The `ccdContext` projection unit's contract with the host's registry.
 *
 * The fold itself is priced and pinned in `context-pricing.test.ts`; what this
 * file pins is the unit as a registry citizen: the key it claims, the version
 * that invalidates a persisted row, the publication rule (`Object.is` over the
 * view — one object per state), the schema slots the registry calls, and the
 * policy read behind the autocompaction row.
 */

/** One `request/header`, as the fold sees it. */
function header(tools: readonly { readonly name: string }[], maxTokens?: number): PricedEvent {
  return {
    type: 'request/header',
    seq: 1,
    data: { header: { tools, config: maxTokens === undefined ? {} : { maxTokens } } },
  } as unknown as PricedEvent;
}

/** One instruction message. */
function instructions(seq: number, path: string, body: string): PricedEvent {
  return {
    type: 'user/message',
    seq,
    surfaceOp: 'append',
    data: {
      content: [{ type: 'text', text: `Instructions from: ${path}\n${body}` }],
      source: { kind: 'agent-instructions', changes: [{ action: 'set', path }] },
    },
  };
}

test('the unit claims this plugin’s key and a version of its own', () => {
  const unit = createContextProjection(() => null);
  assert.equal(unit.key, CONTEXT_KEY);
  assert.equal(unit.key, 'ccdContext');
  assert.equal(unit.stateVersion, CONTEXT_STATE_VERSION);
  assert.equal(unit.stateVersion, 1);
  /* A key this plugin owns must not collide with a host unit's. */
  assert.notEqual(unit.key, 'contextBreakdown');
  assert.notEqual(unit.key, 'contextPressure');
});

test('a fresh fold is empty, and the inherited prefix is not skipped', () => {
  const state = initContextState();
  assert.deepEqual(state.nodes, []);
  assert.deepEqual(state.tools, []);
  assert.equal(state.window, 0);
  assert.equal(state.reserved, null);
  /* A fork's log carries its seed, and the host's own breakdown fold counts it:
     the child's surface *is* the parent's plus its own events, so this unit
     must not skip the prefix the way a usage counter does. */
  const unit = createContextProjection(() => null);
  assert.deepEqual(unit.init({} as never, 0 as never), state);
  const seeded = applyContextEvent(state, instructions(2, 'AGENTS.md', 'a'.repeat(40)));
  assert.equal(seeded.nodes.length, 1);
});

test('the wire view is one object per state, so the registry can compare it', () => {
  const unit = createContextProjection(() => null);
  let state = initContextState();
  state = applyContextEvent(state, instructions(9, 'AGENTS.md', 'a'.repeat(40)));
  const first = unit.wire.view(state);
  assert.equal(unit.wire.view(state), first, 'an unchanged state reuses its view reference');
  const next = applyContextEvent(state, instructions(11, 'docs/X.md', 'b'.repeat(40)));
  assert.notEqual(unit.wire.view(next), first, 'a changed state publishes a new value');
  assert.equal(unit.wire.view(next), unit.wire.view(next));
});

test('the schema slots accept what the unit produces and refuse nothing loudly', () => {
  const unit = createContextProjection(() => null);
  let state = initContextState();
  state = applyContextEvent(state, header([{ name: 'bash' }], 4096));
  state = applyContextEvent(state, instructions(9, 'AGENTS.md', 'a'.repeat(40)));
  assert.deepEqual(unit.stateSchema.parse(JSON.parse(JSON.stringify(state))), state);
  const view = unit.wire.view(state);
  assert.deepEqual(unit.wire.viewSchema.parse(JSON.parse(JSON.stringify(view))), view);
  /* A row from another state version, or a hand-edited one, reads as far as it
     can and never throws into the host's session list. */
  assert.deepEqual(unit.stateSchema.parse('not a state').nodes, []);
  assert.deepEqual(unit.wire.viewSchema.parse(7), emptyContextView());
});

test('the autocompaction row is the policy the deployment actually runs', () => {
  const unit = createContextProjection(() => ({ ratio: 0.8, headroom: 65536 }));
  let state = initContextState();
  state = applyContextEvent(state, header([{ name: 'bash' }], 32000));
  state = applyContextEvent(state, { type: 'request/context', seq: 2, data: { contextWindow: 1000000 } } as unknown as PricedEvent);
  /* min(1,000,000 × 0.8, 1,000,000 − 32,000 − 65,536) = 800,000. */
  assert.equal(unit.wire.view(state).compaction, 800000);
  /* A route that declares no output cap leaves the reservation unknown, and the
     row is left out rather than guessed at. */
  const withoutCap = applyContextEvent(state, header([{ name: 'bash' }]));
  assert.equal(unit.wire.view(withoutCap).compaction, null);
});

test('the deployment’s compaction policy is read from the loader’s own entries', () => {
  const policy = (entries: readonly unknown[]): unknown =>
    readCompactionPolicy({ get: (name: string) => (name === 'loader' ? { entries: () => entries } : undefined) } as never);
  assert.equal(policy([]), null, 'no entry means no row');
  assert.equal(policy([{ id: 'compaction-basic', disabled: true, options: { name: '@deepseek-ai/dsh-compaction-basic' } }]), null,
    'a disabled backend compacts nothing — this plugin’s own machine is exactly this case');
  assert.deepEqual(
    policy([{ id: 'compaction-basic', options: { name: '@deepseek-ai/dsh-compaction-basic' } }]),
    { ratio: 0.8, headroom: 65536 },
    'an enabled backend on its defaults',
  );
  assert.deepEqual(
    policy([
      { id: 'compaction-basic', options: { name: '@deepseek-ai/dsh-compaction-basic' } },
      { id: 'compaction-tuned', options: { name: '@acme/compaction', config: { thresholdRatio: 0.6, headroomTokens: 1024 } } },
    ]),
    { ratio: 0.6, headroom: 1024 },
    'the last declaration in the tree is the effective one',
  );
  assert.equal(policy([{ id: 'other', options: { name: '@deepseek-ai/dsh-token-meter' } }]), null);
  assert.equal(
    readCompactionPolicy({ get: () => undefined } as never), null,
    'a deployment with no loader keeps the row out',
  );
  assert.equal(
    readCompactionPolicy({ get: () => ({ entries: () => { throw new Error('unreadable'); } }) } as never), null,
    'a loader that cannot be walked is a policy nobody can read',
  );
});

test('the panel’s numbers read the way the reference writes them', () => {
  /* One decimal, trailing `.0` dropped: the host's own formatter rounds to a
     whole number above 100 and would print `217k` where the reference prints
     `216.7k`. */
  for (const [value, expected] of [
    [0, '0'], [342, '342'], [999, '999'], [1000, '1k'], [1200, '1.2k'], [4600, '4.6k'],
    [48000, '48k'], [89000, '89k'], [216700, '216.7k'], [878000, '878k'],
    [1000000, '1M'], [1200000, '1.2M'], [126011, '126k'],
  ] as const) assert.equal(formatTokens(value), expected, String(value));
  assert.equal(formatPercent(48000, 1000000), '4.8%');
  assert.equal(formatPercent(342, 1000000), '0.0%');
  assert.equal(formatPercent(878000, 1000000), '87.8%');
  assert.equal(formatPercent(1, 0), '0.0%');
  assert.equal(shortenPath('AGENTS.md'), 'AGENTS.md');
  assert.equal(shortenPath('/Users/zoukai/code/dsh-ccd-style/AGENTS.md', 24), '/Users/zoukai/…AGENTS.md');
  assert.equal(shortenPath('/Users/zoukai/code/dsh-ccd-style/AGENTS.md'), '/Users/zoukai/code/…le/AGENTS.md');
  assert.equal(toolLabel('mcp__ccd__read_file'), 'ccd · read_file');
  assert.equal(toolLabel('bash'), 'bash');
  assert.equal(toolLabel('mcp__broken'), 'broken');
});

test('the shared arithmetic turns the host’s numbers into the panel’s rows', () => {
  /* The real session this panel was designed against: the host's own persisted
     breakdown, its own pressure, and this plugin's two re-derived shares. */
  const breakdown = contextBreakdown({
    window: 1000000,
    used: 121632,
    systemTokens: 1953,
    toolsTokens: 7492,
    tools: [['bash', 561], ['mcp__ccd__read', 4000]],
    messageTokens: 93461,
    skillTokens: 438,
    fileTokens: 361,
    compaction: null,
  });
  const tokens = (key: string) => breakdown.slices.find(entry => entry.key === key)?.tokens;
  assert.equal(breakdown.percent, 12, 'the ring’s own rounded reading');
  assert.equal(tokens('system'), 1953);
  assert.equal((tokens('mcp') ?? 0) + (tokens('tools') ?? 0), 7492, 'the two tool rows sum to the host’s own total');
  assert.equal(tokens('skills'), 438);
  assert.equal(tokens('memory'), 361);
  assert.equal(tokens('messages'), 93461 - 438 - 361);
  /* Rows plus free space come to the window minus the drift, and the drift is
     the difference between the sampled reading and the heuristic tree. */
  assert.equal(breakdown.residual, 121632 - (1953 + 7492 + 93461));
  const total = breakdown.slices.reduce((sum, entry) => sum + entry.tokens, 0);
  assert.equal(total, 1000000 - breakdown.residual);
  assert.equal(tokens('free'), 1000000 - 121632);
  assert.equal(breakdown.segments.some(entry => entry.key === 'free'), false, 'free space is the track, not a segment');
});

test('a session with nothing to say draws an empty reading rather than zeros', () => {
  const breakdown = contextBreakdown({
    window: 0, used: 0, systemTokens: 0, toolsTokens: 0, messageTokens: 0,
    skillTokens: 0, fileTokens: 0, compaction: null,
  });
  assert.equal(breakdown.window, 0);
  assert.equal(breakdown.percent, 0);
  assert.deepEqual(breakdown.slices, [], 'a zero row is not drawn');
  assert.deepEqual(breakdown.segments, []);
});

test('the view the fold produces feeds the shared arithmetic unchanged', () => {
  let state = initContextState();
  state = applyContextEvent(state, header([{ name: 'bash' }, { name: 'mcp__ccd__read' }]));
  state = applyContextEvent(state, instructions(9, 'AGENTS.md', 'a'.repeat(400)));
  const view = viewContext(state, null);
  assert.equal(state.nodes[0]?.[2], KIND_INSTRUCTIONS);
  assert.deepEqual(view.files, [['AGENTS.md', state.nodes[0]?.[1]]]);
  /* What the driver hands the card is the same shape the card's arithmetic
     takes, and `readContextView` is the one reader both halves use. */
  assert.deepEqual(readContextView(JSON.parse(JSON.stringify(view))), view);
});
