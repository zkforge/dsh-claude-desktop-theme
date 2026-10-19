import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactElement } from 'react';

export function MenuCheck(): ReactElement {
  return (
    <svg className="ccd-settings-menu-check" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="m3 9 4 4 8-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A small choice list with native-style focus, dismissal and keyboard navigation. */
export function ChoiceMenu({ id, labelId, anchor, value, options, onSelect, onClose }: {
  readonly id: string;
  readonly labelId: string;
  readonly anchor: HTMLElement;
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onSelect: (value: string) => void;
  readonly onClose: () => void;
}): ReactElement {
  const menuRef = useRef<HTMLUListElement>(null);
  const [rect, setRect] = useState(() => anchor.getBoundingClientRect());
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    setHeight(menuRef.current?.getBoundingClientRect().height ?? 0);
  }, [options, rect]);
  useEffect(() => {
    const selected = menuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    (selected ?? menuRef.current?.querySelector('button'))?.focus();
  }, []);
  useEffect(() => {
    const sync = () => setRect(anchor.getBoundingClientRect());
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.contains(event.target) && !menuRef.current?.contains(event.target)) onClose();
    };
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [anchor, onClose]);
  const closeAndFocus = () => { onClose(); anchor.focus(); };
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); closeAndFocus(); return; }
    if (event.key === 'Tab') {
      // Resume normal tab order from the trigger.
      anchor.focus();
      onClose();
      return;
    }
    const buttons = Array.from(menuRef.current?.querySelectorAll('button') ?? []);
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'ArrowDown') next = (current + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[next]?.focus();
  };
  const width = Math.min(rect.width, window.innerWidth - 24);
  const top = rect.bottom + 6 + height > window.innerHeight - 12
    ? Math.max(12, rect.top - 6 - height) : rect.bottom + 6;
  return (
    <ul id={id} ref={menuRef} className="ccd-settings-menu ccd-settings-choice-menu" role="listbox"
      aria-labelledby={labelId} onKeyDown={onKeyDown}
      style={{ top, left: Math.max(12, Math.min(rect.left, window.innerWidth - 12 - width)), width }}>
      {options.map(option => (
        <li key={option.value} role="presentation">
          <button type="button" role="option" aria-selected={option.value === value}
            tabIndex={-1} className="ccd-settings-menu-item"
            onClick={() => { onSelect(option.value); closeAndFocus(); }}>
            <span className="ccd-settings-menu-name">{option.label}</span>
            {option.value === value ? <MenuCheck /> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
