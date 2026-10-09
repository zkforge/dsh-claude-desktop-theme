import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { MouseEvent, ReactElement } from 'react';
import type {
  ConfigFormPort, SettingsPathOp, ThemePreference, ThemePreferencePort,
} from '../../contracts/ports.ts';
import { adoptConfig, APPEARANCE_FIELDS } from '../../../shared/config.ts';
import type { AppearanceField, FeatureId, FontField } from '../../../shared/config.ts';
import { hostBuildStatus } from '../../compat/host-builds.ts';
import { commitColour, commitFont, setOperation, unsetOperation } from './edits.ts';
import type { FieldErrors } from './edits.ts';
import { loadSystemFontFamilies } from './fonts.ts';
import { ColourRow, FontRow, SwitchRow, ThemeRow } from './fields.tsx';
import { zh } from './locales.ts';
import type { SettingsKey } from './locales.ts';

/** Translate one dictionary key; the locale seat supplies the real one. */
export type SettingsTranslate = (key: string, params?: Record<string, unknown>) => string;

/** Props the registration layer derives; the component never sees `ctx`. */
export interface ConfigPageProps {
  /** Page host's occurrence view: `summary` beside a row title, `page` for the form. */
  readonly view?: string | undefined;
  /** Locale seat synthesized from the registration's namespace. */
  readonly t?: SettingsTranslate | undefined;
  /** This plugin's own configuration form, passed by the assembly layer. */
  readonly form: ConfigFormPort;
  /** The native theme preference, or null when the theme service lacks it. */
  readonly themePreference?: ThemePreferencePort | null | undefined;
}

type WriteStatus = 'idle' | 'saving' | 'saved' | 'failed';

/** The text a field shows while it is being edited, keyed by field name. */
interface Editing {
  readonly key: string;
  readonly text: string;
}

const COLOUR_LABELS: Record<AppearanceField, SettingsKey> = {
  canvas: 'field.canvas',
  sidebar: 'field.sidebar',
};

const FONT_LABELS: Record<FontField, SettingsKey> = {
  uiLatin: 'field.uiLatin',
  uiCjk: 'field.uiCjk',
  code: 'field.code',
};

/** Rows the page shows; `uiCjk` stays available through the patch file. */
const OFFERED_FONTS: readonly FontField[] = ['uiLatin', 'code'];

/** Theme preferences in the reference control's order: system, light, dark. */
const THEME_OPTIONS: readonly ThemePreference[] = ['system', 'light', 'dark'];

const THEME_KEYS: Record<ThemePreference, SettingsKey> = {
  system: 'theme.system',
  light: 'theme.light',
  dark: 'theme.dark',
};

/** Switches the page offers, in row order; `tool-calls` is not one of them. */
const OFFERED_FEATURES: readonly FeatureId[] = [
  'shell',
  'sidebar',
  'new-session',
  'conversation',
  'composer-pet',
  'statistics',
  'composer-stats',
  'context-panel',
];

const FEATURE_KEYS: Record<FeatureId, SettingsKey> = {
  shell: 'feature.shell',
  sidebar: 'feature.sidebar',
  'new-session': 'feature.new-session',
  conversation: 'feature.conversation',
  'tool-calls': 'feature.tool-calls',
  statistics: 'feature.statistics',
  'composer-pet': 'feature.composer-pet',
  'composer-stats': 'feature.composer-stats',
  'context-panel': 'feature.context-panel',
};

/**
 * Rows whose label alone does not say what the switch draws. The readouts are
 * the one such row: "statistics readouts" names a place in the row, not the two
 * numbers it puts there.
 */
const FEATURE_HINTS: Partial<Record<FeatureId, SettingsKey>> = {
  'composer-stats': 'hint.composer-stats',
  'context-panel': 'hint.context-panel',
};

/**
 * The row configuration page registered for `plugins.row.config`.
 *
 * The page writes as you go: a switch, a colour, a chosen family or a settled
 * text field is submitted immediately, so there is no save button and no draft
 * to reconcile — the served configuration is the only state the controls read.
 * Text fields keep a local buffer until they are left or confirmed, because a
 * half-typed colour must not reach the settings boundary.
 * @param props - Occurrence view, locale seat, the plugin's form and the
 * features whose mounts are still planned.
 * @returns The summary line or the configuration form.
 */
export function ConfigPage(props: ConfigPageProps): ReactElement {
  const { view, t, form, themePreference: theme } = props;
  const translate = useMemo<SettingsTranslate>(
    () => t ?? ((key: string) => (zh as Record<string, string>)[key] ?? key),
    [t],
  );
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form]);
  const read = useCallback(() => form.getSnapshot(), [form]);
  const snapshot = useSyncExternalStore(subscribe, read);
  const served = useMemo(
    () => (snapshot.status === 'ready' ? adoptConfig(snapshot.value) : null),
    [snapshot.status, snapshot.value],
  );

  /* The theme preference belongs to the theme service, so the control reads it
     from the service snapshot and never keeps a copy. */
  const themePort = theme ?? null;
  const subscribeTheme = useCallback(
    (listener: () => void) => (themePort === null ? () => {} : themePort.subscribe(listener)),
    [themePort],
  );
  const readTheme = useCallback(
    () => (themePort === null ? null : themePort.preference()),
    [themePort],
  );
  const preference = useSyncExternalStore(subscribeTheme, readTheme);

  const [status, setStatus] = useState<WriteStatus>('idle');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [editing, setEditing] = useState<Editing | null>(null);
  const [menu, setMenu] = useState<{ readonly field: FontField; readonly anchor: HTMLElement } | null>(null);
  const [fontFamilies, setFontFamilies] = useState<readonly string[]>([]);

  /** Submit one settled change; the Host's verdict drives the status line. */
  const write = useCallback((ops: readonly SettingsPathOp[]): Promise<boolean> => {
    if (ops.length === 0) return Promise.resolve(true);
    setStatus('saving');
    return form.mutate(ops, form.getSnapshot().revision).then(
      accepted => { setStatus(accepted ? 'saved' : 'failed'); return accepted; },
      () => { setStatus('failed'); return false; },
    );
  }, [form]);

  const clearError = useCallback((field: string) => {
    setErrors(current => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field as keyof FieldErrors];
      return next;
    });
  }, []);

  const textOf = useCallback((key: string, fallback: string): string => (
    editing?.key === key ? editing.text : fallback
  ), [editing]);

  const edit = useCallback((key: string, text: string) => {
    setEditing({ key, text });
  }, []);

  const askFontFamilies = useCallback(() => {
    void loadSystemFontFamilies().then(families => setFontFamilies(families));
  }, []);

  /** Settle one colour field: normalize, report or write, then drop the buffer. */
  const settleColour = useCallback((field: AppearanceField, text?: string) => {
    if (served === null) return;
    const raw = text ?? textOf(field, served.appearance[field]);
    const result = commitColour(['appearance', field], raw, served.appearance[field]);
    if (result.error !== undefined) {
      setErrors(current => ({ ...current, [field]: result.error }));
      return;
    }
    clearError(field);
    setEditing(null);
    void write(result.op === undefined ? [] : [result.op]);
  }, [served, textOf, clearError, write]);

  /** Settle one typeface field, from the box's buffer or an explicit name. */
  const settleFont = useCallback((field: FontField, text?: string) => {
    if (served === null) return;
    const raw = text ?? textOf(field, served.fonts[field]);
    const result = commitFont(['fonts', field], raw, served.fonts[field]);
    if (result.error !== undefined) {
      setErrors(current => ({ ...current, [field]: result.error }));
      return;
    }
    clearError(field);
    setEditing(null);
    void write(result.op === undefined ? [] : [result.op]);
  }, [served, textOf, clearError, write]);

  if (view === 'summary') {
    return <span className="ccd-settings-summary">{translate('summary')}</span>;
  }

  if (snapshot.status !== 'ready' || served === null) {
    const key: SettingsKey = snapshot.status === 'unavailable' ? 'state.unavailable' : 'state.loading';
    return <p className="ccd-settings-notice">{translate(key)}</p>;
  }

  const statusKey: SettingsKey | null = status === 'saving' ? 'state.saving'
    : status === 'saved' ? 'state.saved'
      : status === 'failed' ? 'state.failed' : null;
  const buildState = hostBuildStatus(document).state;

  return (
    <div className="ccd-settings-page">
      <section className="ccd-settings-section">
        <h4 className="ccd-settings-title">{translate('section.general')}</h4>
        <SwitchRow
          id="ccd-settings-enabled"
          label={translate('field.enabled')}
          checked={served.enabled}
          onChange={value => void write([setOperation(['enabled'], value)])}
        />
      </section>

      {/* Host class names are hashed per DSH build. An unregistered build makes
          every host selector miss while the switches above still read "on", so
          the page says why the interface looks native. The frame is on screen
          by the time this page renders, which is when the answer is knowable. */}
      {buildState === 'unknown' ? (
        <p className="ccd-settings-note ccd-settings-warning" role="status">
          {translate('note.unknownBuild')}
        </p>
      ) : null}

      <section className="ccd-settings-section">
        <h4 className="ccd-settings-title">{translate('section.features')}</h4>
        {OFFERED_FEATURES.map(id => {
          const hint = FEATURE_HINTS[id];
          return (
            <SwitchRow
              key={id}
              id={`ccd-settings-feature-${id}`}
              label={translate(FEATURE_KEYS[id])}
              {...(hint === undefined ? {} : { hint: translate(hint) })}
              checked={served.features[id]}
              onChange={value => void write([setOperation(['features', id], value)])}
            />
          );
        })}
      </section>

      <section className="ccd-settings-section">
        <h4 className="ccd-settings-title">{translate('section.appearance')}</h4>
        {preference === null || themePort === null ? null : (
          <ThemeRow
            id="ccd-settings-theme"
            label={translate('field.theme')}
            value={preference}
            options={THEME_OPTIONS.map(id => ({ id, label: translate(THEME_KEYS[id]) }))}
            onChange={next => themePort.set(next)}
          />
        )}
        {APPEARANCE_FIELDS.map(field => {
          const failure = errors[field];
          return (
            <ColourRow
              key={field}
              id={`ccd-settings-${field}`}
              label={translate(COLOUR_LABELS[field])}
              value={textOf(field, served.appearance[field])}
              placeholder={translate('placeholder.colour')}
              resetLabel={translate('action.reset')}
              {...(failure === undefined ? {} : { error: translate(failure) })}
              onChange={text => { edit(field, text); clearError(field); }}
              onCommit={() => settleColour(field)}
              onReset={() => {
                setEditing(null);
                clearError(field);
                void write([unsetOperation(['appearance', field])]);
              }}
            />
          );
        })}
        {/* The two colour rows configure the light canvas; the dark palette is
            built in, so the note sits under the pair rather than on each row. */}
        <p className="ccd-settings-note">{translate('note.coloursApplyToLight')}</p>
      </section>

      {/* The one view setting this plugin owns. The sidebar's view-options card
          writes the same field through the same transport, so the two surfaces
          cannot disagree; the menu carries the reference's wording, this page
          the configuration's. */}
      <section className="ccd-settings-section">
        <h4 className="ccd-settings-title">{translate('section.view')}</h4>
        <SwitchRow
          id="ccd-settings-show-empty-groups"
          label={translate('field.showEmptyGroups')}
          hint={translate('hint.showEmptyGroups')}
          checked={served.view.showEmptyGroups}
          onChange={value => void write([setOperation(['view', 'showEmptyGroups'], value)])}
        />
      </section>

      <section className="ccd-settings-section">
        <h4 className="ccd-settings-title">{translate('section.fonts')}</h4>
        {OFFERED_FONTS.map(field => {
          const failure = errors[field];
          return (
            <FontRow
              key={field}
              id={`ccd-settings-font-${field}`}
              label={translate(FONT_LABELS[field])}
              value={textOf(field, served.fonts[field])}
              placeholder={translate('placeholder.font')}
              resetLabel={translate('action.reset')}
              {...(failure === undefined ? {} : { error: translate(failure) })}
              anchor={menu?.field === field ? menu.anchor : undefined}
              families={fontFamilies}
              menuLabels={{
                search: translate('picker.search'),
                empty: translate('picker.empty'),
                count: count => translate('picker.count', { count }),
                unavailable: translate('hint.fontListUnavailable'),
                useTyped: name => translate('picker.useTyped', { name }),
              }}
              onToggle={(event: MouseEvent<HTMLButtonElement>) => {
                askFontFamilies();
                const anchor = event.currentTarget;
                setMenu(current => (current?.field === field ? null : { field, anchor }));
              }}
              onSelect={family => {
                setEditing(null);
                clearError(field);
                void write([setOperation(['fonts', field], family)]);
              }}
              onUseText={text => {
                setEditing(null);
                clearError(field);
                settleFont(field, text);
              }}
              onCloseMenu={() => setMenu(null)}
              onReset={() => {
                setEditing(null);
                clearError(field);
                void write([unsetOperation(['fonts', field])]);
              }}
            />
          );
        })}
      </section>

      <p className="ccd-settings-status" role="status">{statusKey === null ? '' : translate(statusKey)}</p>
    </div>
  );
}
