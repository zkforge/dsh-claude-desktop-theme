import { useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent, ReactElement } from 'react';
import type { ThemePreference } from '../../contracts/ports.ts';
import { FontMenu } from './FontMenu.tsx';
import type { FontMenuLabels } from './FontMenu.tsx';
import { ChoiceMenu } from './ChoiceMenu.tsx';
import { normalizeColour } from '../../../shared/config.ts';
import { ColourMenu } from './ColourMenu.tsx';
import type { ColourMenuLabels } from './ColourMenu.tsx';

/**
 * Field rows for the configuration page.
 *
 * The page is the plugin's own settings surface, so it draws its own controls:
 * the host's shared switch and select belong to a package outside this plugin's
 * type baseline, and a copy of an official component is not allowed. The
 * controls below reproduce that surface's shapes and read the same design
 * tokens — capsule switch, bordered select box with a chevron, bordered text
 * field, segmented preference control — so the page sits in the host's panel
 * without looking foreign.
 */

/** The chevron a select box carries; drawn here rather than copied. */
function Chevron(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * One 16px glyph per theme preference, drawn here from primitives (a framed
 * panel, a rayed disc, a crescent) so no icon set is copied into the package.
 * @param props - which preference the glyph stands for.
 * @returns The glyph.
 */
function ThemeGlyph({ id }: { readonly id: ThemePreference }): ReactElement {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.1 } as const;
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {id === 'system' ? (
        <>
          <rect x="2.3" y="3.1" width="11.4" height="7.9" rx="1.5" {...stroke} />
          <path d="M8 11v1.4M6.3 12.9h3.4" {...stroke} strokeLinecap="round" />
        </>
      ) : null}
      {id === 'light' ? (
        <>
          <circle cx="8" cy="8" r="3.2" {...stroke} />
          <path
            d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1"
            {...stroke}
            strokeLinecap="round"
          />
        </>
      ) : null}
      {id === 'dark' ? (
        <path d="M13.9 8.5A6 6 0 1 1 7.5 2a4.7 4.7 0 0 0 6.4 6.5Z" {...stroke} strokeLinejoin="round" />
      ) : null}
    </svg>
  );
}

export interface SwitchRowProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}

/**
 * One boolean row: a labelled sliding switch, the shape the host's own settings
 * rows use.
 * @param props - Identity, copy, current value and the change callback.
 * @returns The row.
 */
export function SwitchRow({ id, label, hint, checked, onChange }: SwitchRowProps): ReactElement {
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  return (
    <div className="ccd-settings-row" data-ccd-row="switch">
      <span className="ccd-settings-label">
        <span className="ccd-settings-name" id={labelId}>{label}</span>
        {hint === undefined ? null : <span className="ccd-settings-hint" id={hintId}>{hint}</span>}
      </span>
      <span className="ccd-settings-control">
        <button
          type="button"
          id={id}
          className="ccd-settings-switch"
          role="switch"
          aria-checked={checked}
          aria-labelledby={labelId}
          {...(hint === undefined ? {} : { 'aria-describedby': hintId })}
          onClick={() => onChange(!checked)}
        >
          <span className="ccd-settings-thumb" aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

export interface ThemeOption {
  readonly id: ThemePreference;
  readonly label: string;
}

export interface ThemeRowProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  /** The persisted preference, straight from the theme service snapshot. */
  readonly value: ThemePreference;
  readonly options: readonly ThemeOption[];
  readonly onChange: (preference: ThemePreference) => void;
}

/**
 * One theme row: a recessed track with one glyph per preference and the chosen
 * segment raised, the shape the reference screenshot uses. The value is the
 * service's own preference, never a local copy, so the control cannot disagree
 * with the host's Appearance row.
 * @param props - Identity, copy, current preference and the change callback.
 * @returns The row.
 */
export function ThemeRow(props: ThemeRowProps): ReactElement {
  const { id, label, hint, value, options, onChange } = props;
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;
  const group = useRef<HTMLSpanElement | null>(null);

  /** Radio-group keyboard model: arrows move focus and selection together. */
  const move = (step: number): void => {
    const current = options.findIndex(option => option.id === value);
    const next = options[(current + step + options.length) % options.length];
    if (next === undefined) return;
    onChange(next.id);
    group.current?.querySelectorAll('button')[options.indexOf(next)]?.focus();
  };

  return (
    <div className="ccd-settings-row" data-ccd-row="theme">
      <span className="ccd-settings-label">
        <span className="ccd-settings-name" id={labelId}>{label}</span>
        {hint === undefined ? null : <span className="ccd-settings-hint" id={hintId}>{hint}</span>}
      </span>
      <span className="ccd-settings-control">
        <span
          ref={group}
          className="ccd-settings-segmented"
          role="radiogroup"
          aria-labelledby={labelId}
          {...(hint === undefined ? {} : { 'aria-describedby': hintId })}
          onKeyDown={(event: KeyboardEvent<HTMLSpanElement>) => {
            const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1
              : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
            if (step === 0) return;
            event.preventDefault();
            move(step);
          }}
        >
          {options.map(option => (
            <button
              key={option.id}
              type="button"
              id={`${id}-${option.id}`}
              className="ccd-settings-segment"
              role="radio"
              aria-checked={option.id === value}
              aria-label={option.label}
              title={option.label}
              tabIndex={option.id === value ? 0 : -1}
              onClick={() => onChange(option.id)}
            >
              <ThemeGlyph id={option.id} />
            </button>
          ))}
        </span>
      </span>
    </div>
  );
}

export interface ColourRowProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly placeholder: string;
  readonly pickerLabels: ColourMenuLabels;
  readonly error?: string;
  readonly onChange: (value: string) => void;
  readonly onCommit: () => void;
  readonly onSelect: (value: string) => void;
}

/**
 * One background-colour row: a preview swatch, editable hex and gradient picker.
 * @param props - Identity, copy, current text and callbacks.
 * @returns The row.
 */
export function ColourRow(props: ColourRowProps): ReactElement {
  const { id, label, hint, value, placeholder, pickerLabels, error, onChange, onCommit, onSelect } = props;
  const labelId = `${id}-label`;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const preview = normalizeColour(value) || placeholder;
  const menuId = `${id}-picker`;
  return (
    <div className="ccd-settings-row" data-ccd-row="colour">
      <span className="ccd-settings-label">
        <span className="ccd-settings-name" id={labelId}>{label}</span>
        {hint === undefined ? null : <span className="ccd-settings-hint">{hint}</span>}
      </span>
      <span className="ccd-settings-control">
        <span className="ccd-settings-colour" data-invalid={error !== undefined}>
          <button type="button" className="ccd-settings-colour-swatch" aria-labelledby={labelId}
            aria-haspopup="dialog" aria-expanded={anchor !== null} aria-controls={anchor ? menuId : undefined}
            onClick={event => setAnchor(anchor ? null : event.currentTarget.parentElement)}>
            <span aria-hidden="true" style={{ background: preview }} />
          </button>
          <input
            id={id}
            className="ccd-settings-colour-text"
            type="text"
            spellCheck={false}
            autoComplete="off"
            value={value.toUpperCase()}
            placeholder={placeholder.toUpperCase()}
            aria-labelledby={labelId}
            aria-invalid={error !== undefined}
            onFocus={() => setAnchor(null)}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value.toUpperCase())}
            onBlur={onCommit}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === 'Enter') { event.preventDefault(); onCommit(); }
            }}
          />
        </span>
      </span>
      {error === undefined ? null : <p className="ccd-settings-error" role="alert">{error}</p>}
      {anchor === null ? null : (
        <ColourMenu id={menuId} labelId={labelId} anchor={anchor} value={preview} labels={pickerLabels}
          onPreview={onChange} onSelect={onSelect} onClose={() => setAnchor(null)} />
      )}
    </div>
  );
}

export interface FontRowProps {
  readonly id: string;
  readonly label: string;
  readonly hint?: string;
  readonly value: string;
  readonly placeholder: string;
  readonly resetLabel: string;
  readonly error?: string;
  /** Whether the served value differs from the default; the Theme panel shows Reset only then. */
  readonly customized?: boolean;
  /** The open family menu's anchor box, or undefined while it is closed. */
  readonly anchor: HTMLElement | undefined;
  readonly families: readonly string[];
  readonly menuLabels: FontMenuLabels;
  readonly onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  readonly onSelect: (family: string) => void;
  readonly onUseText: (text: string) => void;
  readonly onCloseMenu: () => void;
  readonly onReset: () => void;
}

/**
 * One typeface row: a select box that shows the served family and opens the
 * installed-family menu; a family the list does not carry can be typed into
 * that menu's search field.
 * @param props - Identity, copy, current value, menu state and callbacks.
 * @returns The row and, when open, its menu.
 */
export function FontRow(props: FontRowProps): ReactElement {
  const {
    id, label, hint, value, placeholder, resetLabel, error, customized, anchor, families, menuLabels,
    onToggle, onSelect, onUseText, onCloseMenu, onReset,
  } = props;
  const labelId = `${id}-label`;
  return (
    <div className="ccd-settings-row" data-ccd-row="font" data-ccd-customized={customized}>
      <span className="ccd-settings-label">
        <span className="ccd-settings-name" id={labelId}>{label}</span>
        {hint === undefined ? null : <span className="ccd-settings-hint">{hint}</span>}
      </span>
      <span className="ccd-settings-control">
        <button
          type="button"
          id={id}
          className="ccd-settings-select"
          data-empty={value === ''}
          aria-labelledby={labelId}
          aria-haspopup="listbox"
          aria-expanded={anchor !== undefined}
          onClick={onToggle}
        >
          <span className="ccd-settings-select-value">{value === '' ? placeholder : value}</span>
          <Chevron />
        </button>
        <button
          type="button"
          className="ccd-settings-button-quiet"
          onClick={() => {
            onReset();
            /* The Theme panel hides Reset once the value is the default again, so
               focus moves to the row's own control instead of falling to the body. */
            document.getElementById(id)?.focus();
          }}
        >
          {resetLabel}
        </button>
      </span>
      {error === undefined ? null : <p className="ccd-settings-error" role="alert">{error}</p>}
      {anchor === undefined ? null : (
        <FontMenu
          anchor={anchor}
          families={families}
          value={value}
          labels={menuLabels}
          onSelect={onSelect}
          onUseText={onUseText}
          onClose={onCloseMenu}
        />
      )}
    </div>
  );
}

/** Styled choice control for named visual variants. */
export function ChoiceRow({ id, label, value, options, onChange }: {
  readonly id: string; readonly label: string; readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
}): ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const labelId = `${id}-label`;
  const menuId = `${id}-menu`;
  return (
    <div className="ccd-settings-row">
      <span className="ccd-settings-name" id={labelId}>{label}</span>
      <span className="ccd-settings-control">
        <button type="button" id={id} className="ccd-settings-select" aria-labelledby={labelId}
          aria-haspopup="listbox" aria-expanded={anchor !== null} aria-controls={anchor ? menuId : undefined}
          onClick={event => setAnchor(anchor ? null : event.currentTarget)}
          onKeyDown={event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault(); setAnchor(event.currentTarget);
            }
          }}>
          <span className="ccd-settings-select-value">{options.find(option => option.value === value)?.label ?? value}</span>
          <Chevron />
        </button>
      </span>
      {anchor === null ? null : (
        <ChoiceMenu id={menuId} labelId={labelId} anchor={anchor} value={value} options={options}
          onSelect={onChange} onClose={() => setAnchor(null)} />
      )}
    </div>
  );
}

export function NameRow({ id, label, value, onChange, onCommit }: {
  readonly id: string; readonly label: string; readonly value: string;
  readonly onChange: (value: string) => void; readonly onCommit: () => void;
}): ReactElement {
  return (
    <div className="ccd-settings-row">
      <label className="ccd-settings-name" htmlFor={id}>{label}</label>
      <span className="ccd-settings-control">
        <input id={id} className="ccd-settings-text" type="text" maxLength={64} value={value}
          autoComplete="off" onChange={event => onChange(event.target.value)} onBlur={onCommit}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); onCommit(); }
          }} />
      </span>
    </div>
  );
}
