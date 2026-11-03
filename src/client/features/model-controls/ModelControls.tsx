import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types';
import { effortDefaultIndex, effortView, modelSelection } from './selection.ts';
import type { EffortView } from './selection.ts';
import { EffortPanel } from './EffortPanel.tsx';
import { ModelIcon } from './model-icons.tsx';
import { usePopup } from './popup.ts';
import { EFFORT_COPY, MODEL_COPY, effortLabel, useEffortLanguage } from './locales.ts';
import { FAVORITE_LIMIT, modelKey, saveFavorites, splitModels, useFavorites } from './favorites.ts';
import type { ModelEntry } from './favorites.ts';

export type ModelControlsProps = Omit<ModelSelectInjected, 'directory'> & PropsLocale<'model'> & {
  readonly showModelIcons: boolean;
  readonly locked: boolean;
  readonly useDirectory: () => ModelDirectoryState;
  readonly selectEffort: (route: ModelSelection, effort: string | undefined) => void;
};

const CHEVRON = <svg className="ccd-model-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6 3.5 4.5 4.5-4.5 4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const PIN = <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5.5 2.5h5l-.6 4.2L12 9H4l2.1-2.3-.6-4.2ZM8 9v4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** The strongest advertised tier wears the slider's violet on every surface that names it. */
const atPeak = ({ choices, preview }: EffortView) => choices.length > 1 && preview === choices.length - 1;

/** SDK-derived values/hooks and callbacks only; DSH retains all business state. */
export function ModelControls({ showModelIcons, locked, available, useDirectory, load, select, selectEffort, t }: ModelControlsProps) {
  const language = useEffortLanguage();
  const state = useDirectory();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [open, setOpen] = useState(false);
  const modelAnchor = useRef<HTMLButtonElement>(null);
  const busy = state.pending !== null || state.status === 'selecting';
  /* A selection settles in moments: the menu stays as it is meanwhile, and only
     a second pick waits, rather than the whole control greying for one frame. */
  const disabled = locked || !available;
  const current = state.current;
  const model = state.groups.find(group => group.id === current?.provider)?.models.find(model => model.id === current?.model);
  const view = useMemo(() => effortView(model, current, {
    /* The host wording is read only where the catalog advertises no tier to
       name: the row then falls back to it and opens nothing. */
    defaultName: t('effort.providerDefault'),
    retainedEffort: state.retainedEffort,
  }), [model, current, t, state.retainedEffort]);
  const { caption } = view;
  const label = model?.name ?? current?.model ?? t('trigger.fallback');
  const effort = caption === undefined ? undefined : effortLabel(caption, language);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => { if (available && state.status === 'idle') load(); }, [available, state.status, load]);
  useEffect(() => { close(); }, [current?.provider, current?.model, locked, available, close]);
  if (!available) return null;
  return <div className="ccd-model-controls" data-ccd-model-controls>
    <button ref={modelAnchor} className="ccd-model-trigger" data-ccd-model-trigger type="button" disabled={disabled}
      aria-label={[current ? t('trigger.aria', { model: label }) : t('trigger.selectAria'), ...(effort === undefined ? [] : [`${EFFORT_COPY[language].title}: ${effort}`])].join(', ')}
      aria-haspopup="dialog" aria-expanded={open} onClick={() => { setOpen(!open); load(); }}>
      <span className="ccd-model-label">{label}</span>
      {effort !== undefined && <span className="ccd-model-effort" data-peak={atPeak(view) ? '' : undefined}>{effort}</span>}
    </button>
    {open && <ModelMenu showModelIcons={showModelIcons} anchor={modelAnchor} state={state} view={view} disabled={disabled} busy={busy} load={load} t={t} onClose={close}
      onSelectEffort={index => { const choice = view.choices[index]; if (current && choice && choice.id !== view.effort) selectEffort(current, choice.id); }}
      onSelect={selection => { if (busy) return; void select(selection).then(result => { if (!alive.current) return; if (result?.ok) { modelAnchor.current?.focus(); close(); } }).catch(() => {}); }} />}
    {!open && state.error && <div className="ccd-model-error" role="alert">{state.error}<button type="button" className="ccd-model-retry" onClick={load}>{t('action.reload')}</button></div>}
  </div>;
}

/** Pin state a row needs; omitted, the row offers no pin at all. */
interface RowPin { readonly pinned: boolean; readonly full: boolean; readonly toggle: () => void; }

function ModelRow({ entry: { group, model }, state, disabled, showModelIcons, pin, hint, onSelect, onPointerEnter }: {
  readonly entry: ModelEntry;
  readonly state: ModelDirectoryState;
  readonly disabled: boolean;
  readonly showModelIcons: boolean;
  readonly pin?: RowPin | undefined;
  readonly hint?: number | undefined;
  readonly onSelect: (selection: ModelSelection) => void;
  readonly onPointerEnter?: (() => void) | undefined;
}) {
  const copy = MODEL_COPY[useEffortLanguage()];
  const chosen = state.current?.provider === group.id && state.current.model === model.id;
  const pinLabel = pin === undefined ? '' : pin.pinned ? copy.unpin : pin.full ? copy.full : copy.pin;
  return <div className="ccd-model-row" onPointerEnter={onPointerEnter}>
    <button type="button" data-model-option aria-pressed={chosen} disabled={disabled} title={group.name}
      onClick={() => onSelect(modelSelection(group.id, model, state.current))}>{showModelIcons && <ModelIcon provider={group} model={model} />}<span className="ccd-model-name"><span className="ccd-model-name-text">{model.name}</span></span>{chosen || hint === undefined ? <span aria-hidden="true">{chosen ? '✓' : ''}</span> : <span className="ccd-model-hint">{hint}</span>}</button>
    {pin && <button type="button" className="ccd-model-pin" data-pinned={pin.pinned ? '' : undefined} disabled={!pin.pinned && pin.full} aria-label={`${pinLabel}: ${model.name}`} aria-pressed={pin.pinned} title={pinLabel} onClick={pin.toggle}>{PIN}</button>}
  </div>;
}

/** Walk the card's rows; the pins stay on Tab so arrows only ever land on a choice. */
function walkRows(event: KeyboardEvent<HTMLElement>) {
  const targets = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-model-option]:not(:disabled), [data-model-submenu]:not(:disabled)'));
  const index = targets.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'ArrowDown' ? (index + 1) % targets.length : event.key === 'ArrowUp' ? (Math.max(index, 0) - 1 + targets.length) % targets.length : event.key === 'Home' ? 0 : event.key === 'End' ? targets.length - 1 : undefined;
  if (next === undefined) return;
  event.preventDefault(); targets[next]?.focus();
}

type Flyout = { readonly kind: 'effort' | 'more'; readonly focus: boolean } | null;

/** The Composer's one card: up to four models, Effort, and the rest of the catalog beside it. */
function ModelMenu({ showModelIcons, anchor, state, view, disabled, busy, load, t, onClose, onSelect, onSelectEffort }: PropsLocale<'model'> & {
  readonly showModelIcons: boolean;
  readonly anchor: React.RefObject<HTMLButtonElement>;
  readonly state: ModelDirectoryState;
  readonly view: EffortView;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly load: () => void;
  readonly onClose: () => void;
  readonly onSelect: (selection: ModelSelection) => void;
  readonly onSelectEffort: (index: number) => void;
}) {
  const language = useEffortLanguage();
  const copy = MODEL_COPY[language];
  const { panel, position } = usePopup(anchor, onClose);
  const saved = useFavorites();
  const { primary, rest } = splitModels(state.groups, saved);
  const keys = primary.map(({ group, model }) => modelKey(group.id, model.id));
  const pinFor = ({ group, model }: ModelEntry): RowPin => {
    const key = modelKey(group.id, model.id), pinned = keys.includes(key);
    return { pinned, full: keys.length >= FAVORITE_LIMIT, toggle: () => saveFavorites(pinned ? keys.filter(item => item !== key) : [...keys, key]) };
  };
  const [flyout, setFlyout] = useState<Flyout>(null);
  const effortRow = useRef<HTMLButtonElement>(null), moreRow = useRef<HTMLButtonElement>(null);
  const closeFlyout = useCallback(() => setFlyout(null), []);
  /* Focus left behind in a closing flyout returns to the card, or Escape and
     the digits would have nowhere to land. */
  const hover = (kind: 'effort' | 'more' | null) => {
    if ((flyout?.kind ?? null) === kind) return;
    if (!panel.current?.contains(document.activeElement)) panel.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    setFlyout(kind && { kind, focus: false });
  };
  const submenu = (kind: 'effort' | 'more') => ({
    'data-model-submenu': kind, 'aria-haspopup': 'dialog', 'aria-expanded': flyout?.kind === kind,
    onPointerEnter: () => hover(kind),
    onClick: () => setFlyout(flyout?.kind === kind ? null : { kind, focus: true }),
    onKeyDown: (event: KeyboardEvent) => { if (event.key === 'ArrowRight') { event.preventDefault(); setFlyout({ kind, focus: true }); } },
  } as const);
  const pickable = view.choices.length > 1;
  const peak = atPeak(view);
  const currentInRest = rest.find(({ group, model }) => state.current?.provider === group.id && state.current.model === model.id);
  const notes: ReactNode = <>
    {state.status === 'loading' && primary.length === 0 && <p role="status" className="ccd-model-note">{t('status.loading')}</p>}
    {state.error && <div role="alert" className="ccd-model-note">{state.error}<button type="button" className="ccd-model-retry" onClick={load}>{t('action.reload')}</button></div>}
    {state.failures.map(failure => <div key={failure.id} role="status" className="ccd-model-note">{failure.name}: {failure.message}<button type="button" className="ccd-model-retry" onClick={load}>{t('action.reload')}</button></div>)}
    {primary.length === 0 && state.status !== 'loading' && <p className="ccd-model-note">{t('empty.models')}</p>}
  </>;
  return <>
    <div ref={panel} className="ccd-model-panel ccd-model-menu" role="dialog" aria-label={t('menu.model')} style={position} data-ccd-model-surface>
      <div className="ccd-model-heading">{t('menu.model')} · {copy.session}</div>
      {notes}
      <div data-autofocus tabIndex={-1} className="ccd-model-options" onKeyDown={event => {
        walkRows(event);
        const entry = primary[Number(event.key) - 1];
        if (!entry || disabled || event.metaKey || event.ctrlKey || event.altKey) return;
        event.preventDefault(); onSelect(modelSelection(entry.group.id, entry.model, state.current));
      }}>
        {primary.map((entry, index) => <ModelRow key={keys[index]} entry={entry} state={state} disabled={disabled} showModelIcons={showModelIcons} pin={pinFor(entry)} hint={index + 1} onSelect={onSelect} onPointerEnter={() => hover(null)} />)}
        {view.caption !== undefined && <>
          <div className="ccd-model-divider" role="separator" />
          <button ref={effortRow} type="button" className="ccd-model-submenu" disabled={!pickable} title={EFFORT_COPY[language].help} {...submenu('effort')}>
            <span className="ccd-model-name"><span className="ccd-model-name-text">{EFFORT_COPY[language].title}</span></span>
            <span className="ccd-model-value" data-peak={peak ? '' : undefined}>{effortLabel(view.caption, language)}</span>{CHEVRON}
          </button>
        </>}
        {rest.length > 0 && <>
          <div className="ccd-model-divider" role="separator" />
          <button ref={moreRow} type="button" className="ccd-model-submenu" {...submenu('more')}>
            <span className="ccd-model-name"><span className="ccd-model-name-text">{copy.more}</span></span>
            {currentInRest && <span className="ccd-model-value ccd-model-name-text">{currentInRest.model.name}</span>}{CHEVRON}
          </button>
        </>}
      </div>
    </div>
    {flyout?.kind === 'effort' && state.current && pickable && <EffortPanel key={`${state.current.provider}/${state.current.model}`} anchor={effortRow} choices={view.choices} selected={view.preview} defaultIndex={effortDefaultIndex(state.groups.find(group => group.id === state.current?.provider)?.models.find(model => model.id === state.current?.model))} disabled={disabled} busy={busy} error={state.error}
      autofocus={flyout.focus} onClose={closeFlyout} onCommit={onSelectEffort} />}
    {flyout?.kind === 'more' && <ModelPanel showModelIcons={showModelIcons} anchor={moreRow} state={state} entries={rest} pinFor={pinFor} disabled={disabled} beside autofocus={flyout.focus} t={t} onClose={closeFlyout} onSelect={onSelect} />}
  </>;
}

export function ModelPanel({ showModelIcons, anchor, state, entries, pinFor, disabled, beside = false, autofocus = true, t, onClose, onSelect }: PropsLocale<'model'> & {
  readonly showModelIcons: boolean;
  readonly anchor: React.RefObject<HTMLButtonElement>;
  readonly state: ModelDirectoryState;
  /** The models this card lists; the whole directory when omitted. */
  readonly entries?: readonly ModelEntry[];
  readonly pinFor?: (entry: ModelEntry) => RowPin;
  readonly disabled: boolean;
  readonly beside?: boolean;
  readonly autofocus?: boolean;
  readonly onClose: () => void;
  readonly onSelect: (selection: ModelSelection) => void;
}) {
  const { panel, position } = usePopup(anchor, onClose, { beside, autofocus });
  const [query, setQuery] = useState('');
  const listed = entries ?? state.groups.flatMap(group => group.models.map(model => ({ group, model })));
  const matches = listed.filter(({ group, model }) => `${model.name} ${model.id} ${group.name}`.toLowerCase().includes(query.toLowerCase()));
  const groups = state.groups.map(group => ({ group, entries: matches.filter(entry => entry.group.id === group.id) })).filter(item => item.entries.length > 0);
  return <div ref={panel} className="ccd-model-panel" role="dialog" aria-label={t('menu.model')} style={position} data-ccd-model-surface>
    <input data-autofocus className="ccd-model-search" aria-label={t('search.placeholder')} placeholder={t('search.placeholder')} value={query} onChange={e => setQuery(e.currentTarget.value)}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); panel.current?.querySelector<HTMLButtonElement>('[data-model-option]')?.focus(); } }} />
    {groups.length === 0 && <p className="ccd-model-note">{query ? t('search.empty') : t('empty.models')}</p>}
    <div className="ccd-model-options" onKeyDown={walkRows}>
      {groups.map(({ group, entries }) => <div key={group.id}><div className="ccd-model-provider">{group.name}</div>{entries.map(entry =>
        <ModelRow key={entry.model.id} entry={entry} state={state} disabled={disabled} showModelIcons={showModelIcons} pin={pinFor?.(entry)} onSelect={onSelect} />)}</div>)}
    </div>
  </div>;
}
