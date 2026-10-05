import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ModelSelectInjected } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { ModelDirectoryState } from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types';
import { effortView, modelSelection } from './selection.ts';
import { EffortPanel } from './EffortPanel.tsx';
import { usePopup } from './popup.ts';

export type ModelControlsProps = Omit<ModelSelectInjected, 'directory'> & PropsLocale<'model'> & {
  readonly locked: boolean;
  readonly useDirectory: () => ModelDirectoryState;
  readonly selectEffort: (route: ModelSelection, effort: string | undefined) => void;
};

/** SDK-derived values/hooks and callbacks only; DSH retains all business state. */
export function ModelControls({ locked, available, useDirectory, load, select, selectEffort, t }: ModelControlsProps) {
  const state = useDirectory();
  const alive = useRef(true);
  const restoreModelFocus = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [open, setOpen] = useState<'model' | 'effort' | null>(null);
  const modelAnchor = useRef<HTMLButtonElement>(null), effortAnchor = useRef<HTMLButtonElement>(null);
  const busy = state.pending !== null || state.status === 'selecting';
  const disabled = locked || !available || busy;
  const current = state.current;
  const model = state.groups.find(group => group.id === current?.provider)?.models.find(model => model.id === current?.model);
  const view = useMemo(() => effortView(model, current, {
    /* The host wording is read only where the catalog advertises no tier to
       name: the trigger then falls back to it and stays disabled. */
    defaultName: t('effort.providerDefault'),
    retainedEffort: state.retainedEffort,
  }), [model, current, t, state.retainedEffort]);
  const { choices, preview, caption, effort } = view;
  /* Two stops are the least a slider can travel between: a catalog with fewer
     has nothing to pick, so the trigger stays shut and no empty track is drawn. */
  const pickable = choices.length > 1;
  const label = model?.name ?? current?.model ?? t('trigger.fallback');
  const close = useCallback(() => setOpen(null), []);
  useEffect(() => { if (available && state.status === 'idle') load(); }, [available, state.status, load]);
  useEffect(() => { close(); }, [current?.provider, current?.model, locked, available, close]);
  useEffect(() => {
    if (!busy && restoreModelFocus.current) { modelAnchor.current?.focus(); restoreModelFocus.current = false; }
  }, [busy]);
  if (!available) return null;
  return <div className="ccd-model-controls" data-ccd-model-controls>
    <button ref={modelAnchor} className="ccd-model-trigger" data-ccd-model-trigger type="button" disabled={disabled}
      aria-label={current ? t('trigger.aria', { model: label }) : t('trigger.selectAria')} aria-haspopup="dialog" aria-expanded={open === 'model'}
      onClick={() => { setOpen(open === 'model' ? null : 'model'); load(); }}>
      <span className="ccd-model-label">{label}</span>
    </button>
    {caption !== undefined && <button ref={effortAnchor} className="ccd-effort-trigger" type="button" disabled={disabled || !pickable}
      aria-label={`Effort: ${caption}`} aria-haspopup="dialog" aria-expanded={open === 'effort'}
      onClick={() => setOpen(open === 'effort' ? null : 'effort')}><span>{caption}</span></button>}
    {open === 'effort' && current && pickable && <EffortPanel key={`${current.provider}/${current.model}`} anchor={effortAnchor} choices={choices} selected={preview} disabled={locked || !available} busy={busy} error={state.error}
      onClose={close} onCommit={index => { const choice = choices[index]; if (choice && choice.id !== effort) selectEffort(current, choice.id); }} />}
    {open === 'model' && <ModelPanel anchor={modelAnchor} state={state} disabled={disabled} load={load} t={t} onClose={close}
      onSelect={selection => { restoreModelFocus.current = true; void select(selection).then(result => { if (!alive.current) return; if (result?.ok) { modelAnchor.current?.focus(); close(); } }).catch(() => {}); }} />}
    {open === null && state.error && <div className="ccd-model-error" role="alert">{state.error}<button type="button" className="ccd-model-retry" onClick={load}>{t('action.reload')}</button></div>}
  </div>;
}

function ModelPanel({ anchor, state, disabled, load, t, onClose, onSelect }: PropsLocale<'model'> & {
  readonly anchor: React.RefObject<HTMLButtonElement>;
  readonly state: ModelDirectoryState;
  readonly disabled: boolean;
  readonly load: () => void;
  readonly onClose: () => void;
  readonly onSelect: (selection: ModelSelection) => void;
}) {
  const { panel, position } = usePopup(anchor, onClose);
  const [query, setQuery] = useState('');
  const groups = state.groups.map(group => ({ ...group, models: group.models.filter(model => `${model.name} ${model.id} ${group.name}`.toLowerCase().includes(query.toLowerCase())) })).filter(group => group.models.length > 0);
  return <div ref={panel} className="ccd-model-panel" role="dialog" aria-label={t('menu.model')} style={position}>
    {/* The field keeps the host's string as its accessible name only: the card
        draws no hint text and no frame (controls.css), because the panel
        focuses this cell the moment it opens and a placeholder plus §七's ring
        would put a framed, labelled box on the card's first row. */}
    <input data-autofocus className="ccd-model-search" aria-label={t('search.placeholder')} value={query} onChange={e => setQuery(e.currentTarget.value)}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); panel.current?.querySelector<HTMLButtonElement>('[data-model-option]')?.focus(); } }} />
    {state.status === 'loading' && <p role="status" className="ccd-model-note">{t('status.loading')}</p>}
    {state.error && <div role="alert" className="ccd-model-note">{state.error}<button type="button" className="ccd-model-retry" onClick={load}>{t('action.reload')}</button></div>}
    {state.failures.map(failure => <div key={failure.id} role="status" className="ccd-model-note">{failure.name}: {failure.message}<button type="button" className="ccd-model-retry" onClick={load}>{t('action.reload')}</button></div>)}
    {groups.length === 0 && state.status !== 'loading' && <p className="ccd-model-note">{query ? t('search.empty') : t('empty.models')}</p>}
    <div className="ccd-model-options" onKeyDown={event => {
      const targets = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = targets.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % targets.length : event.key === 'ArrowUp' ? (index - 1 + targets.length) % targets.length : event.key === 'Home' ? 0 : event.key === 'End' ? targets.length - 1 : undefined;
      if (next === undefined) return; event.preventDefault(); targets[next]?.focus();
    }}>
      {groups.map(group => <div key={group.id}><div className="ccd-model-provider">{group.name}</div>{group.models.map(model => {
        const chosen = state.current?.provider === group.id && state.current.model === model.id;
        return <button type="button" data-model-option key={model.id} aria-pressed={chosen} disabled={disabled}
          onClick={() => onSelect(modelSelection(group.id, model, state.current))}><span className="ccd-model-name">{model.name}</span><span aria-hidden="true">{chosen ? '✓' : ''}</span></button>;
      })}</div>)}
    </div>
  </div>;
}
