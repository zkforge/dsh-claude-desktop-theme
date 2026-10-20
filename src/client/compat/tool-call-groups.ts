import type { Disposer } from '../contracts/ports.ts';
import { ANCHOR } from './host-dom.ts';

export type ToolGroupKind = 'read' | 'command' | 'tool';

export interface ToolGroupEntry<T> {
  readonly value: T;
  readonly kind: ToolGroupKind | 'barrier';
  readonly turn: string | null;
  readonly settled: boolean;
  readonly failed: boolean;
}

/** A visible reply, reasoning row, live call, or turn boundary ends a run. */
export function consecutiveToolGroups<T>(entries: readonly ToolGroupEntry<T>[]): ToolGroupEntry<T>[][] {
  const groups: ToolGroupEntry<T>[][] = [];
  let current: ToolGroupEntry<T>[] = [];
  for (const entry of entries) {
    if (entry.kind === 'barrier' || !entry.settled) {
      current = [];
      continue;
    }
    if (current.length === 0 || current[0]?.turn !== entry.turn) {
      current = [];
      groups.push(current);
    }
    current.push(entry);
  }
  return groups;
}

export function toolGroupLabel(kinds: readonly ToolGroupKind[]): string {
  const counts = { read: 0, command: 0, tool: 0 };
  for (const kind of kinds) counts[kind]++;
  const categories = (['read', 'command', 'tool'] as const).filter(kind => counts[kind] > 0);
  return categories.map((kind, index) => {
    const count = counts[kind];
    const verb = kind === 'read' ? 'read' : kind === 'command' ? 'ran' : 'used';
    const noun = kind === 'read' ? 'file' : kind;
    const amount = count === 1 && categories.length > 1 ? 'a' : String(count);
    return `${index === 0 ? verb[0]!.toUpperCase() + verb.slice(1) : verb} ${amount} ${noun}${count === 1 ? '' : 's'}`;
  }).join(', ');
}

interface Group {
  readonly button: HTMLButtonElement;
  readonly label: HTMLSpanElement;
  members: HTMLElement[];
  open: boolean;
  failed: boolean;
}

/**
 * Inject only a sibling disclosure. Native calls keep their original React
 * parents, identities, handlers and independent detail state. Adjacent borders
 * paint the expanded list without wrapping or moving host nodes.
 */
export function mountToolCallGroups(document: Document, report: (error: unknown) => void): Disposer {
  const groups = new Map<HTMLElement, Map<HTMLElement, Group>>();
  const dirty = new Set<HTMLElement>();
  let released = false;
  let pending = false;

  const unmark = (member: HTMLElement) => {
    member.removeAttribute('data-ccd-tool-group-member');
    member.removeAttribute('data-ccd-tool-group-edge');
    member.removeAttribute('data-ccd-tool-group-kind');
  };
  const paint = (group: Group) => {
    group.button.setAttribute('aria-expanded', String(group.open));
    group.members.forEach((member, index) => {
      member.setAttribute('data-ccd-tool-group-member', group.open ? 'open' : 'closed');
      member.setAttribute('data-ccd-tool-group-edge', group.members.length === 1 ? 'only'
        : index === 0 ? 'first' : index === group.members.length - 1 ? 'last' : 'middle');
    });
  };
  const disposeGroup = (group: Group) => {
    group.button.remove();
    group.members.forEach(unmark);
  };
  const entry = (element: HTMLElement): ToolGroupEntry<HTMLElement> => {
    const call = element.querySelector<HTMLElement>(ANCHOR.toolCall);
    // Read only the outer call's own row, never a nested subcall's status.
    const rows = call ? [...call.querySelectorAll<HTMLElement>('[data-tool], [data-sample="bash"]')] : [];
    const row = rows.find(candidate => candidate.closest(ANCHOR.toolCall) === call);
    const name = row?.getAttribute('data-tool') ?? (row?.getAttribute('data-sample') === 'bash' ? 'bash' : '');
    // ScheduleCreateCard has no data-state. Its direct, labelled navigation
    // button is emitted only for a real created task. Raw fallback output is
    // ambiguous (including failures), so it must stay outside collapsed runs.
    const createdTask = name === 'schedule_create' && row && [...row.children].some(child =>
      child.tagName === 'BUTTON' && child.hasAttribute('aria-label') && !child.hasAttribute('disabled'));
    const state = row?.getAttribute('data-state') ?? (createdTask ? 'ok' : null);
    const active = rows.some(child => ['running', 'preparing'].includes(child.getAttribute('data-state') ?? '')
      || ['running', 'client-pending', 'awaiting-approval'].includes(child.getAttribute('data-cordis-status') ?? ''));
    const command = ['bash', 'pwsh', 'exec_command', 'write_stdin'].includes(name);
    return {
      value: element,
      kind: element.matches(ANCHOR.toolFlow) && row
        ? command ? 'command' : ['read', 'read_image'].includes(name) ? 'read' : 'tool' : 'barrier',
      turn: element.getAttribute('data-chat-turn'),
      settled: !active && (state === 'ok' || state === 'error' || state === 'stopped'),
      failed: rows.some(child => ['error', 'stopped'].includes(child.getAttribute('data-state') ?? '')
        || child.getAttribute('data-cordis-status') === 'failed'),
    };
  };
  const syncParent = (parent: HTMLElement) => {
    const previous = groups.get(parent) ?? new Map<HTMLElement, Group>();
    const runs = parent.isConnected ? consecutiveToolGroups(
      [...parent.children].filter((child): child is HTMLElement => child.nodeType === 1
        && !child.hasAttribute('data-ccd-tool-group-toggle')).map(entry),
    ) : [];
    const next = new Map<HTMLElement, Group>();
    // Clear previous members before applying new membership: inserted replies,
    // live-state changes and removed calls can split or join an existing run.
    for (const group of previous.values()) group.members.forEach(unmark);
    for (const run of runs) {
      const first = run[0]!.value;
      const failed = run.some(item => item.failed);
      let group = previous.get(first);
      if (!group) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-ccd-tool-group-toggle', '');
        const label = document.createElement('span');
        const arrow = document.createElement('span');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.setAttribute('data-ccd-tool-group-chevron', '');
        button.append(label, arrow);
        group = { button, label, members: [], open: failed, failed };
        const current = group;
        button.addEventListener('click', () => {
          current.open = !current.open;
          paint(current);
        });
      } else if (failed && !group.failed) group.open = true;
      group.failed = failed;
      group.members = run.map(item => item.value);
      if (document.activeElement && group.members.some(member => member.contains(document.activeElement))) group.open = true;
      for (const item of run) item.value.setAttribute('data-ccd-tool-group-kind', item.kind);
      const text = toolGroupLabel(run.map(item => item.kind as ToolGroupKind));
      if (group.label.textContent !== text) group.label.textContent = text;
      if (group.button.nextElementSibling !== first) parent.insertBefore(group.button, first);
      paint(group);
      next.set(first, group);
    }
    for (const [first, group] of previous) {
      // Membership was already cleared above; a joined run may now own it.
      if (!next.has(first)) group.button.remove();
    }
    if (next.size) groups.set(parent, next);
    else groups.delete(parent);
  };
  const flush = () => {
    pending = false;
    if (released) return;
    try {
      for (const parent of groups.keys()) if (!parent.isConnected) dirty.add(parent);
      const parents = [...dirty];
      dirty.clear();
      for (const parent of parents) syncParent(parent);
    } catch (error) { report(error); }
  };
  const collect = (node: Node) => {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    if (!element) return;
    const flow = element.closest<HTMLElement>(ANCHOR.chatFlowItem);
    if (flow?.parentElement) dirty.add(flow.parentElement);
    for (const child of element.querySelectorAll<HTMLElement>(ANCHOR.toolFlow)) {
      if (child.parentElement) dirty.add(child.parentElement);
    }
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      // Native row state/structure can change in place. Sibling replies can
      // also be inserted or removed between calls, including empty live seats.
      if (groups.has(record.target as HTMLElement)) dirty.add(record.target as HTMLElement);
      collect(record.target);
      for (const node of record.addedNodes) collect(node);
    }
    for (const parent of groups.keys()) if (!parent.isConnected) dirty.add(parent);
    if (!pending && dirty.size) {
      pending = true;
      queueMicrotask(flush);
    }
  });
  observer.observe(document.body, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['data-state', 'data-tool', 'data-cordis-status', 'disabled', 'data-chat-flow-kind', 'data-chat-turn'],
  });
  collect(document.body);
  flush();
  return () => {
    released = true;
    observer.disconnect();
    dirty.clear();
    for (const parent of groups.values()) for (const group of parent.values()) disposeGroup(group);
    groups.clear();
  };
}
