import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import type { ContextPanelPort, ContextPanelSnapshot, ContextDetailGroup } from '../../contracts/ports.ts';
import {
  barSegments, formatPercent, formatTokens, shortenPath,
  toolLabel, type ContextEntry, type ContextSliceKey,
} from '../../../shared/context.ts';

/**
 * The context ring's breakdown panel.
 *
 * Two states, and the collapsed one is the default. **Collapsed** is the
 * reference's own card: a header line (`Context window` on the left, the ring's
 * reading on the right, a disclosure mark at the end) over a 4px segmented bar.
 * **Expanded** adds the category rows and, under them, one drill-down group per
 * category that has rows. There is deliberately no button at the bottom: the
 * header line is the whole of the affordance, which is what the reference
 * carries once its own `See detailed breakdown` control is taken away.
 *
 * The numbers are never computed here. The header reads the host's
 * `contextPressure` — the same value the ring beside it draws — and the rows
 * come from `contextBreakdown` plus this plugin's `ccdContext`; the arithmetic
 * lives in `shared/context.ts` so this file is only layout and copy.
 */

/** The panel's own copy, in the one language the document is in. */
interface Copy {
  readonly title: string;
  /** Shown instead of a reading while the session has no request yet. */
  readonly waiting: string;
  readonly expand: string;
  readonly collapse: string;
  /** Row names, in the reference's own order. */
  readonly rows: Readonly<Record<ContextSliceKey, string>>;
  /** Drill-down group names; only four categories have one. */
  readonly groups: Readonly<Record<'mcp' | 'tools' | 'skills' | 'memory', string>>;
  /** The row count a group's header carries. */
  readonly count: string;
}

/** Where the plugin's own copy lives; the host's numbers are read from it. */
const COPY: { readonly zh: Copy; readonly en: Copy } = {
  zh: {
    title: '上下文窗口',
    waiting: '等待首个请求',
    expand: '展开明细',
    collapse: '收起明细',
    rows: {
      mcp: 'MCP 工具',
      tools: '系统工具',
      system: '系统提示词',
      skills: '技能',
      memory: '记忆文件',
      messages: '对话消息',
      autocompact: '自动压缩余量',
      free: '空闲空间',
    },
    groups: { mcp: 'MCP 工具', tools: '系统工具', skills: '技能', memory: '记忆文件' },
    count: '项',
  },
  en: {
    title: 'Context window',
    waiting: 'Waiting for the first request',
    expand: 'Expand the breakdown',
    collapse: 'Collapse the breakdown',
    rows: {
      mcp: 'MCP tools',
      tools: 'System tools',
      system: 'System prompt',
      skills: 'Skills',
      memory: 'Memory files',
      messages: 'Messages',
      autocompact: 'Autocompact buffer',
      free: 'Free space',
    },
    groups: { mcp: 'MCP tools', tools: 'System tools', skills: 'Skills', memory: 'Memory files' },
    count: 'items',
  },
};

/** The categories that carry a drill-down, and the snapshot field each reads. */
const GROUP_SOURCES = [
  { key: 'mcp', rows: 'mcp' },
  { key: 'tools', rows: 'tools' },
  { key: 'skills', rows: 'skills' },
  { key: 'memory', rows: 'files' },
] as const;

/** The bar's width before the first measurement, and the panel's own content width. */
const ASSUMED_BAR_WIDTH = 334;

function copyFor(document: Document): Copy {
  const language = (document.documentElement.lang || globalThis.navigator?.language || '').toLowerCase();
  return language.startsWith('zh') ? COPY.zh : COPY.en;
}

/** One disclosure mark, drawn at the reference's 12px and rotated when open. */
function Chevron({ open }: { readonly open: boolean }): ReactElement {
  return (
    <svg
      className="ccd-context-chevron"
      data-ccd-context-chevron={open ? 'open' : 'closed'}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6.25 3.5L10.75 8L6.25 12.5" />
    </svg>
  );
}

export interface ContextPanelProps {
  readonly port: ContextPanelPort;
}

/**
 * The panel, in whichever of its two states the port says.
 *
 * @param props - the driver's port.
 * @returns the card, or null while it is closed.
 */
export function ContextPanel({ port }: ContextPanelProps): ReactElement | null {
  const state: ContextPanelSnapshot = useSyncExternalStore(port.subscribe, port.getSnapshot);
  const panel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(ASSUMED_BAR_WIDTH);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set());
  const copy = copyFor(document);
  const { open, anchor, breakdown, expanded } = state;

  /* Group disclosure lasts only for this opening. Reset before paint when
     the popup opens again, including when the overlay component stays mounted. */
  useLayoutEffect(() => {
    setExpandedGroups(new Set());
  }, [open]);

  /* The card is a manual popover: the top layer is what puts it over the host's
     own portal (a `z-index: 1100` box on `body`) without moving anyone's DOM,
     and it is the same device the plugin's model and view-options cards use. It
     hangs from the ring's own box, 8px above it, and is clamped into the
     viewport by the reference's 12px margin. */
  useLayoutEffect(() => {
    const surface = panel.current;
    if (!open || surface === null) return;
    surface.setAttribute('popover', 'manual');
    surface.showPopover();
    const place = () => {
      const node = anchor;
      if (node === null) return;
      const a = node.getBoundingClientRect();
      const p = surface.getBoundingClientRect();
      const left = Math.max(12, Math.min(a.right - p.width, window.innerWidth - p.width - 12));
      const top = Math.max(12, Math.min(a.top - p.height - 8, window.innerHeight - p.height - 12));
      // The observer below sees our own inline style too. Once placement has
      // settled, stop writing so its notifications can drain.
      const nextLeft = `${left}px`;
      const nextTop = `${top}px`;
      if (surface.style.left !== nextLeft) surface.style.left = nextLeft;
      if (surface.style.top !== nextTop) surface.style.top = nextTop;
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'] });
    const resize = new ResizeObserver(place);
    resize.observe(surface);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', place);
      if (surface.matches(':popover-open')) surface.hidePopover();
    };
  }, [open, anchor, breakdown, expanded]);

  /* The bar's own width decides which slivers the reference would drop, so it
     is measured rather than assumed: the panel is a fixed 360px, but a narrow
     window is allowed to shrink it. */
  useLayoutEffect(() => {
    const surface = bar.current;
    if (!open || surface === null) return;
    const measure = () => {
      const width = Math.round(surface.getBoundingClientRect().width);
      if (width > 0) setBarWidth(current => (current === width ? current : width));
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(surface);
    return () => { resize.disconnect(); };
  }, [open, expanded, breakdown]);

  /* Dismissal, in the family's own terms: a pointer outside, focus leaving, or
     Escape. The trigger is exempt because a second click on it closes the panel
     through the driver's own toggle. */
  useEffect(() => {
    if (!open) return;
    const outside = (target: Node): boolean =>
      panel.current?.contains(target) !== true && anchor?.contains(target) !== true;
    const onPointer = (event: PointerEvent) => {
      if (outside(event.target as Node)) port.close();
    };
    const onFocus = (event: FocusEvent) => {
      if (outside(event.target as Node)) port.close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (anchor instanceof HTMLElement) anchor.focus();
      port.close();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, anchor, port]);

  if (!open) return null;

  /** The card's rows in DOM order — what the keyboard walks. */
  const focusables = (): HTMLElement[] => {
    const surface = panel.current;
    if (surface === null) return [];
    return [...surface.querySelectorAll<HTMLElement>('[data-ccd-context-focus]')];
  };

  const onCardKey = (event: ReactKeyboardEvent) => {
    if (event.key !== 'Tab') return;
    /* A popover has no natural next stop inside the page, and the family's own
       card traps the walk rather than letting Tab leave it. */
    const list = focusables();
    if (list.length === 0) return;
    event.preventDefault();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const step = event.shiftKey ? -1 : 1;
    const next = index === -1 ? 0 : (index + step + list.length) % list.length;
    list[next]?.focus();
  };

  const reading = breakdown === null
    ? null
    : `${formatTokens(breakdown.used)} / ${formatTokens(breakdown.window)} (${breakdown.percent}%)`;

  const segments = breakdown === null
    ? { drawn: [] as readonly { readonly key: ContextSliceKey; readonly tokens: number }[], free: 0 }
    : barSegments(breakdown, barWidth);

  const groups: ContextDetailGroup[] = [];
  if (breakdown !== null) {
    for (const source of GROUP_SOURCES) {
      const rows: readonly ContextEntry[] = state[source.rows];
      if (rows.length === 0) continue;
      const tokens = breakdown.slices.find(entry => entry.key === source.key)?.tokens ?? 0;
      groups.push({ label: copy.groups[source.key], tokens, rows });
    }
  }

  return (
    <div
      className="ccd-context-panel"
      data-ccd-context-panel=""
      data-menu-material=""
      role="dialog"
      aria-label={copy.title}
      ref={panel}
      onKeyDown={onCardKey}
    >
      <button
        type="button"
        className="ccd-context-head"
        data-ccd-context-focus=""
        data-ccd-context-head=""
        aria-expanded={expanded}
        aria-label={`${copy.title} — ${expanded ? copy.collapse : copy.expand}`}
        onClick={() => { port.toggleExpanded(); }}
      >
        <span className="ccd-context-title">{copy.title}</span>
        <span className="ccd-context-figures" data-ccd-context-figures={reading === null ? 'waiting' : 'ready'}>
          {reading ?? copy.waiting}
        </span>
        <Chevron open={expanded} />
      </button>
      <div className="ccd-context-bar" data-ccd-context-bar="" ref={bar} aria-hidden="true">
        {segments.drawn.map(entry => (
          <span
            key={entry.key}
            className={`ccd-context-seg ccd-context-seg-${entry.key}`}
            data-ccd-context-seg={entry.key}
            style={{ flexGrow: entry.tokens }}
          />
        ))}
        <span className="ccd-context-track" data-ccd-context-track="" style={{ flexGrow: segments.free }} />
      </div>
      {expanded && breakdown !== null && (
        <div className="ccd-context-rows">
          {breakdown.slices.map(entry => (
            <div className="ccd-context-row" data-ccd-context-row={entry.key} key={entry.key}>
              <span className="ccd-context-label">
                <i className={`ccd-context-swatch ccd-context-swatch-${entry.key}`} aria-hidden="true" />
                {copy.rows[entry.key]}
              </span>
              <span className="ccd-context-tokens">{formatTokens(entry.tokens)}</span>
              <span className="ccd-context-percent">{formatPercent(entry.tokens, breakdown.window)}</span>
            </div>
          ))}
          {groups.map(group => {
            const groupOpen = expandedGroups.has(group.label);
            return (
              <section className="ccd-context-group" data-ccd-context-group="" key={group.label}>
                <button
                  type="button"
                  className="ccd-context-group-head"
                  data-ccd-context-focus=""
                  aria-expanded={groupOpen}
                  onClick={() => {
                    setExpandedGroups(current => {
                      const next = new Set(current);
                      if (next.has(group.label)) next.delete(group.label);
                      else next.add(group.label);
                      return next;
                    });
                  }}
                >
                  <span className="ccd-context-label">
                    <Chevron open={groupOpen} />
                    {group.label}
                  </span>
                  <span className="ccd-context-tokens">{formatTokens(group.tokens)}</span>
                  <span className="ccd-context-percent" title={`${group.rows.length} ${copy.count}`}>
                    {group.rows.length}
                  </span>
                </button>
                {groupOpen && (
                  <div className="ccd-context-detail">
                    {group.rows.map(([name, tokens]) => (
                      <div className="ccd-context-row ccd-context-detail-row" key={name}>
                        <span className="ccd-context-label" title={name}>
                          {shortenPath(name.startsWith('mcp__') ? toolLabel(name) : name)}
                        </span>
                        <span className="ccd-context-tokens">{formatTokens(tokens)}</span>
                        <span className="ccd-context-percent" />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
