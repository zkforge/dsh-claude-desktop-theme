/**
 * The host's own token heuristic, restated for the context panel.
 *
 * `@deepseek-ai/dsh-token-meter` prices a request envelope as four characters
 * per token plus four tokens of structural overhead per content block and per
 * message; `contextBreakdown` is that sum over the retained surface. The panel
 * has to decompose those three numbers, so it must price a message exactly the
 * way the host did — this module is that pricing and nothing else, and every
 * function here is checked against a real session log in
 * `tests/context-pricing.test.ts`.
 *
 * The package is not part of this plugin's runtime baseline, so the formulas
 * are restated rather than imported. They are pinned to the DSH build this
 * plugin targets; a host that changes its heuristic makes the panel's rows
 * disagree with its own three numbers, which is why the card shows that
 * difference as a row of its own.
 *
 * @module
 */
import { BLOCK_OVERHEAD, CHARS_PER_TOKEN } from '../../shared/context.ts';

/** One content block, as far as pricing reads it. */
export interface PricedBlock {
  readonly type?: string;
  readonly text?: string;
  readonly name?: string;
  readonly arguments?: string;
  /** Every other field the block carries; pricing only ever serializes them. */
  readonly [field: string]: unknown;
}

/** One model-visible message, as far as pricing reads it. */
export interface PricedMessage {
  /** Absent for a `user/message` payload, which *is* the message. */
  readonly role?: string;
  readonly content: readonly PricedBlock[];
}

/** One tool schema, as far as pricing reads it. */
export interface PricedTool {
  readonly name: string;
}

/** The structural slice of one session event this fold reads. */
export interface PricedEvent {
  readonly type: string;
  readonly seq: number;
  readonly surfaceOp?: 'append' | { readonly startSeq: number; readonly endSeq: number };
  readonly data?: {
    readonly content?: readonly PricedBlock[];
    readonly message?: PricedMessage;
    readonly source?: {
      readonly kind?: string;
      readonly changes?: readonly { readonly action?: string; readonly path?: string }[];
      readonly entries?: readonly { readonly name?: string; readonly description?: string }[];
    };
  };
}

/** Event types that can join the model-visible surface. */
const SURFACE_TYPES = new Set([
  'system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result',
]);

/**
 * Price one content block list.
 *
 * @param blocks - the message's content.
 * @returns heuristic tokens including per-block structural overhead.
 */
export function priceContent(blocks: readonly PricedBlock[]): number {
  let tokens = 0;
  for (const block of blocks) {
    if (block.type === 'text' || block.type === 'reasoning') {
      tokens += Math.ceil((block.text ?? '').length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
      continue;
    }
    if (block.type === 'tool-call') {
      tokens += Math.ceil((block.name ?? '').length / CHARS_PER_TOKEN)
        + Math.ceil((block.arguments ?? '').length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
      continue;
    }
    tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN);
  }
  return tokens;
}

/**
 * Price one model-visible message.
 *
 * A system prompt is serialized as a plain string by every adapter, so the host
 * prices it as text density plus role framing with no per-block overhead; every
 * other role takes the per-block arm.
 *
 * @param message - the derived message, or null when the event produces none.
 * @returns heuristic tokens.
 */
export function priceMessage(message: PricedMessage | null): number {
  if (message === null) return 0;
  if (message.role === 'system') {
    if (message.content.length === 0) return 0;
    let characters = 0;
    for (const block of message.content) {
      characters += block.type === 'text' ? (block.text ?? '').length : JSON.stringify(block).length;
    }
    return Math.ceil(characters / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
  }
  return priceContent(message.content) + BLOCK_OVERHEAD;
}

/**
 * The message one surface event projects to, or null when it produces none.
 *
 * @param event - one committed session event.
 * @returns the message to price.
 */
export function derivedMessage(event: PricedEvent): PricedMessage | null {
  switch (event.type) {
    case 'user/message':
      return { content: event.data?.content ?? [] };
    case 'system/message':
    case 'developer/message':
    case 'assistant/message': {
      const message = event.data?.message;
      if (message === undefined || message.content.length === 0) return null;
      return message;
    }
    case 'tool/result':
      return event.data?.message ?? null;
    default:
      return null;
  }
}

/** Whether an event carries a surface placement and therefore joins the fold. */
export function isSurfaceEvent(event: PricedEvent): boolean {
  return SURFACE_TYPES.has(event.type) && event.surfaceOp !== undefined;
}

/**
 * Price one tool schema on its own.
 *
 * The host prices the assembled array whole, so these per-tool numbers never
 * add back up to it; {@link splitTools} is what keeps the two group rows
 * summing to the host's own total.
 *
 * @param tool - one entry of `EpochHeader.tools`.
 * @returns heuristic tokens for that entry alone.
 */
export function priceTool(tool: unknown): number {
  return Math.ceil(JSON.stringify(tool).length / CHARS_PER_TOKEN);
}

/**
 * Price the assembled tool array exactly as the host does.
 *
 * @param tools - `EpochHeader.tools`.
 * @returns the array's heuristic price; 0 when there are no tools.
 */
export function priceTools(tools: readonly PricedTool[] | undefined): number {
  if (tools === undefined || tools.length === 0) return 0;
  return Math.ceil(JSON.stringify(tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
}

/**
 * Split one token total across weighted entries, preserving the total exactly.
 *
 * The last entry takes whatever rounding left over, so the rows a group draws
 * always add back up to the group's own number.
 *
 * @param total - tokens to distribute.
 * @param weights - one weight per entry; non-positive weights fall back to 1.
 * @returns one token count per entry, summing to `total`.
 */
export function allocate(total: number, weights: readonly number[]): readonly number[] {
  if (weights.length === 0) return [];
  const safe = weights.map(weight => (Number.isFinite(weight) && weight > 0 ? weight : 1));
  const sum = safe.reduce((running, weight) => running + weight, 0);
  const out: number[] = [];
  let placed = 0;
  for (let index = 0; index < safe.length - 1; index += 1) {
    const share = Math.round(total * safe[index]! / sum);
    out.push(share);
    placed += share;
  }
  out.push(Math.max(0, total - placed));
  return out;
}
