/**
 * Pure `ccdContext` fold over committed session events.
 *
 * The host already publishes `contextBreakdown` — system prompt, tools,
 * conversation — and `contextPressure`. Neither says *which* tool, *which*
 * instruction file or *which* skill holds the tokens, and nothing outside the
 * token meter can answer that from a wire value. So this unit mirrors the
 * meter's own surface fold: it prices every message-producing event with the
 * same heuristic, honours `surfaceOp` replacements exactly as
 * `contextBreakdown` does, and keeps the priced surface so the two classified
 * kinds can be summed at read time.
 *
 * The mirror is exact rather than approximate — against a real 19 MB session
 * log it reproduces the host's persisted `{systemTokens: 1953, toolsTokens:
 * 7492, messageTokens: 93461}` to the token — and `tests/context-pricing.test.ts`
 * pins that. What it deliberately does *not* do is restate the whole
 * breakdown: the system prompt and the conversation are the host's numbers, and
 * this unit only re-derives the two shares that come out of `messageTokens`.
 *
 * @module
 */
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection';
import type { ZodType } from 'zod';
import {
  CONTEXT_ENTRY_LIMIT, CONTEXT_KEY, CONTEXT_STATE_VERSION, compactionThreshold, emptyContextView,
  readContextView as readContextWire, readCount, readEntries as sharedEntries,
  type ContextBreakdownView, type ContextEntry,
} from '../../shared/context.ts';
import {
  allocate, derivedMessage, isSurfaceEvent, priceMessage, priceTool,
  type PricedEvent, type PricedTool,
} from './pricing.ts';

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    ccdContext: ContextState;
  }
  interface SessionProjectionMap {
    ccdContext: ContextBreakdownView;
  }
}

/** The autocompaction policy this deployment runs, as the loader declares it. */
export interface CompactionPolicy {
  /** `thresholdRatio`; the window share a compaction may fill. */
  readonly ratio: number;
  /** `headroomTokens`; room kept above the summary budget. */
  readonly headroom: number;
}

/** Node kinds the fold classifies; everything else is `OTHER`. */
export const KIND_OTHER = 0;
/** A retained `agent-instructions` message. */
export const KIND_INSTRUCTIONS = 1;
/** A retained `skill-catalog` message. */
export const KIND_SKILLS = 2;

/**
 * One retained surface node: `[seq, tokens, kind, entries]`.
 *
 * `entries` is empty for anything but the two classified kinds; for those it is
 * the node's own price already split across the files or skills it names, so
 * summing a kind's entries is summing its nodes.
 */
export type ContextNode = readonly [
  seq: number, tokens: number, kind: number, entries: readonly ContextEntry[],
];

/** Fold state: plain JSON, one value per session. */
export interface ContextState {
  /** Every retained surface node, in model-visible order. */
  readonly nodes: readonly ContextNode[];
  /** Per-tool prices from the latest request envelope, largest first. */
  readonly tools: readonly ContextEntry[];
  /** `request/context` capacity, 0 until one is logged. */
  readonly window: number;
  /** The envelope's own output cap, or null when it declares none. */
  readonly reserved: number | null;
}

/** Empty state for one session. */
export function initContextState(): ContextState {
  return { nodes: [], tools: [], window: 0, reserved: null };
}

/** Read a finite non-negative number, defaulting to zero. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Read one non-negative integer, or null when the value is not one. */
function optionalCount(value: unknown): number | null {
  return readCount(value);
}

/** The message's own text, as the instruction sections are cut out of it. */
function textOf(event: PricedEvent): string {
  return (event.data?.content ?? [])
    .map(block => (block.type === 'text' ? block.text ?? '' : ''))
    .join('\n');
}

/** Where one instruction file's own section starts, or −1. */
function sectionStart(text: string, path: string): number {
  const needles = [
    `Instructions from: ${path}`,
    `Additional instructions from: ${path}`,
    `Updated instructions from: ${path}`,
  ];
  let found = -1;
  for (const needle of needles) {
    const at = text.indexOf(needle);
    if (at >= 0 && (found < 0 || at < found)) found = at;
  }
  return found;
}

/** Where any instruction section starts after `from`, or the text's end. */
function nextSection(text: string, from: number): number {
  const marker = /^(?:Additional |Updated )?[Ii]nstructions from: /m;
  const rest = text.slice(from);
  const at = marker.exec(rest);
  return at === null ? text.length : from + at.index;
}

/**
 * One instruction message's price, split across the files it names.
 *
 * The paths come from `source.changes` — the structured record of what that
 * message carries — and the split weights come from each file's own section, so
 * a message carrying two files of very different size does not report them as
 * equal. A path whose section cannot be located takes an even weight.
 *
 * @param event - the retained `agent-instructions` message.
 * @param tokens - the message's own heuristic price.
 * @returns one row per named file, summing to `tokens`.
 */
export function instructionEntries(event: PricedEvent, tokens: number): readonly ContextEntry[] {
  const text = textOf(event);
  const weights = new Map<string, number>();
  for (const change of event.data?.source?.changes ?? []) {
    const path = change.path;
    if (typeof path !== 'string' || path === '' || change.action === 'remove') continue;
    const at = sectionStart(text, path);
    const weight = at < 0 ? 1 : Math.max(1, nextSection(text, at + 1) - at);
    weights.set(path, (weights.get(path) ?? 0) + weight);
  }
  const paths = [...weights.keys()];
  if (paths.length === 0) return [];
  const shares = allocate(tokens, paths.map(path => weights.get(path) ?? 1));
  return paths.map((path, index) => [path, shares[index] ?? 0] as const);
}

/**
 * One skill catalog's price, split across the entries it lists.
 *
 * The catalog's structured `entries` are the names; their descriptions are the
 * only per-entry size the message carries, so they are what the split weighs.
 *
 * @param event - the retained `skill-catalog` message.
 * @param tokens - the message's own heuristic price.
 * @returns one row per listed skill, summing to `tokens`.
 */
export function skillEntries(event: PricedEvent, tokens: number): readonly ContextEntry[] {
  const listed = event.data?.source?.entries ?? [];
  const named: { name: string; weight: number }[] = [];
  for (const entry of listed) {
    const name = entry.name;
    if (typeof name !== 'string' || name === '') continue;
    const weight = name.length + (entry.description?.length ?? 0);
    const seen = named.find(candidate => candidate.name === name);
    if (seen === undefined) named.push({ name, weight });
    else seen.weight += weight;
  }
  if (named.length === 0) return [];
  const shares = allocate(tokens, named.map(entry => entry.weight));
  return named.map((entry, index) => [entry.name, shares[index] ?? 0] as const);
}

/** The kind one surface event belongs to. */
function kindOf(event: PricedEvent): number {
  if (event.type !== 'user/message') return KIND_OTHER;
  const kind = event.data?.source?.kind;
  if (kind === 'agent-instructions') return KIND_INSTRUCTIONS;
  if (kind === 'skill-catalog') return KIND_SKILLS;
  return KIND_OTHER;
}

/** Price the assembled tool array per entry, largest first and capped. */
function pricedTools(tools: readonly PricedTool[] | undefined): readonly ContextEntry[] {
  if (tools === undefined || tools.length === 0) return [];
  return tools
    .map(tool => [tool.name, priceTool(tool)] as const)
    .sort((left, right) => (right[1] - left[1]) || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .slice(0, CONTEXT_ENTRY_LIMIT);
}

/** Whether two tool tables say the same thing, so the fold can keep its state. */
function sameTools(left: readonly ContextEntry[], right: readonly ContextEntry[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => entry[0] === right[index]?.[0] && entry[1] === right[index]?.[1]);
}

/**
 * Advance the fold by one committed event.
 *
 * @param state - state covering every earlier event.
 * @param event - the next committed session event.
 * @returns the next state, or the same reference when the event is not ours.
 */
export function applyContextEvent(state: ContextState, event: PricedEvent): ContextState {
  if (event.type === 'request/header') {
    const header = (event as { data?: { header?: { tools?: readonly PricedTool[]; config?: { maxTokens?: number } } } }).data?.header;
    const tools = pricedTools(header?.tools);
    const reserved = optionalCount(header?.config?.maxTokens);
    return sameTools(tools, state.tools) && reserved === state.reserved
      ? state
      : { ...state, tools, reserved };
  }
  if (event.type === 'request/context') {
    const window = count((event as { data?: { contextWindow?: number } }).data?.contextWindow);
    return window === state.window ? state : { ...state, window };
  }
  if (!isSurfaceEvent(event)) return state;

  const tokens = priceMessage(derivedMessage(event));
  const kind = kindOf(event);
  const entries = kind === KIND_INSTRUCTIONS
    ? instructionEntries(event, tokens)
    : kind === KIND_SKILLS ? skillEntries(event, tokens) : [];
  const node: ContextNode = [event.seq, tokens, kind, entries];
  const op = event.surfaceOp;
  if (op === undefined || op === 'append') {
    return { ...state, nodes: [...state.nodes, node] };
  }
  const start = state.nodes.findIndex(candidate => candidate[0] === op.startSeq);
  const end = state.nodes.findIndex(candidate => candidate[0] === op.endSeq);
  /* A range this fold cannot place is a log this plugin did not fold from the
     start — a restored checkpoint from another unit's lifetime, say. The event
     is kept as an append rather than dropped: the panel is a reading, and a
     reading that is one node too long still beats one that throws into the
     host's fold. */
  if (start < 0 || end < 0 || start > end) return { ...state, nodes: [...state.nodes, node] };
  const nodes = state.nodes.slice();
  nodes.splice(start, end - start + 1, node);
  return { ...state, nodes };
}

/** One kind's entries, merged across every retained node of that kind. */
function mergeEntries(nodes: readonly ContextNode[], kind: number): readonly ContextEntry[] {
  const merged = new Map<string, number>();
  for (const node of nodes) {
    if (node[2] !== kind) continue;
    for (const [name, tokens] of node[3]) merged.set(name, (merged.get(name) ?? 0) + tokens);
  }
  return [...merged]
    .filter(([, tokens]) => tokens > 0)
    .sort((left, right) => (right[1] - left[1]) || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .slice(0, CONTEXT_ENTRY_LIMIT)
    .map(([name, tokens]) => [name, tokens] as const);
}

/** One kind's total across every retained node of that kind. */
function sumKind(nodes: readonly ContextNode[], kind: number): number {
  let tokens = 0;
  for (const node of nodes) if (node[2] === kind) tokens += node[1];
  return tokens;
}

/**
 * Project one state onto the client-visible value.
 *
 * @param state - current fold state.
 * @param policy - the deployment's autocompaction policy, or null when none runs.
 * @returns the whole current value.
 */
export function viewContext(state: ContextState, policy: CompactionPolicy | null): ContextBreakdownView {
  return {
    tools: state.tools,
    files: mergeEntries(state.nodes, KIND_INSTRUCTIONS),
    skills: mergeEntries(state.nodes, KIND_SKILLS),
    skillTokens: sumKind(state.nodes, KIND_SKILLS),
    fileTokens: sumKind(state.nodes, KIND_INSTRUCTIONS),
    compaction: policy === null
      ? null
      : compactionThreshold(state.window, state.reserved, policy.ratio, policy.headroom),
  };
}

/** The registry declares schema slots as zod schemas but only ever calls `parse`. */
function schemaOf<T>(parse: (value: unknown) => T): ZodType<T> {
  return { parse } as unknown as ZodType<T>;
}

/** Read one persisted state row; lenient, because a read must never throw. */
export function readContextState(value: unknown): ContextState {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const nodes: ContextNode[] = [];
  if (Array.isArray(raw['nodes'])) {
    for (const entry of raw['nodes']) {
      if (!Array.isArray(entry) || entry.length < 3) continue;
      const [seq, tokens, kind, entries] = entry as [unknown, unknown, unknown, unknown];
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) continue;
      nodes.push([
        seq,
        count(tokens),
        typeof kind === 'number' && Number.isInteger(kind) ? kind : KIND_OTHER,
        sharedEntries(entries),
      ]);
    }
  }
  return {
    nodes,
    tools: sharedEntries(raw['tools']),
    window: count(raw['window']),
    reserved: optionalCount(raw['reserved']),
  };
}

/** Read one wire view row, leniently — the schema slot never throws. */
export function readContextView(value: unknown): ContextBreakdownView {
  return readContextWire(value) ?? emptyContextView();
}

/**
 * The registry's wire-unit shape: the definition with its optional `wire`
 * field made required, which is the overload a client-visible key registers
 * through.
 */
type WireUnit = Omit<ProjectionDefinition<typeof CONTEXT_KEY>, 'wire'> & {
  wire: NonNullable<ProjectionDefinition<typeof CONTEXT_KEY>['wire']>;
};

/**
 * Build the unit this plugin registers on `ctx.sessionProjections`.
 *
 * The policy is read through a callback rather than captured once: the unit is
 * registered while the plugin is on, and a settings write that enables or
 * reconfigures compaction lands in the loader's entry tree without remounting
 * this plugin.
 *
 * @param policy - reads the deployment's autocompaction policy, or null.
 * @returns the projection unit.
 */
export function createContextProjection(policy: () => CompactionPolicy | null): WireUnit {
  /* The registry compares view references with `Object.is` to decide whether a
     changed state is worth publishing; one view object per state keeps that
     decision exact. */
  const views = new WeakMap<ContextState, ContextBreakdownView>();
  return {
    key: CONTEXT_KEY,
    stateSchema: schemaOf(readContextState),
    init: () => initContextState(),
    apply: (state, event) => applyContextEvent(state, event as PricedEvent),
    wire: {
      viewSchema: schemaOf(readContextView),
      view(state) {
        const cached = views.get(state);
        if (cached !== undefined) return cached;
        const view = viewContext(state, policy());
        views.set(state, view);
        return view;
      },
    },
    stateVersion: CONTEXT_STATE_VERSION,
  };
}
