import type { Disposer } from '../contracts/ports.ts';
import { ANCHOR } from './host-dom.ts';
import { fileSummaryParts, toolFileSummary, type ToolFileSummary } from './tool-file-summary.ts';

export type ToolGroupKind = 'read' | 'command' | 'tool' | 'reasoning';

export interface ToolGroupEntry<T> {
  readonly value: T;
  readonly kind: ToolGroupKind | 'barrier';
  readonly turn: string | null;
  readonly settled: boolean;
  readonly file?: ToolFileSummary | undefined;
  readonly live?: boolean;
  readonly description?: string;
  readonly failed: boolean;
}

/** A visible reply, live activity, or turn boundary ends a run. */
export function consecutiveToolGroups<T>(entries: readonly ToolGroupEntry<T>[], includeLive = false): ToolGroupEntry<T>[][] {
  const groups: ToolGroupEntry<T>[][] = [];
  let current: ToolGroupEntry<T>[] = [];
  for (const entry of entries) {
    if (entry.kind === 'barrier' || (!entry.settled && !(includeLive && entry.live))) {
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
  const counts = { read: 0, command: 0, tool: 0, reasoning: 0 };
  for (const kind of kinds) counts[kind]++;
  const categories = (['read', 'command', 'tool'] as const).filter(kind => counts[kind] > 0);
  const parts = categories.map((kind, index) => {
    const count = counts[kind];
    const verb = kind === 'read' ? 'read' : kind === 'command' ? 'ran' : 'used';
    const noun = kind === 'read' ? 'file' : kind;
    const amount = count === 1 && (categories.length > 1 || counts.reasoning > 0) ? 'a' : String(count);
    return `${index === 0 && !counts.reasoning ? verb[0]!.toUpperCase() + verb.slice(1) : verb} ${amount} ${noun}${count === 1 ? '' : 's'}`;
  });
  return (counts.reasoning ? ['Thought', ...parts] : parts).join(', ');
}

interface Group {
  readonly button: HTMLButtonElement;
  readonly label: HTMLSpanElement;
  members: HTMLElement[];
  open: boolean;
  failed: boolean;
  outgoing?: HTMLElement;
  animations?: Animation[];
  renderKey?: string;
  shownAt?: number;
  shownLive?: boolean;
  refreshTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Inject only a sibling disclosure. Native calls keep their original React
 * parents, identities, handlers and independent detail state. Adjacent borders
 * paint the expanded list without wrapping or moving host nodes.
 */
export function mountToolCallGroups(document: Document, report: (error: unknown) => void): Disposer {
  const groups = new Map<HTMLElement, Map<HTMLElement, Group>>();
  const dirty = new Set<HTMLElement>();
  const fileTitles = new Map<Element, { title: Element; label: HTMLElement }>();
  const restoreFileTitle = (row: Element) => {
    const state = fileTitles.get(row);
    state?.title.removeAttribute('data-ccd-file-title-source');
    state?.label.remove();
    row.removeAttribute('data-ccd-file-row');
    fileTitles.delete(row);
  };
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
  const toggle = (group: Group) => {
    group.open = !group.open;
    paint(group);
  };
  const disposeGroup = (group: Group) => {
    clearTimeout(group.refreshTimer);
    group.animations?.forEach(animation => animation.cancel());
    group.outgoing?.remove();
    group.button.remove();
    group.members.forEach(unmark);
  };
  const entry = (element: HTMLElement): ToolGroupEntry<HTMLElement> => {
    // The host splits reasoning and response into separate flow seats. Never
    // infer a reasoning-only seat from a descendant: mixed replies stay visible.
    if (element.matches(ANCHOR.reasoningFlow)) {
      const thoughts = [...element.querySelectorAll('[data-variant="think"]')];
      return {
        value: element, kind: thoughts.length ? 'reasoning' : 'barrier',
        turn: element.getAttribute('data-chat-turn'),
        settled: thoughts.length > 0 && thoughts.every(thought => thought.getAttribute('data-state') === 'ok'),
        failed: false,
      };
    }
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
    const blocked = rows.some(child => child.getAttribute('data-cordis-status') === 'awaiting-approval'
      || child.getAttribute('data-state') === 'awaiting-approval'
      || ['error', 'stopped'].includes(child.getAttribute('data-state') ?? '')
      || child.getAttribute('data-cordis-status') === 'failed');
    const nestedActive = rows.some(child => child.closest(ANCHOR.toolCall) !== call
      && (['running', 'preparing'].includes(child.getAttribute('data-state') ?? '')
        || ['running', 'client-pending'].includes(child.getAttribute('data-cordis-status') ?? '')));
    const description = row?.querySelector('[class*="_summary"]')?.textContent
      || row?.querySelector('[data-disclosure-row]')?.textContent || row?.textContent || name;
    const file = row ? toolFileSummary(row) : null;
    if (row) {
      const title = row.querySelector('[data-disclosure-row]')?.querySelector('[class*="_title"]');
      let previous = fileTitles.get(row);
      if (previous && (!file || previous.title !== title)) { restoreFileTitle(row); previous = undefined; }
      if (file && previous) {
        const text = file.action === 'edit' ? 'Edited' : 'Wrote';
        if (previous.label.textContent !== text) previous.label.textContent = text;
      }
      if (file && title && !previous) {
        const label = document.createElement('span');
        label.setAttribute('data-ccd-file-action', '');
        label.textContent = file.action === 'edit' ? 'Edited' : 'Wrote';
        title.setAttribute('data-ccd-file-title-source', '');
        title.after(label);
        row.setAttribute('data-ccd-file-row', '');
        fileTitles.set(row, { title, label });
      }
    }
    const command = ['bash', 'pwsh', 'exec_command', 'write_stdin'].includes(name);
    return {
      value: element,
      kind: element.matches(ANCHOR.toolFlow) && row
        ? command ? 'command' : ['read', 'read_image'].includes(name) ? 'read' : 'tool' : 'barrier',
      turn: element.getAttribute('data-chat-turn'),
      file: file ?? undefined,
      live: active && !blocked && !nestedActive && name !== 'schedule_create',
      description: description?.replace(/\s+/gu, ' ').trim(),
      settled: !active && (state === 'ok' || state === 'error' || state === 'stopped'),
      failed: rows.some(child => ['error', 'stopped'].includes(child.getAttribute('data-state') ?? '')
        || child.getAttribute('data-cordis-status') === 'failed'),
    };
  };
  const syncParent = (parent: HTMLElement) => {
    const previous = groups.get(parent) ?? new Map<HTMLElement, Group>();
    const runs = parent.isConnected ? consecutiveToolGroups(
      [...parent.children].filter((child): child is HTMLElement => child.nodeType === 1
        && !child.hasAttribute('data-ccd-tool-group-toggle')).map(entry), true,
    ) : [];
    const next = new Map<HTMLElement, Group>();
    // Keep unchanged memberships intact: removing/readding visibility markers
    // restarts native/CSS layout motion during every streamed content update.
    const retained = new Set(runs.filter(run => !run.every(item => item.kind === 'reasoning'))
      .flatMap(run => run.map(item => item.value)));
    for (const group of previous.values()) {
      for (const member of group.members) if (!retained.has(member)) unmark(member);
    }
    for (const run of runs) {
      // A standalone thought already has a native disclosure of its own.
      if (run.every(item => item.kind === 'reasoning')) continue;
      const first = run[0]!.value;
      const failed = run.some(item => item.failed);
      let group = previous.get(first);
      if (!group) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('data-ccd-tool-group-toggle', '');
        const viewport = document.createElement('span');
        viewport.setAttribute('data-ccd-tool-roll', '');
        const label = document.createElement('span');
        label.setAttribute('data-ccd-tool-roll-label', '');
        viewport.append(label);
        const arrow = document.createElement('span');
        arrow.setAttribute('aria-hidden', 'true');
        arrow.setAttribute('data-ccd-tool-group-chevron', '');
        button.append(viewport, arrow);
        group = { button, label, members: [], open: failed, failed };
        const current = group;
        button.addEventListener('click', () => {
          toggle(current);
        });
      } else if (failed && !group.failed) {
        group.open = true;
      }
      group.failed = failed;
      group.members = run.map(item => item.value);
      if (document.activeElement && group.members.some(member => member.contains(document.activeElement))) group.open = true;
      for (const item of run) item.value.setAttribute('data-ccd-tool-group-kind', item.kind);
      const live = [...run].reverse().find(item => item.live);
      if (live) group.button.setAttribute('data-ccd-tool-live', '');
      else group.button.removeAttribute('data-ccd-tool-live');
      const files = run.flatMap(item => item.file ? [item.file] : []);
      const otherKinds = run.filter(item => !item.file).map(item => item.kind);
      const remaining = toolGroupLabel(otherKinds as ToolGroupKind[]);
      const others = remaining ? [remaining] : [];
      const parts = !live && files.length ? fileSummaryParts(files, others) : null;
      const text = live?.description || toolGroupLabel(run.map(item => item.kind as ToolGroupKind));
      const renderKey = JSON.stringify(parts ?? text);
      const reducedMotion = document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const canAnimate = !!group.label.animate && !reducedMotion;
      // Re-read the host when the dwell expires: intermediate streamed states
      // are coalesced, never queued to play after they have become stale.
      clearTimeout(group.refreshTimer);
      delete group.refreshTimer;
      const remainingDwell = group.shownAt !== undefined && canAnimate && (live || group.shownLive) && !failed
        ? Math.max(0, 900 - (Date.now() - (group.shownAt ?? 0))) : 0;
      if (group.renderKey !== renderKey && remainingDwell > 0) {
        group.refreshTimer = setTimeout(() => {
          if (released) return;
          try { syncParent(parent); } catch (error) { report(error); }
        }, remainingDwell);
      } else if (group.renderKey !== renderKey) {
        group.renderKey = renderKey;
        group.shownAt = Date.now();
        group.shownLive = !!live;
        const oldText = group.label.textContent;
        group.animations?.forEach(animation => animation.cancel());
        group.outgoing?.remove();
        delete group.outgoing;
        group.label.textContent = parts ? '' : text;
        if (parts) for (const part of parts) {
          const span = document.createElement('span');
          span.setAttribute('data-ccd-file-summary-tone', part.tone);
          span.textContent = part.text;
          group.label.append(span);
        }
        if (oldText && canAnimate) {
          const outgoing = document.createElement('span');
          outgoing.textContent = oldText;
          outgoing.setAttribute('data-ccd-tool-roll-out', '');
          outgoing.setAttribute('aria-hidden', 'true');
          group.label.parentElement!.append(outgoing);
          group.outgoing = outgoing;
          // Settling into the final summary only fades; live activity keeps a
          // small directional cue without rolling through an entire line. The
          // gentler acceleration leaves time to perceive the change itself.
          const options = { duration: 380, easing: 'cubic-bezier(.25, .1, .25, 1)' };
          const exit = outgoing.animate([{ transform: 'translateY(0)', opacity: 1 },
            { transform: live ? 'translateY(-5px)' : 'translateY(0)', opacity: 0 }], { ...options, duration: 220, fill: 'forwards' });
          group.animations = [exit, group.label.animate([{ transform: live ? 'translateY(6px)' : 'translateY(0)', opacity: 0 },
            { transform: 'translateY(0)', opacity: 1 }], options)];
          exit.onfinish = () => outgoing.remove();
        }
      }
      if (group.button.nextElementSibling !== first) parent.insertBefore(group.button, first);
      paint(group);
      next.set(first, group);
    }
    for (const [first, group] of previous) {
      // Membership was already cleared above; a joined run may now own it.
      if (!next.has(first)) {
        clearTimeout(group.refreshTimer);
        group.animations?.forEach(animation => animation.cancel());
        group.outgoing?.remove();
        group.button.remove();
      }
    }
    if (next.size) groups.set(parent, next);
    else groups.delete(parent);
  };
  const flush = () => {
    pending = false;
    if (released) return;
    try {
      for (const row of fileTitles.keys()) if (!row.isConnected || !row.closest(ANCHOR.toolFlow)) restoreFileTitle(row);
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
    for (const child of element.querySelectorAll<HTMLElement>(ANCHOR.reasoningFlow)) {
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
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['data-state', 'data-tool', 'data-cordis-status', 'disabled', 'data-chat-flow-kind', 'data-chat-turn', 'data-chat-group-part', 'data-variant'],
  });
  collect(document.body);
  flush();
  return () => {
    released = true;
    observer.disconnect();
    dirty.clear();
    for (const parent of groups.values()) for (const group of parent.values()) disposeGroup(group);
    groups.clear();
    for (const row of fileTitles.keys()) restoreFileTitle(row);
  };
}
