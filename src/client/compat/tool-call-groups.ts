import type { Disposer } from '../contracts/ports.ts';
import { ANCHOR, hostSelectors } from './host-dom.ts';
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
 * Whether a reply seat already holds body text.
 *
 * A response seat can carry a reasoning block before its answer, so thought
 * text never counts; only text outside a thought, or a streaming element
 * outside one, is the reply this run was waiting for.
 */
function replyStarted(seat: Element): boolean {
  const thoughts = [...seat.querySelectorAll('[data-variant="think"]')];
  if (thoughts.length === 0) return !!seat.textContent?.trim();
  const streams = [...seat.querySelectorAll('[data-streaming]')]
    .filter(element => !element.closest('[data-variant="think"]'));
  if (streams.length) return streams.some(element => !!element.textContent?.trim());
  // The host drops data-streaming once the reply finishes; whatever text is
  // left outside the thoughts is then the finished answer.
  let text = seat.textContent ?? '';
  for (const thought of thoughts) text = text.replace(thought.textContent ?? '', '');
  return !!text.trim();
}

/**
 * The running row of the transcript that holds these rows.
 *
 * ChatFlow seats it as a sibling of the flow rows, so only a direct child of
 * the rows' own list (or an ancestor) counts; another mounted transcript
 * still working never keeps this one's runs live.
 */
function runningFor(parent: Element): Element | null {
  for (let element: Element | null = parent; element !== null; element = element.parentElement) {
    const running = [...element.children].find(child => child.hasAttribute('data-chat-running'));
    if (running) return running;
  }
  return null;
}

/**
 * Whether a reply or a later turn's content follows this run's last call.
 *
 * The host seats the running row beside the flow rows and gives every row a
 * group part, so a trailing reasoning seat is a thought the next call may
 * still follow, while an empty reply seat has not started streaming yet.
 * Without a running row the turn is over, and every run has been answered.
 */
function answeredAfter(last: Element, running: Element | null): boolean {
  if (running === null) return true;
  // A host step group seats its calls inside its own body, so the reply that
  // follows them is a sibling of the group rather than of its last call.
  for (let seat: Element | null = last; seat !== null;
    seat = seat.parentElement?.closest('[data-step-process]') ?? null) {
    for (let sibling = seat.nextElementSibling; sibling !== null; sibling = sibling.nextElementSibling) {
      if (sibling.hasAttribute('data-ccd-tool-group-toggle') || sibling.hasAttribute('data-chat-running')) continue;
      if (sibling.getAttribute('data-chat-group-part') === 'reasoning') continue;
      if (sibling.getAttribute('data-chat-flow-kind') === 'assistant-step' && !replyStarted(sibling)) continue;
      return true;
    }
  }
  return false;
}

/**
 * Hand bottom-follow back to the host once a fold left the reader on the floor.
 *
 * ChatView shows its jump-to-bottom control whenever it is not following the
 * tail, and only a reader's own arrival at the floor resumes following. A run
 * folding with `display: none` shrinks the transcript at once; the browser
 * clamps the scroll offset to the new floor, which the host attributes to
 * layout rather than to the reader, so the control stays up with nothing left
 * below. Pressing that control runs the host's own `returnToBottom`, which at
 * the floor lands without moving.
 *
 * The control is read first: while the host follows there is none, and the
 * scroll geometry is never measured.
 * @param document - the renderer document, for this build's selectors.
 * @param from - an element of the transcript that just shrank.
 * @returns whether following was handed back.
 */
export function resumeTailAtFloor(document: Document, from: Element): boolean {
  if (!from.isConnected) return false;
  const host = hostSelectors(document);
  // ChatView renders frame > root > scroll, and seats the control's slot as a
  // direct child of the frame — never a nested transcript's control.
  const list = from.closest<HTMLElement>(host.chatViewScroll);
  const frame = list?.parentElement?.parentElement;
  if (!list || !frame) return false;
  const slot = [...frame.children].find(child => child.matches(host.chatViewToBottomSlot));
  const button = slot?.querySelector<HTMLElement>(host.chatViewToBottom);
  if (!button) return false;
  // The same scrollport and floor tolerance ChatView measures against.
  const scroller = list.closest<HTMLElement>(ANCHOR.conversationScroll) ?? list;
  if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop >= 1) return false;
  button.click();
  return true;
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
  /** Paint one group; reports whether a member that was on screen is now folded. */
  const paint = (group: Group): boolean => {
    let folded = false;
    group.button.setAttribute('aria-expanded', String(group.open));
    group.members.forEach((member, index) => {
      if (!group.open && member.getAttribute('data-ccd-tool-group-member') !== 'closed') folded = true;
      member.setAttribute('data-ccd-tool-group-member', group.open ? 'open' : 'closed');
      member.setAttribute('data-ccd-tool-group-edge', group.members.length === 1 ? 'only'
        : index === 0 ? 'first' : index === group.members.length - 1 ? 'last' : 'middle');
    });
    return folded;
  };
  const toggle = (group: Group) => {
    group.open = !group.open;
    if (paint(group)) resumeTailAtFloor(document, group.button);
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
    // A thought still streaming joins the run as its live row, so it rolls in
    // the same line as the calls instead of opening a disclosure below them.
    const thoughts = [...element.querySelectorAll('[data-variant="think"]')];
    const thinking = thoughts.some(thought => !['ok', 'error', 'stopped'].includes(thought.getAttribute('data-state') ?? ''));
    if (element.matches(ANCHOR.reasoningFlow)) {
      return {
        value: element, kind: thoughts.length ? 'reasoning' : 'barrier',
        turn: element.getAttribute('data-chat-turn'),
        settled: thoughts.length > 0 && thoughts.every(thought => thought.getAttribute('data-state') === 'ok'),
        live: thinking, description: 'Thinking',
        failed: false,
      };
    }
    // A reply seat may open with its thought; only while that thought streams
    // and no body text has started is the seat still the run's activity.
    if (thinking && element.getAttribute('data-chat-flow-kind') === 'assistant-step' && !replyStarted(element)) {
      return {
        value: element, kind: 'reasoning', turn: element.getAttribute('data-chat-turn'),
        settled: false, live: true, description: 'Thinking', failed: false,
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
    let folded = false;
    const running = runningFor(parent);
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
      // A run keeps rolling its own calls — live, then the last settled one —
      // until a reply (or a later turn) follows it. Only then does the run
      // fold into its counts summary, so the reader never sees "Thought, read
      // 4 files…" while the turn is still working through calls.
      const followed = answeredAfter(run[run.length - 1]!.value, running);
      // An interrupted turn can leave a thought or call marked running for
      // good; once anything follows or the turn has ended, it is not live.
      const live = followed ? undefined : [...run].reverse().find(item => item.live);
      const answered = !failed && followed;
      const files = run.flatMap(item => item.file ? [item.file] : []);
      const otherKinds = run.filter(item => !item.file).map(item => item.kind);
      const remaining = toolGroupLabel(otherKinds as ToolGroupKind[]);
      const others = remaining ? [remaining] : [];
      const parts = (answered || failed) && !live && files.length ? fileSummaryParts(files, others) : null;
      const summary = toolGroupLabel(run.map(item => item.kind as ToolGroupKind));
      const current = [...run].reverse().find(item => item.kind !== 'reasoning')?.description;
      const text = live?.description || (answered || failed ? summary : current || summary);
      const renderKey = JSON.stringify(parts ?? text);
      const reducedMotion = document.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const canAnimate = !!group.label.animate && !reducedMotion;
      group.members = run.map(item => item.value);
      if (document.activeElement && group.members.some(member => member.contains(document.activeElement))) group.open = true;
      for (const item of run) item.value.setAttribute('data-ccd-tool-group-kind', item.kind);
      // A settled call that the turn may still continue stays marked live: the
      // row is the turn's current activity, not a finished summary.
      if (live || (!answered && !failed && run.every(item => item.settled))) group.button.setAttribute('data-ccd-tool-live', '');
      else group.button.removeAttribute('data-ccd-tool-live');
      clearTimeout(group.refreshTimer);
      delete group.refreshTimer;
      const remainingDwell = group.shownAt !== undefined && canAnimate && (live || group.shownLive) && !failed
        ? Math.max(0, 900 - (Date.now() - (group.shownAt ?? 0))) : 0;
      if (group.renderKey !== renderKey && remainingDwell > 0) {
        // Re-read the host when the dwell expires: intermediate streamed states
        // are coalesced, never queued to play after they have become stale.
        group.refreshTimer = setTimeout(() => {
          if (released) return;
          try { syncParent(parent); } catch (error) { report(error); }
        }, remainingDwell);
      } else if (group.renderKey !== renderKey) {
        const viewport = group.label.parentElement!;
        // Measure before cancelling: an interrupted transition must continue
        // from its visible width rather than jump to its previous destination.
        const oldWidth = canAnimate ? viewport.getBoundingClientRect().width : 0;
        group.renderKey = renderKey;
        group.shownAt = Date.now();
        group.shownLive = !!live || (!answered && !failed && run.every(item => item.settled));
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
        if (oldText && canAnimate && !failed) {
          const outgoing = document.createElement('span');
          outgoing.textContent = oldText;
          outgoing.setAttribute('data-ccd-tool-roll-out', '');
          outgoing.setAttribute('aria-hidden', 'true');
          viewport.append(outgoing);
          group.outgoing = outgoing;
          // Crossfade with a small directional cue and no blank pause. The
          // incoming line gets its full intrinsic width throughout the motion,
          // so a longer description never grows out of a moving ellipsis.
          const options = { duration: 360, easing: 'cubic-bezier(.2, .65, .3, 1)' };
          const exit = outgoing.animate([{ transform: 'translateY(0)', opacity: 1 },
            { transform: live ? 'translateY(-4px)' : 'translateY(0)', opacity: 0 }], { duration: 180, easing: 'ease-in', fill: 'forwards' });
          group.animations = [exit, group.label.animate([
            { transform: live ? 'translateY(4px)' : 'translateY(0)', opacity: 0 },
            { transform: 'translateY(0)', opacity: 1 },
          ], { ...options, delay: 40, fill: 'backwards' })];
          const width = viewport.getBoundingClientRect().width;
          // Reserve the larger width while the old line fades. Only the outer
          // seat resizes; neither text layer is squeezed during the crossfade.
          if (oldWidth !== width) {
            const seatWidth = Math.max(oldWidth, width);
            group.animations.push(viewport.animate([
              { width: `${seatWidth}px` }, { width: `${width}px` },
            ], { duration: 220, delay: 180, easing: 'ease-in-out', fill: 'backwards' }));
          }
          exit.onfinish = () => outgoing.remove();
        }
      }
      if (group.button.nextElementSibling !== first) parent.insertBefore(group.button, first);
      if (paint(group)) folded = true;
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
    // Streamed calls and thoughts fold into a closed run on their own; the
    // same shrink can strand the host's control as a reader's collapse does.
    if (folded) resumeTailAtFloor(document, parent);
  };
  const flush = () => {
    pending = false;
    if (released) return;
    try {
      for (const row of fileTitles.keys()) if (!row.isConnected || !row.closest(ANCHOR.toolFlow)) restoreFileTitle(row);
      for (const parent of groups.keys()) {
        // A reply streaming beside a step group only marks the outer list, yet
        // it answers the run inside that group.
        const group = parent.closest('[data-step-process]');
        if (!parent.isConnected || (group?.parentElement && dirty.has(group.parentElement as HTMLElement))) dirty.add(parent);
      }
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
      // The running row is a sibling of the flow rows rather than one of them,
      // and its appearance or removal is what tells a working turn from a
      // finished one, so every tracked parent has to re-read itself.
      if (record.target.nodeType === 1 && (record.target as Element).hasAttribute('data-chat-running')) {
        for (const parent of groups.keys()) dirty.add(parent);
      }
      collect(record.target);
      for (const node of record.addedNodes ?? []) collect(node);
      for (const node of record.removedNodes ?? []) {
        if (node.nodeType === 1 && (node as Element).hasAttribute('data-chat-running')) {
          for (const parent of groups.keys()) dirty.add(parent);
        }
      }
    }
    for (const parent of groups.keys()) if (!parent.isConnected) dirty.add(parent);
    if (!pending && dirty.size) {
      pending = true;
      queueMicrotask(flush);
    }
  });
  observer.observe(document.body, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['data-state', 'data-tool', 'data-cordis-status', 'disabled', 'data-chat-flow-kind',
      'data-chat-turn', 'data-chat-group-part', 'data-variant', 'data-streaming', 'data-chat-running'],
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
