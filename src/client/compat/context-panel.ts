import type {
  ContextPanelPort, ContextPanelSnapshot, ContextProjectionPort, ContextProjectionRead, Disposer,
} from '../contracts/ports.ts';
import {
  contextBreakdown, mcpServer, type ContextBreakdown, type ContextEntry,
} from '../../shared/context.ts';
import { hostAnchors, hostSelectors } from './host-dom.ts';

/**
 * The context ring's breakdown panel, driven instead of replaced.
 *
 * DSH opens its own 264px panel from the ring's `onClick` and publishes no face
 * that reads or drives it, so this module owns the interaction outright: it
 * intercepts the trigger's click, holds the open and expanded state, and reads
 * the numbers off the session list — where the host's own `contextPressure` and
 * `contextBreakdown` projections, and this plugin's `ccdContext`, all arrive as
 * wire values.
 *
 * Three details decide how it is written:
 *
 * - **The trigger's click is intercepted in the capture phase.** DSH's handler
 *   is React's `onClick`, delegated at the renderer root; stopping the event on
 *   the button before it bubbles keeps that handler from running, so the host's
 *   panel never opens. This is the same device `compat/view-options.ts` uses for
 *   the sidebar's menu, and it is why the host's open state never has to be
 *   driven — a driven panel would be dismissed by the host's own
 *   `useDismissOnOutsidePointer` the moment the reader clicked inside ours.
 * - **The document element carries the open marker.** `composer.css` keys the
 *   host panel's removal off `[data-ccd-context-open]`, so a click that somehow
 *   reaches DSH's handler still leaves the reader looking at one panel. The
 *   marker is belt to the interception's braces, not the mechanism.
 * - **A trigger that goes away closes the panel.** The ring is drawn by the
 *   Conversation page, so a session switch, a page change or a compaction that
 *   empties the reading all replace it; each of those has to put the panel away
 *   rather than leave it hanging over a control that is no longer there.
 */

/** Marks the host popup this module has taken over; the sheet keeps it off screen. */
export const OPEN_MARKER = 'data-ccd-context-open';

/** Marks the ring trigger while this plugin's panel is the one on screen. */
export const OPEN_ATTRIBUTE = 'data-ccd-context-panel';

/** The driver's own face, plus the release the mounting scope holds. */
export interface ContextPanelDriver {
  readonly port: ContextPanelPort;
  dispose(): void;
}

/** One session id off the conversation body the ring sits in. */
function sessionOf(document: Document, trigger: HTMLElement | null): string | null {
  if (trigger === null) return null;
  const body = trigger.closest<HTMLElement>(hostAnchors(document).conversationSession);
  const id = body?.getAttribute('data-conversation-session') ?? '';
  return id === '' ? null : id;
}

/**
 * Whether two readings carry the same numbers and the same drill-down rows.
 *
 * The host re-sends the whole projection set on every frame, so reference
 * equality says nothing about whether this session changed. Comparing the
 * handful of scalars plus the four row lists (each a short, ordered tuple
 * list) is far cheaper than rebuilding the breakdown and re-rendering the card.
 */
function sameReading(left: ContextProjectionRead, right: ContextProjectionRead): boolean {
  if (left === right) return true;
  if (left.window !== right.window || left.used !== right.used
    || left.systemTokens !== right.systemTokens || left.toolsTokens !== right.toolsTokens
    || left.messageTokens !== right.messageTokens) return false;
  const a = left.breakdown, b = right.breakdown;
  if (a === b) return true;
  if (a === null || b === null) return false;
  return a.skillTokens === b.skillTokens && a.fileTokens === b.fileTokens
    && a.compaction === b.compaction
    && sameEntries(a.tools, b.tools) && sameEntries(a.files, b.files)
    && sameEntries(a.skills, b.skills);
}

/** One entry list, compared by name and tokens in order. */
function sameEntries(
  left: readonly ContextEntry[] | undefined,
  right: readonly ContextEntry[] | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!, b = right[index]!;
    if (a[0] !== b[0] || a[1] !== b[1]) return false;
  }
  return true;
}

/** Split this plugin's tool rows into the two groups the panel draws. */
function splitTools(tools: readonly ContextEntry[]): {
  readonly mcp: readonly ContextEntry[];
  readonly tools: readonly ContextEntry[];
} {
  const mcp: ContextEntry[] = [];
  const builtin: ContextEntry[] = [];
  for (const entry of tools) {
    if (mcpServer(entry[0]) === null) builtin.push(entry);
    else mcp.push(entry);
  }
  return { mcp, tools: builtin };
}

/**
 * Watch the context ring and open this plugin's panel from it.
 *
 * @param document - renderer document carrying the Conversation page.
 * @param projections - the host's context readings, off the session list.
 * @param report - sink for observer failures; the ring keeps DSH's own panel.
 * @returns the port the card reads through, and the release of every observer.
 */
export function createContextPanelDriver(
  document: Document,
  projections: ContextProjectionPort,
  report: (error: unknown) => void,
): ContextPanelDriver {
  const host = hostSelectors(document);
  let trigger: HTMLElement | null = null;
  let attached: HTMLElement | null = null;
  let open = false;
  let expanded = false;
  let sessionId: string | null = null;
  let snapshot: ContextPanelSnapshot = {
    open: false, anchor: null, breakdown: null, mcp: [], tools: [], files: [], skills: [], expanded: false,
  };
  let listener: (() => void) | null = null;
  let scheduled = 0;
  let tree: MutationObserver | undefined;
  let attributes: MutationObserver | undefined;
  let projectionsOff: Disposer | null = null;

  /**
   * The reading for the session on screen, or null while the ring has none.
   *
   * The session list notifies for every session it carries, and each frame
   * carries the same wire values again. Rebuilding the breakdown (and the card
   * with it) for a frame that did not move this session's numbers would put
   * React and the popover's layout effects through a full cycle per frame, so
   * the raw reading is compared first and the last answer reused when it is
   * unchanged.
   */
  let cached: {
    readonly raw: ContextProjectionRead;
    readonly value: ReturnType<typeof buildReading>;
  } | null = null;
  /** The raw reading the currently published snapshot was built from. */
  let publishedRaw: ContextProjectionRead | null = null;

  /** This session's wire reading, without building anything from it. */
  const rawReading = (): ContextProjectionRead | null =>
    sessionId === null ? null : projections.read(sessionId);

  function buildReading(values: ContextProjectionRead): {
    readonly breakdown: ContextBreakdown;
    readonly mcp: readonly ContextEntry[];
    readonly tools: readonly ContextEntry[];
    readonly files: readonly ContextEntry[];
    readonly skills: readonly ContextEntry[];
  } {
    const rows = values.breakdown;
    const tools = rows?.tools ?? [];
    const split = splitTools(tools);
    return {
      breakdown: contextBreakdown({
        window: values.window,
        used: values.used,
        systemTokens: values.systemTokens,
        toolsTokens: values.toolsTokens,
        messageTokens: values.messageTokens,
        tools,
        skillTokens: rows?.skillTokens ?? 0,
        fileTokens: rows?.fileTokens ?? 0,
        compaction: rows?.compaction ?? null,
      }),
      mcp: split.mcp,
      tools: split.tools,
      files: rows?.files ?? [],
      skills: rows?.skills ?? [],
    };
  }

  const reading = (values: ContextProjectionRead): ReturnType<typeof buildReading> => {
    if (cached !== null && sameReading(cached.raw, values)) return cached.value;
    const value = buildReading(values);
    cached = { raw: values, value };
    return value;
  };

  /** Reflect this plugin's own state on the trigger and the document element. */
  const mark = () => {
    const node = trigger;
    if (node !== null) {
      // setAttribute notifies observers even when the value is unchanged, and
      // this attribute is itself observed: an unguarded write starves the
      // event loop while the host re-renders the ring.
      const value = open ? 'true' : 'false';
      if (node.getAttribute('aria-expanded') !== value) node.setAttribute('aria-expanded', value);
      if (open) {
        if (!node.hasAttribute(OPEN_ATTRIBUTE)) node.setAttribute(OPEN_ATTRIBUTE, '');
      } else {
        node.removeAttribute(OPEN_ATTRIBUTE);
      }
    }
    const html = document.documentElement;
    if (open) {
      if (!html.hasAttribute(OPEN_MARKER)) html.setAttribute(OPEN_MARKER, '');
    } else {
      html.removeAttribute(OPEN_MARKER);
    }
  };

  /**
   * Rebuild the published snapshot and wake the card.
   *
   * `useSyncExternalStore` compares snapshots by identity, so the object is
   * replaced here — on every state change — and nowhere else.
   */
  const refresh = () => {
    const raw = open ? rawReading() : null;
    const found = raw === null ? null : reading(raw);
    publishedRaw = raw;
    snapshot = {
      open,
      anchor: trigger,
      breakdown: found?.breakdown ?? null,
      mcp: found?.mcp ?? [],
      tools: found?.tools ?? [],
      files: found?.files ?? [],
      skills: found?.skills ?? [],
      expanded,
    };
    mark();
    listener?.();
  };

  /** Forget everything derived from one session's reading. */
  const forget = () => {
    cached = null;
    publishedRaw = null;
  };

  const close = () => {
    if (!open) return;
    open = false;
    expanded = false;
    forget();
    refresh();
  };

  const onClick = (event: MouseEvent) => {
    /* React delegates at the renderer root, so stopping the event here — in the
       capture phase, on the button itself — keeps the host's own
       `setOpen(v => !v)` from running. The panel below is ours, not theirs. */
    event.stopPropagation();
    if (open) {
      close();
      return;
    }
    sessionId = sessionOf(document, trigger);
    expanded = false;
    open = true;
    refresh();
  };

  const sync = () => {
    scheduled = 0;
    const found = document.querySelector<HTMLElement>(host.contextMeterTrigger);
    if (found === attached) {
      /* The same control can be re-rendered under a different Session, which is
         the one thing the anchor's identity does not say. */
      const current = sessionOf(document, found);
      if (open && current !== sessionId) {
        sessionId = current;
        forget();
        close();
        return;
      }
      mark();
      return;
    }
    attributes?.disconnect();
    attributes = undefined;
    attached?.removeEventListener('click', onClick, true);
    attached = found;
    trigger = found;
    if (found !== null) {
      found.addEventListener('click', onClick, true);
      /* The host's own primitive writes `aria-expanded` from its state while it
         re-renders the ring; this module owns the state the reader sees. */
      attributes = new MutationObserver(schedule);
      attributes.observe(found, { attributes: true, attributeFilter: ['aria-expanded'] });
    }
    if (open) {
      open = false;
      expanded = false;
    }
    forget();
    sessionId = sessionOf(document, found);
    refresh();
  };

  const schedule = () => {
    if (scheduled !== 0) return;
    scheduled = 1;
    try {
      sync();
    } finally {
      scheduled = 0;
    }
  };

  try {
    tree = new MutationObserver(schedule);
    tree.observe(document.body, { childList: true, subtree: true });
    /* Only a frame that actually moved this session's reading wakes the card;
       the list notifies for every session it carries. A session with no
       capacity publishes no reading either, and an unchanged absence is as
       uninteresting as an unchanged number. */
    projectionsOff = projections.subscribe(() => {
      if (!open) return;
      const raw = rawReading();
      if (raw === publishedRaw) return;
      if (raw !== null && publishedRaw !== null && sameReading(publishedRaw, raw)) return;
      refresh();
    });
    sync();
  } catch (error) {
    tree?.disconnect();
    attributes?.disconnect();
    projectionsOff?.();
    report(error);
  }

  const port: ContextPanelPort = {
    getSnapshot: () => snapshot,
    subscribe(next) {
      listener = next;
      return () => { if (listener === next) listener = null; };
    },
    close,
    toggleExpanded() {
      if (!open) return;
      expanded = !expanded;
      refresh();
    },
  };

  return {
    port,
    dispose() {
      scheduled = 0;
      tree?.disconnect();
      attributes?.disconnect();
      projectionsOff?.();
      attached?.removeEventListener('click', onClick, true);
      /* The trigger is handed back as the host drew it: the open marker and the
         ARIA state are this module's own, and a released plugin must not leave
         a lit control behind. */
      attached?.removeAttribute(OPEN_ATTRIBUTE);
      attached?.removeAttribute('aria-expanded');
      document.documentElement.removeAttribute(OPEN_MARKER);
      listener = null;
      trigger = null;
      attached = null;
      open = false;
      expanded = false;
      sessionId = null;
      forget();
    },
  };
}
