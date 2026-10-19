import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, ReactElement } from 'react';
import { filterFamilies } from './fonts.ts';
import { MenuCheck } from './ChoiceMenu.tsx';

/**
 * The installed-family menu behind a typeface row's select box.
 *
 * It is drawn by the plugin rather than by a native `<datalist>`: the native
 * popup is an OS widget that ignores this page's styles and, in the desktop
 * window, does not scroll with the wheel — with several hundred families that
 * is unusable. The panel is positioned against the select box and closed by
 * Escape, an outside click, a scroll or a resize.
 */

export interface FontMenuLabels {
  readonly search: string;
  readonly empty: string;
  readonly count: (count: number) => string;
  readonly unavailable: string;
  /** Row offered for a family the list does not carry. */
  readonly useTyped: (name: string) => string;
}

export interface FontMenuProps {
  /** The select box this menu hangs from; the menu follows it while it scrolls. */
  readonly anchor: HTMLElement;
  /** Installed families; empty when the environment cannot provide them. */
  readonly families: readonly string[];
  /** The served family, marked in the list. */
  readonly value: string;
  readonly labels: FontMenuLabels;
  readonly onSelect: (family: string) => void;
  /** Commit a family the list does not carry, typed into the search field. */
  readonly onUseText: (text: string) => void;
  readonly onClose: () => void;
}

const HEIGHT = 320;
const MARGIN = 12;

/**
 * One open family menu.
 * @param props - The anchor rectangle, the families, the served value and callbacks.
 * @returns The searchable, scrollable panel.
 */
export function FontMenu(props: FontMenuProps): ReactElement {
  const { anchor, families, value, labels, onSelect, onUseText, onClose } = props;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect>(() => anchor.getBoundingClientRect());
  const listRef = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => filterFamilies(families, query), [families, query]);

  /* A family the list does not carry — hidden by the system, or typed from
     memory — is offered as the first row once something is typed. */
  const typed = query.trim();
  const typedOffered = typed !== '' && !shown.includes(typed);
  const rows = typedOffered ? shown.length + 1 : shown.length;

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    const node = listRef.current?.children[active];
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'nearest' });
  }, [active, shown.length]);

  /* The panel under the menu scrolls like any other; the menu follows its box
     instead of closing, because the scroll that brings the box into view lands
     after the click that opened it. */
  useEffect(() => {
    const sync = () => setRect(anchor.getBoundingClientRect());
    sync();
    window.addEventListener('scroll', sync, true);
    window.addEventListener('resize', sync);
    return () => {
      window.removeEventListener('scroll', sync, true);
      window.removeEventListener('resize', sync);
    };
  }, [anchor]);

  /* Escape and any interaction outside the menu and its box close it; the box
     itself is left to the toggle, which closes what it opened. */
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    const onPointer = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (target instanceof Element && target.closest('.ccd-settings-menu') !== null) return;
      if (anchor.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [anchor, onClose]);

  const move = (step: number) => {
    if (rows === 0) return;
    setActive(current => (current + step + rows) % rows);
  };
  const choose = (family: string) => {
    onSelect(family);
    onClose();
  };
  const useTyped = () => {
    onUseText(typed);
    onClose();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); return; }
    if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); return; }
    if (event.key === 'Enter') {
      if (typedOffered && active === 0) { event.preventDefault(); useTyped(); return; }
      const family = shown[active - (typedOffered ? 1 : 0)];
      if (family !== undefined) { event.preventDefault(); choose(family); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); onClose(); }
  };

  /* The menu hangs under the box and lines up with its leading edge, the way
     the reference select does. */
  const width = Math.min(Math.round(rect.width), window.innerWidth - MARGIN * 2);
  const below = rect.bottom + 6;
  const top = below + HEIGHT > window.innerHeight - MARGIN ? Math.max(MARGIN, rect.top - 6 - HEIGHT) : below;
  const left = Math.min(Math.max(MARGIN, rect.left), window.innerWidth - MARGIN - width);

  return (
    <div className="ccd-settings-menu" role="dialog" aria-label={labels.search} style={{ top, left, width }}>
      {families.length === 0 ? (
        <p className="ccd-settings-menu-empty">{labels.unavailable}</p>
      ) : null}
      <>
          <input
            className="ccd-settings-menu-search"
            type="search"
            autoFocus
            spellCheck={false}
            autoComplete="off"
            placeholder={labels.search}
            aria-label={labels.search}
            value={query}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <p className="ccd-settings-menu-count">{labels.count(shown.length)}</p>
          {shown.length === 0 && !typedOffered ? (
            <p className="ccd-settings-menu-empty">{labels.empty}</p>
          ) : (
            <ul className="ccd-settings-menu-list" ref={listRef} role="listbox" aria-label={labels.search}>
              {typedOffered ? (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="ccd-settings-menu-item"
                    data-active={active === 0}
                    onMouseEnter={() => setActive(0)}
                    onClick={useTyped}
                  >
                    <span className="ccd-settings-menu-name">{labels.useTyped(typed)}</span>
                  </button>
                </li>
              ) : null}
              {shown.map((family, index) => (
                <li key={family}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={family === value}
                    className="ccd-settings-menu-item"
                    data-active={index === active - (typedOffered ? 1 : 0)}
                    data-current={family === value}
                    onMouseEnter={() => setActive(index + (typedOffered ? 1 : 0))}
                    onClick={() => choose(family)}
                  >
                    <span className="ccd-settings-menu-name" style={{ fontFamily: `"${family}"` }}>{family}</span>
                    {family === value ? <MenuCheck /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
      </>
    </div>
  );
}
