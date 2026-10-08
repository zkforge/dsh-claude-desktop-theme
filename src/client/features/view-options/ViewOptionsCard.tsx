import { Fragment, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import type { ViewOptionsGroup, ViewOptionsGroupRead, ViewOptionsPort } from '../../contracts/ports.ts';

/** The card's own copy, in the one language the document is in. */
interface Copy {
  readonly viewOptions: string;
  readonly status: string;
  readonly showEmptyGroups: string;
  readonly clearFilters: string;
  /** The 筛选会话 values in the host's row order (`hide-archived`,
      `show-archived`, `only-archived`); `FILTER_ORDER` is how they are drawn. */
  readonly filters: readonly string[];
}

/** Where the plugin's own copy lives; the host's words are read off its card. */
const COPY: { readonly zh: Copy; readonly en: Copy } = {
  zh: {
    viewOptions: '视图选项',
    status: '状态',
    showEmptyGroups: '显示空分组',
    clearFilters: '清除筛选',
    filters: ['活跃', '全部', '已归档'],
  },
  en: {
    viewOptions: 'View options',
    status: 'Status',
    showEmptyGroups: 'Show empty groups',
    clearFilters: 'Clear filters',
    filters: ['Active', 'All', 'Archived'],
  },
};

/** The host's row order for 筛选会话 is 活跃 / 全部 / 已归档; the card draws 活跃 / 已归档 / 全部. */
const FILTER_ORDER = [0, 2, 1] as const;

/** The one group whose options this plugin renames rather than borrows. */
const FILTER_GROUP = 2;
/** Match the reference's sections: status first, then grouping and ordering. */
const ROW_ORDER = [2, 0, 1] as const;

/** How far the submenu sits from its row, and how wide the hit bridge is. */
const SUBMENU_GAP = 1;

/** One option as the card draws it: the host's own row, and the words to use. */
interface Option {
  /** Index of the row inside its group, in the host's order. */
  readonly host: number;
  readonly label: string;
}

function copyFor(document: Document): Copy {
  const language = (document.documentElement.lang || globalThis.navigator?.language || '').toLowerCase();
  return language.startsWith('zh') ? COPY.zh : COPY.en;
}

/** The options of one value row, in the order the card draws them. */
function optionsOf(group: ViewOptionsGroupRead, index: number, copy: Copy): readonly Option[] {
  const order: readonly number[] = index === FILTER_GROUP
    ? FILTER_ORDER
    : group.labels.map((_, host) => host);
  return order.map(host => ({
    host,
    label: index === FILTER_GROUP ? copy.filters[host]! : group.labels[host]!,
  }));
}

/** The label one value row shows for its current option. */
function valueOf(group: ViewOptionsGroupRead, index: number, copy: Copy): string {
  if (index === FILTER_GROUP) return copy.filters[group.selected] ?? '';
  return group.labels[group.selected] ?? '';
}

/** One row's trailing disclosure mark, drawn at the family's 16px. */
function Chevron(): ReactElement {
  return (
    <svg className="ccd-view-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.25 3.5L10.75 8L6.25 12.5" />
    </svg>
  );
}

/** The selected mark: the same accent check the host's own rows draw. */
function Check(): ReactElement {
  return (
    <svg className="ccd-view-check" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5L6.4 11.9L13 4.6" />
    </svg>
  );
}

export interface ViewOptionsCardProps {
  readonly port: ViewOptionsPort;
  /** `view.showEmptyGroups`: whether empty Workspaces are kept on screen. */
  readonly showEmptyGroups: boolean;
  /** Write the switch back through the settings transport. */
  readonly setShowEmptyGroups: (value: boolean) => void;
}

/**
 * The sidebar's view-options card, drawn in this plugin's own words and geometry.
 *
 * DSH's own menu is a flat list of eight options under three grey headings. The
 * reference draws the same settings as *value rows* — the dimension on the left,
 * the current choice on the right, a disclosure mark at the end — with the
 * options one level down in a card of their own, and the switch and the action
 * that belong to the family at the bottom. So this card is that shape, and the
 * host's menu is only ever read (`port.read`) and clicked (`port.choose`): the
 * three values are the host's, its rows are what writes them, and the words of
 * two of the three rows are the host's own — the card borrows the labels it read
 * out of the host's card and renames only the archived-visibility triple, which
 * is the one set the reference names differently (活跃 / 已归档 / 全部).
 *
 * Only `显示空分组` is this plugin's own state: it writes
 * `view.showEmptyGroups` through the settings transport, and a write re-mounts
 * the plugin, so the card closes behind it. `清除筛选` puts the filter rows back
 * to their defaults and exists only while one of them is off its default, which
 * is what the reference does with `Clear filters`.
 */
export function ViewOptionsCard({
  port, showEmptyGroups, setShowEmptyGroups,
}: ViewOptionsCardProps): ReactElement | null {
  const state = useSyncExternalStore(port.subscribe, port.getSnapshot);
  const panel = useRef<HTMLDivElement>(null);
  const submenu = useRef<HTMLDivElement>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const copy = copyFor(document);
  const { open, anchor, values } = state;
  const on = optimistic ?? showEmptyGroups;

  /* The card is a manual popover: the top layer is what puts it over the
     sidebar's own stacking context without moving anyone's DOM, and it is the
     same device the plugin's model card uses. It hangs from the trigger's
     bottom-right corner and is clamped into the viewport. */
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
      const top = Math.max(12, Math.min(a.bottom + 4, window.innerHeight - p.height - 12));
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
    const autofocus = requestAnimationFrame(() => {
      surface.querySelector<HTMLElement>(`[data-ccd-view-row="${ROW_ORDER[0]}"]`)?.focus();
    });
    return () => {
      cancelAnimationFrame(autofocus);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', place);
      if (surface.matches(':popover-open')) surface.hidePopover();
    };
  }, [open, anchor, values]);

  /* Dismissal, in the family's own terms: a pointer outside, focus leaving, or
     Escape. The trigger is exempt because a second click on it closes the card
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
      if (openRow !== null) {
        setOpenRow(null);
        panel.current?.querySelector<HTMLElement>(`[data-ccd-view-row="${openRow}"]`)?.focus();
        return;
      }
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
  }, [open, openRow, anchor, port]);

  /* The reference's submenu almost touches the main card and aligns its top
     with the active row. Clamp in viewport coordinates before converting to
     the card's local coordinates, and flip when the right side has no room. */
  useLayoutEffect(() => {
    const surface = submenu.current;
    const card = panel.current;
    if (openRow === null || surface === null || card === null) return;
    const row = card.querySelector<HTMLElement>(`[data-ccd-view-row="${openRow}"]`);
    if (row === null) return;
    const rowRect = row.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const size = surface.getBoundingClientRect();
    const flip = cardRect.right + SUBMENU_GAP + size.width > window.innerWidth - 12;
    const top = Math.max(12, Math.min(rowRect.top, window.innerHeight - size.height - 12)) - cardRect.top;
    surface.style.top = `${top}px`;
    surface.style.left = flip ? 'auto' : `calc(100% + ${SUBMENU_GAP}px)`;
    surface.style.right = flip ? `calc(100% + ${SUBMENU_GAP}px)` : 'auto';
    surface.setAttribute('data-ccd-flip', flip ? 'true' : 'false');
  }, [openRow, values]);

  if (!open || values === null) return null;

  const groups = values.groups;
  const filtersOff = groups[FILTER_GROUP]?.selected !== 0 || showEmptyGroups;

  /** Choose one option: the host writes the value, then the card steps aside. */
  const choose = (group: ViewOptionsGroup, host: number) => {
    setOpenRow(null);
    void port.choose(group, host).then(applied => { if (applied) port.close(); });
  };

  /** The card's rows in DOM order — what the keyboard walks, flyout included. */
  const rows = (): HTMLElement[] => {
    const card = panel.current;
    if (card === null) return [];
    const own = card.querySelectorAll<HTMLElement>(
      '[data-ccd-view-row], [data-ccd-view-switch], [data-ccd-view-action]',
    );
    const flyout = submenu.current?.querySelectorAll<HTMLElement>('[data-ccd-view-option]');
    return [...own, ...(flyout ?? [])];
  };

  const move = (event: ReactKeyboardEvent, step: number) => {
    const list = rows();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLElement);
    const next = index === -1 ? 0 : (index + step + list.length) % list.length;
    event.preventDefault();
    list[next]?.focus();
  };

  const onCardKey = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown') move(event, 1);
    else if (event.key === 'ArrowUp') move(event, -1);
    else if (event.key === 'Tab') {
      /* The card keeps its own focus: a popover with a flyout has no natural
         next stop inside the page, and the family's own card traps the walk. */
      const list = rows();
      if (list.length === 0) return;
      event.preventDefault();
      move(event, event.shiftKey ? -1 : 1);
    }
  };

  const openFlyout = (index: number) => {
    setOpenRow(index);
    requestAnimationFrame(() => {
      submenu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    });
  };

  const closeFlyout = (index: number) => {
    setOpenRow(null);
    panel.current?.querySelector<HTMLElement>(`[data-ccd-view-row="${index}"]`)?.focus();
  };

  return (
    <div
      className="ccd-view-options"
      data-menu-material=""
      data-ccd-view-options=""
      role="menu"
      aria-label={anchor?.getAttribute('aria-label') ?? copy.viewOptions}
      ref={panel}
      onKeyDown={onCardKey}
      onPointerLeave={() => { setOpenRow(null); }}
    >
      {ROW_ORDER.map((index, position) => {
        const group = groups[index];
        if (group === undefined) return null;
        const options = optionsOf(group, index, copy);
        return (
          <Fragment key={index}>
            {position === 1 && <div className="ccd-view-separator" role="separator" />}
            <div className="ccd-view-row-wrap" role="presentation">
              <button
                type="button"
                role="menuitem"
                className="ccd-view-row"
                data-ccd-view-row={index}
                aria-haspopup="menu"
                aria-expanded={openRow === index}
                onPointerEnter={() => { setOpenRow(index); }}
                onClick={() => { setOpenRow(index); }}
                onKeyDown={event => {
                  if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    openFlyout(index);
                    return;
                  }
                  if (event.key === 'ArrowLeft' && openRow === index) {
                    event.preventDefault();
                    setOpenRow(null);
                    return;
                  }
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openFlyout(index);
                    return;
                  }
                  // ArrowUp/Down and Tab bubble to the card's single handler.
                }}
              >
                <span className="ccd-view-row-label">{index === FILTER_GROUP ? copy.status : group.label}</span>
                <span className="ccd-view-row-value">{valueOf(group, index, copy)}</span>
                <Chevron />
              </button>
              {openRow === index && (
                <div
                  className="ccd-view-submenu"
                  data-menu-material=""
                  data-ccd-flip="false"
                  role="menu"
                  aria-label={index === FILTER_GROUP ? copy.status : group.label}
                  ref={submenu}
                  onPointerLeave={() => { setOpenRow(null); }}
                >
                  {options.map(option => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={option.host === group.selected}
                      className="ccd-view-row ccd-view-option"
                      data-ccd-view-option={`${index}-${option.host}`}
                      key={option.host}
                      onClick={() => { choose(index as ViewOptionsGroup, option.host); }}
                      onKeyDown={event => {
                        if (event.key === 'ArrowLeft') {
                          event.preventDefault();
                          closeFlyout(index);
                          return;
                        }
                        // Navigation bubbles to the card's single handler.
                      }}
                    >
                      <span className="ccd-view-row-label">{option.label}</span>
                      {option.host === group.selected && <Check />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Fragment>
        );
      })}
      <div className="ccd-view-separator" role="separator" />
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={on}
        className="ccd-view-row"
        data-ccd-view-switch=""
        onPointerEnter={() => { setOpenRow(null); }}
        onFocus={() => { setOpenRow(null); }}
        onClick={() => {
          const next = !on;
          setOptimistic(next);
          setShowEmptyGroups(next);
        }}
      >
        <span className="ccd-view-row-label">{copy.showEmptyGroups}</span>
        {on && <Check />}
      </button>
      {filtersOff && (
        <>
          <div className="ccd-view-separator" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="ccd-view-row"
            data-ccd-view-action=""
            onPointerEnter={() => { setOpenRow(null); }}
            onFocus={() => { setOpenRow(null); }}
            onClick={() => {
              void (async () => {
                if (groups[FILTER_GROUP]?.selected !== 0) await port.choose(FILTER_GROUP, 0);
                if (showEmptyGroups) setShowEmptyGroups(false);
                port.close();
              })();
            }}
          >
            <span className="ccd-view-row-label">{copy.clearFilters}</span>
          </button>
        </>
      )}
    </div>
  );
}
