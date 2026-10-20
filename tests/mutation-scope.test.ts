import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordsInTranscript, recordsIntroduce, recordsTouch } from '../src/client/compat/mutation-scope.ts';

/** A node as the DOM answers the questions these predicates ask of it. */
function node(connected = true) {
  const owned = new Set<object>();
  const element = {
    nodeType: 1,
    isConnected: connected,
    marker: '',
    contains: (candidate: object) => owned.has(candidate),
    own(child: object) { owned.add(child); },
    matches: (selector: string) => element.marker === selector,
    querySelector: (selector: string) => [...owned].find(child => (child as { marker?: string }).marker === selector) ?? null,
  };
  owned.add(element);
  return element;
}

const attribute = (target: object): MutationRecord => ({
  type: 'attributes', attributeName: 'style', target, addedNodes: [], removedNodes: [],
} as unknown as MutationRecord);

const insertion = (target: object, addedNodes: object[]): MutationRecord => ({
  type: 'childList', target, addedNodes, removedNodes: [],
} as unknown as MutationRecord);

test('a write on the region or inside it is relevant', () => {
  const region = node();
  const child = node();
  region.own(child);
  assert.equal(recordsTouch([attribute(region)], region as unknown as Element), true);
  assert.equal(recordsTouch([attribute(child)], region as unknown as Element), true);
});

test('a write anywhere else is not', () => {
  const region = node();
  const elsewhere = node();
  assert.equal(recordsTouch([attribute(elsewhere)], region as unknown as Element), false);
  assert.equal(recordsTouch([], region as unknown as Element), false);
  /* One relevant record in a batch is enough. */
  assert.equal(recordsTouch([attribute(elsewhere), attribute(region)], region as unknown as Element), true);
});

test('a write on an ancestor is relevant: it can resize the region', () => {
  const page = node();
  const region = node();
  const wrap = node();
  /* The region contains neither the page nor the wrapper, but both contain it. */
  Object.assign(region, { contains: (candidate: object) => candidate === region });
  Object.assign(page, { contains: (candidate: object) => candidate === region || candidate === page });
  Object.assign(wrap, { contains: (candidate: object) => candidate === region || candidate === wrap });
  assert.equal(recordsTouch([attribute(page)], region as unknown as Element), true);
  assert.equal(recordsTouch([attribute(wrap)], region as unknown as Element), true);
});

test('inserting or removing the region itself is relevant', () => {
  const page = node();
  const region = node();
  const element = region as unknown as Element;
  assert.equal(recordsTouch([insertion(page, [region])], element), true);
  assert.equal(recordsTouch([{ type: 'childList', target: page, addedNodes: [], removedNodes: [region] } as unknown as MutationRecord], element), true);
});

test('an unknown or detached region makes every batch relevant', () => {
  const batch = [attribute(node())];
  assert.equal(recordsTouch(batch, null), true, 'before the first measurement nothing may be skipped');
  const gone = node(false);
  assert.equal(recordsTouch(batch, gone as unknown as Element), true, 'a region the host removed is exactly when to look again');
  /* A stand-in from another realm cannot answer `contains`; look again. */
  assert.equal(recordsTouch(batch, { isConnected: true } as unknown as Element), true);
});

test('removing a descendant remains relevant after it loses containment', () => {
  const region = node();
  const parent = node();
  region.own(parent);
  const removed = { nodeType: 3 };
  const removal = { type: 'childList', target: parent, addedNodes: [], removedNodes: [removed] } as unknown as MutationRecord;
  assert.equal(recordsTouch([removal], region as unknown as Element), true);
  assert.equal(recordsTouch([insertion(region, [])], region as unknown as Element), true);
  assert.equal(recordsTouch([insertion(node(), [])], region as unknown as Element), false);
});

test('a selector match is worth a pass wherever the batch inserted it', () => {
  const page = node();
  const wanted = node();
  wanted.marker = '[data-phase="hero"]';
  const other = node();
  assert.equal(recordsIntroduce([insertion(page, [wanted])], '[data-phase="hero"]'), true);
  assert.equal(recordsIntroduce([insertion(page, [other])], '[data-phase="hero"]'), false);
  /* A batch that only writes attributes introduces nothing. */
  assert.equal(recordsIntroduce([attribute(page)], '[data-phase="hero"]'), false);
  /* The marker may arrive inside the inserted wrapper rather than be it. */
  const wrapper = node();
  wrapper.own(wanted);
  assert.equal(recordsIntroduce([insertion(page, [wrapper])], '[data-phase="hero"]'), true);
  /* Text nodes cannot match, and are not asked to. */
  assert.equal(recordsIntroduce([insertion(page, [{ nodeType: 3 }])], '[data-phase="hero"]'), false);
  /* A stand-in that cannot answer the selector helpers is treated as a match. */
  assert.equal(recordsIntroduce([insertion(page, [{ nodeType: 1 }])], '[data-phase="hero"]'), true);
});

test('a batch confined to chat seats is in the transcript; anything outside is not', () => {
  const seat = { nodeType: 1, closest: (selector: string) => selector === '[data-chat-flow-kind]' ? seat : null };
  const sidebar = { nodeType: 1, closest: () => null };
  const text = { nodeType: 3, parentElement: seat };
  const streamed = (target: object): MutationRecord => ({
    type: 'characterData', target, addedNodes: [], removedNodes: [],
  } as unknown as MutationRecord);
  assert.equal(recordsInTranscript([streamed(text), streamed(text), insertion(seat, [])]), true);
  assert.equal(recordsInTranscript([streamed(text), attribute(sidebar)]), false);
  assert.equal(recordsInTranscript([]), false, 'an empty batch is not skipped');
  assert.equal(recordsInTranscript([attribute({})]), false, 'a target that cannot answer is not skipped');
});
