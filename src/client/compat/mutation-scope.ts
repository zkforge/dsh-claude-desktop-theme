import { ANCHOR } from './host-dom.ts';

/**
 * Whether a mutation batch can concern one region of the page.
 *
 * Several modules here observe the whole body because the host can move or
 * rebuild their anchor at any time, then pay a geometry pass on every batch.
 * Most batches, though, come from somewhere else — a drag in the right pane, a
 * streaming transcript on another page, another plugin writing its own markup.
 * This predicate lets a module skip those batches without narrowing what it
 * observes, so an anchor that is replaced still reaches it.
 *
 * The answer is deliberately conservative: a region that is missing, detached
 * or cannot answer `contains` makes every batch relevant, so a module that
 * cannot yet measure is never starved of the mutation that would let it.
 */

/** One node overlaps a region when either contains the other. */
function overlaps(node: Node, region: Element): boolean {
  if (node === region) return true;
  const candidate = node as Partial<Element>;
  if (typeof candidate.contains === 'function' && candidate.contains(region)) return true;
  return typeof region.contains === 'function' && region.contains(node);
}

/** Whether one record wrote in the region, or inserted/removed around it. */
function touches(record: MutationRecord, region: Element): boolean {
  if (record.type === 'attributes' || record.type === 'characterData') {
    return overlaps(record.target, region);
  }
  // Removed children no longer belong to the region. Their parent still does,
  // including when removing the last text node changes the measured box.
  if (record.target === region || region.contains(record.target)) return true;
  for (const node of record.addedNodes) if (overlaps(node, region)) return true;
  for (const node of record.removedNodes) if (overlaps(node, region)) return true;
  return false;
}

/**
 * Whether any record in a batch can move something inside `region`.
 *
 * `region` is the element the module measures — the composer, the scroller,
 * the conversation root. A change inside it, on it, or on any of its ancestors
 * counts, because those are the writes that can change its box. A `null`
 * region, or one the host has already detached, makes the batch relevant:
 * that is exactly the state in which the module has to look again.
 *
 * @param records - the observer's batch.
 * @param region - the element being measured, or null while it is unknown.
 * @returns true when the batch is worth a pass.
 */
export function recordsTouch(records: readonly MutationRecord[], region: Element | null): boolean {
  if (region === null || region.isConnected === false) return true;
  /* A node from another realm, or a stand-in without the DOM's containment
     helpers, cannot answer the question this predicate asks. Treating the batch
     as relevant is the safe side: the module looks again rather than going
     quiet. */
  if (typeof region.contains !== 'function') return true;
  for (const record of records) if (touches(record, region)) return true;
  return false;
}

/**
 * Whether a batch inserted a subtree the selector names.
 *
 * For modules that watch the whole body only because their anchor can be
 * replaced: an insertion that matches the selector is the one structural event
 * worth a pass, and it costs one `matches`/`querySelector` per inserted element
 * rather than a scan of the document. The predicate is also conservative: a
 * node from another realm, or one without the selector helpers, counts as a
 * match.
 *
 * @param records - the observer's batch.
 * @param selector - the marker whose arrival matters.
 * @returns true when an inserted element is, or contains, a match.
 */
export function recordsIntroduce(records: readonly MutationRecord[], selector: string): boolean {
  for (const record of records) {
    if (record.type !== 'childList') continue;
    for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      const element = node as Partial<Element>;
      if (typeof element.matches !== 'function' || typeof element.querySelector !== 'function') return true;
      if (element.matches(selector)) return true;
      if (element.querySelector(selector) !== null) return true;
    }
  }
  return false;
}

/**
 * Whether every record in a batch stayed inside the transcript's chat seats.
 *
 * While a reply streams, nearly every batch is text and markup growing inside
 * one `[data-chat-flow-kind]` seat. A module that only dresses the sidebar,
 * the Composer, a menu or a dialog cannot be affected by those writes, and a
 * document-wide `querySelectorAll` per streamed batch is the largest cost this
 * plugin adds to the host's own rendering. Such a module returns early on
 * these batches; a seat being inserted or removed is written on its parent,
 * outside every seat, so structural changes still reach it.
 *
 * The answer is conservative: a missing or empty batch, or a target that cannot answer
 * `closest`, is not confined, and the module looks again as it always did.
 *
 * @param records - the observer's batch.
 * @returns true when the batch can be skipped by a module outside the transcript.
 */
export function recordsInTranscript(records: readonly MutationRecord[]): boolean {
  if (!records || records.length === 0) return false;
  let previous: Node | null = null;
  for (const record of records) {
    const target = record.target;
    // Streaming writes many records against one parent in a row.
    if (target === previous) continue;
    const element = target.nodeType === 1 ? target as Element : target.parentElement;
    if (element == null || typeof element.closest !== 'function') return false;
    if (element.closest(ANCHOR.chatFlowItem) === null) return false;
    previous = target;
  }
  return true;
}
