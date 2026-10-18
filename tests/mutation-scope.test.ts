import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordsTouch } from '../src/client/compat/mutation-scope.ts';

/** A node as the DOM answers the one question this predicate asks of it. */
function node(connected = true) {
  const owned = new Set<object>();
  const element = {
    nodeType: 1,
    isConnected: connected,
    contains: (candidate: object) => owned.has(candidate),
    own(child: object) { owned.add(child); },
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
