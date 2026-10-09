import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allocate, derivedMessage, isSurfaceEvent, priceContent, priceMessage, priceTool, priceTools,
} from '../src/host/context/pricing.ts';
import {
  KIND_INSTRUCTIONS, KIND_SKILLS, applyContextEvent, initContextState, instructionEntries,
  readContextState, readContextView, skillEntries, viewContext,
} from '../src/host/context/unit.ts';
import type { PricedEvent } from '../src/host/context/pricing.ts';

/*
 * The context fold's contract.
 *
 * `contextBreakdown` publishes three numbers and nothing about what is inside
 * them, so this unit re-derives the parts the host cannot name: which tool,
 * which instruction file, which skill. Two facts carry the whole design — the
 * per-message price must be the host's own heuristic to the token (four
 * characters per token, four tokens per block and per message), and the surface
 * must honour `surfaceOp` replacements exactly, because a compaction shadows a
 * range rather than appending to it.
 *
 * The fold was checked against a real 19 MB session log while it was written:
 * it reproduced the host's persisted `{systemTokens: 1953, toolsTokens: 7492,
 * messageTokens: 93461}` exactly. The fixture below is that log's *shape*, with
 * the numbers worked out by hand so the check runs anywhere.
 */

/** One `user/message` carrying a structured source, the way DSH writes them. */
function instruction(seq: number, path: string, body: string, extra?: PricedEvent): PricedEvent {
  return {
    type: 'user/message',
    seq,
    surfaceOp: 'append',
    data: {
      content: [{ type: 'text', text: `<system-reminder>\nInstructions from: ${path}\n${body}\n</system-reminder>` }],
      source: { kind: 'agent-instructions', changes: [{ action: 'set', path }] },
      ...(extra?.data ?? {}),
    },
  };
}

test('the pricing heuristic is the host’s own', () => {
  assert.equal(priceContent([{ type: 'text', text: 'x'.repeat(8) }]), 2 + 4);
  assert.equal(priceContent([{ type: 'reasoning', text: 'x'.repeat(9) }]), 3 + 4);
  assert.equal(priceContent([{ type: 'tool-call', name: 'bash', arguments: '{}' }]), 1 + 1 + 4);
  assert.equal(priceContent([]), 0);
  /* An untyped block is priced from its JSON structure plus the same overhead. */
  assert.equal(priceContent([{ type: 'image', source: {} }]), 4 + Math.ceil(JSON.stringify({ type: 'image', source: {} }).length / 4));
  /* Role framing is one extra block's worth, on every non-system message. */
  assert.equal(priceMessage({ role: 'user', content: [{ type: 'text', text: 'x'.repeat(8) }] }), 2 + 4 + 4);
  /* A system prompt is a plain string: text density and framing, no block overhead. */
  assert.equal(priceMessage({ role: 'system', content: [{ type: 'text', text: 'x'.repeat(8) }] }), 2 + 4);
  assert.equal(priceMessage({ role: 'system', content: [] }), 0);
  assert.equal(priceMessage(null), 0);
});

test('the tool array is priced whole, exactly as the host prices it', () => {
  const tools = [{ name: 'bash' }, { name: 'edit' }];
  assert.equal(priceTools(tools), Math.ceil(JSON.stringify(tools).length / 4) + 4);
  assert.equal(priceTools([]), 0);
  assert.equal(priceTools(undefined), 0);
  /* Per-tool prices are the entry alone; they never add back to the array. */
  assert.equal(priceTool({ name: 'bash' }), Math.ceil(JSON.stringify({ name: 'bash' }).length / 4));
});

test('only a message-producing event with a placement joins the surface', () => {
  assert.equal(isSurfaceEvent({ type: 'user/message', seq: 1, surfaceOp: 'append' }), true);
  assert.equal(isSurfaceEvent({ type: 'tool/result', seq: 2, surfaceOp: { startSeq: 0, endSeq: 1 } }), true);
  assert.equal(isSurfaceEvent({ type: 'user/message', seq: 3 }), false);
  assert.equal(isSurfaceEvent({ type: 'turn/start', seq: 4, surfaceOp: 'append' }), false);
  assert.equal(derivedMessage({ type: 'request/header', seq: 5 }), null);
  assert.equal(derivedMessage({ type: 'assistant/message', seq: 6, data: { message: { content: [] } } }), null);
});

test('a total splits across weighted entries and never loses a token', () => {
  assert.deepEqual(allocate(100, [1, 1]), [50, 50]);
  assert.deepEqual(allocate(101, [1, 1]), [51, 50]);
  assert.deepEqual(allocate(10, [1, 2]), [3, 7]);
  assert.deepEqual(allocate(7, []), []);
  assert.deepEqual(allocate(5, [0, -1]), [3, 2], 'unusable weights fall back to one each');
  assert.equal(allocate(97, [3, 5, 11]).reduce((sum, part) => sum + part, 0), 97);
});

test('one instruction message splits across the files its changes name', () => {
  const event: PricedEvent = {
    type: 'user/message',
    seq: 9,
    surfaceOp: 'append',
    data: {
      content: [{
        type: 'text',
        text: 'preamble\nInstructions from: AGENTS.md\n' + 'a'.repeat(400)
          + '\nAdditional instructions from: docs/X.md\n' + 'b'.repeat(40) + '\n',
      }],
      source: {
        kind: 'agent-instructions',
        changes: [
          { action: 'set', path: 'AGENTS.md' },
          { action: 'set', path: 'docs/X.md' },
          { action: 'remove', path: 'gone.md' },
        ],
      },
    },
  };
  const tokens = priceMessage(derivedMessage(event));
  const entries = instructionEntries(event, tokens);
  assert.deepEqual(entries.map(([path]) => path), ['AGENTS.md', 'docs/X.md'], 'a removed file is not a row');
  assert.equal(entries.reduce((sum, [, priced]) => sum + priced, 0), tokens);
  assert.ok((entries[0]?.[1] ?? 0) > (entries[1]?.[1] ?? 0), 'the larger section takes the larger share');
});

test('an instruction message with no usable path contributes nothing', () => {
  const event: PricedEvent = {
    type: 'user/message',
    seq: 9,
    surfaceOp: 'append',
    data: { content: [{ type: 'text', text: 'hello' }], source: { kind: 'agent-instructions' } },
  };
  assert.deepEqual(instructionEntries(event, 9), []);
});

test('one skill catalog splits across the entries it lists', () => {
  const event: PricedEvent = {
    type: 'user/message',
    seq: 11,
    surfaceOp: 'append',
    data: {
      content: [{ type: 'text', text: 'x'.repeat(800) }],
      source: {
        kind: 'skill-catalog',
        entries: [
          { name: 'office-docx', description: 'y'.repeat(100) },
          { name: 'office-pptx', description: 'y'.repeat(20) },
          { name: 'office-pptx', description: 'y'.repeat(20) },
        ],
      },
    },
  };
  const tokens = priceMessage(derivedMessage(event));
  const entries = skillEntries(event, tokens);
  assert.deepEqual(entries.map(([name]) => name), ['office-docx', 'office-pptx'], 'a repeated skill is one row');
  assert.equal(entries.reduce((sum, [, priced]) => sum + priced, 0), tokens);
  assert.deepEqual(skillEntries({ type: 'user/message', seq: 1, data: {} }, 5), []);
});

test('the fold keeps the host’s own three numbers and names the two shares', () => {
  let state = initContextState();
  const header: PricedEvent = {
    type: 'request/header',
    seq: 1,
    data: { header: { tools: [{ name: 'bash' }, { name: 'mcp__ccd__read' }], config: { maxTokens: 32000 } } },
  } as unknown as PricedEvent;
  state = applyContextEvent(state, header);
  state = applyContextEvent(state, { type: 'request/context', seq: 2, data: { contextWindow: 1000000 } } as unknown as PricedEvent);
  const same = state;
  assert.equal(applyContextEvent(state, { type: 'turn/start', seq: 3 }), same, 'an unrelated event keeps the reference');
  assert.equal(applyContextEvent(state, header), same, 'a restated header keeps the reference');

  state = applyContextEvent(state, instruction(9, 'AGENTS.md', 'a'.repeat(400)));
  state = applyContextEvent(state, {
    type: 'user/message',
    seq: 11,
    surfaceOp: 'append',
    data: {
      content: [{ type: 'text', text: 'x'.repeat(800) }],
      source: { kind: 'skill-catalog', entries: [{ name: 'grilling', description: 'y'.repeat(50) }] },
    },
  });
  state = applyContextEvent(state, { type: 'user/message', seq: 12, surfaceOp: 'append', data: { content: [{ type: 'text', text: 'z'.repeat(40) }], source: { kind: 'user' } } });

  assert.equal(state.tools.length, 2);
  assert.equal(state.reserved, 32000);
  assert.equal(state.nodes.length, 3);
  assert.deepEqual(state.nodes.map(node => node[2]), [KIND_INSTRUCTIONS, KIND_SKILLS, 0]);

  const view = viewContext(state, { ratio: 0.8, headroom: 65536 });
  assert.equal(view.fileTokens, state.nodes[0]?.[1]);
  assert.deepEqual(view.files.map(([path]) => path), ['AGENTS.md']);
  assert.equal(view.files[0]?.[1], view.fileTokens);
  assert.deepEqual(view.skills.map(([name]) => name), ['grilling']);
  assert.equal(view.skillTokens, state.nodes[1]?.[1]);
  /* 1,000,000 × 0.8 = 800,000 against 1,000,000 − 32,000 − 65,536 = 902,464. */
  assert.equal(view.compaction, 800000);
  assert.equal(viewContext(state, null).compaction, null, 'no policy draws no row');
});

test('a compaction replacement shadows the range it names', () => {
  let state = initContextState();
  state = applyContextEvent(state, instruction(9, 'AGENTS.md', 'a'.repeat(400)));
  state = applyContextEvent(state, {
    type: 'user/message',
    seq: 11,
    surfaceOp: 'append',
    data: {
      content: [{ type: 'text', text: 'x'.repeat(800) }],
      source: { kind: 'skill-catalog', entries: [{ name: 'grilling' }] },
    },
  });
  const before = viewContext(state, null);
  /* A checkpoint that shadows both earlier nodes, the way `compaction-basic`
     replaces a range rather than appending beside it. */
  const checkpoint: PricedEvent = {
    type: 'user/message',
    seq: 40,
    surfaceOp: { startSeq: 9, endSeq: 11 },
    data: {
      content: [{ type: 'text', text: 'c'.repeat(120) }],
      source: { kind: 'compact-checkpoint' },
    },
  };
  state = applyContextEvent(state, checkpoint);
  assert.equal(state.nodes.length, 1);
  assert.equal(state.nodes[0]?.[0], 40);
  const after = viewContext(state, null);
  assert.equal(after.fileTokens, 0, 'the shadowed instruction file left the surface');
  assert.equal(after.skillTokens, 0);
  assert.deepEqual(after.files, []);
  assert.notEqual(after.fileTokens, before.fileTokens);
});

test('a replacement range the fold cannot place is kept rather than thrown', () => {
  let state = initContextState();
  state = applyContextEvent(state, {
    type: 'user/message',
    seq: 5,
    surfaceOp: { startSeq: 1, endSeq: 2 },
    data: { content: [{ type: 'text', text: 'hello' }] },
  });
  assert.equal(state.nodes.length, 1, 'the panel stays a reading instead of failing the host fold');
});

test('persisted state and wire value round-trip', () => {
  let state = initContextState();
  state = applyContextEvent(state, instruction(9, 'AGENTS.md', 'a'.repeat(400)));
  state = applyContextEvent(state, { type: 'request/context', seq: 2, data: { contextWindow: 200000 } } as unknown as PricedEvent);
  const restored = readContextState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
  assert.deepEqual(readContextView(JSON.parse(JSON.stringify(viewContext(state, null)))), viewContext(state, null));
});

test('a misshapen persisted row reads as an empty state, never a throw', () => {
  for (const value of [undefined, null, 'text', 7, { nodes: 'x', tools: [1], window: -3, reserved: 1.5 }]) {
    const state = readContextState(value);
    assert.deepEqual(state.nodes, []);
    assert.deepEqual(state.tools, []);
    assert.equal(state.window, 0);
    assert.equal(state.reserved, null);
  }
  const view = readContextView({ tools: [['bash', 12], ['bad'], [7, 3]], skillTokens: 'x', compaction: -1 });
  assert.deepEqual(view.tools, [['bash', 12]]);
  assert.equal(view.skillTokens, 0);
  assert.equal(view.compaction, null);
});
