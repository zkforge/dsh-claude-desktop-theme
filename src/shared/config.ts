/**
 * The interface modules a configuration switch turns on.
 *
 * `composer-stats` is the one entry that mounts nothing of its own: it is the
 * Composer status bar's statistics readouts — `compat/stats-values.ts` plus the
 * Composer sheet — and it is off by default, so a fresh install shows the row
 * without the host's readout cluster. Turning it on mirrors one short value per
 * pill (the output rate, or the cache-hit share) in place of the host's own
 * label.
 */
export const FEATURE_IDS = [
  'shell', 'sidebar', 'new-session', 'conversation', 'tool-calls', 'statistics', 'composer-pet',
  'composer-stats',
] as const;

export type FeatureId = typeof FEATURE_IDS[number];
export type FeatureFlags = Readonly<Record<FeatureId, boolean>>;

/** Fields of the background-colour section; an empty string means "built-in palette". */
export const APPEARANCE_FIELDS = ['canvas', 'sidebar'] as const;
/** Fields of the typeface section; an empty string means "system stack". */
export const FONT_FIELDS = ['uiLatin', 'uiCjk', 'code'] as const;
/** Fields of the view-options section. */
export const VIEW_FIELDS = ['showEmptyGroups'] as const;

export type AppearanceField = typeof APPEARANCE_FIELDS[number];
export type FontField = typeof FONT_FIELDS[number];
export type ViewField = typeof VIEW_FIELDS[number];

export type AppearanceConfig = Readonly<Record<AppearanceField, string>>;
export type FontsConfig = Readonly<Record<FontField, string>>;
export type ViewConfig = Readonly<Record<ViewField, boolean>>;

export interface StyleConfig {
  readonly enabled: boolean;
  readonly debug: boolean;
  readonly features: FeatureFlags;
  readonly appearance: AppearanceConfig;
  readonly fonts: FontsConfig;
  readonly view: ViewConfig;
}

export interface StyleOptions {
  readonly enabled?: boolean;
  readonly debug?: boolean;
  readonly features?: Partial<FeatureFlags>;
  readonly appearance?: Partial<Record<AppearanceField, unknown>>;
  readonly fonts?: Partial<Record<FontField, unknown>>;
  readonly view?: Partial<Record<ViewField, unknown>>;
}

export const DEFAULT_FEATURES: FeatureFlags = Object.freeze({
  shell: true,
  sidebar: true,
  'new-session': true,
  conversation: true,
  'tool-calls': false,
  statistics: false,
  'composer-pet': true,
  'composer-stats': false,
});

/** Empty strings keep the built-in palette and the system font stack in charge. */
export const DEFAULT_APPEARANCE: AppearanceConfig = Object.freeze({
  canvas: '',
  sidebar: '',
});

export const DEFAULT_FONTS: FontsConfig = Object.freeze({
  uiLatin: '',
  uiCjk: '',
  code: '',
});

/**
 * The view-options section's defaults.
 *
 * `showEmptyGroups` is off, which means the sidebar hides a Workspace that has
 * no Session under the current filter — the reference's own default for that
 * switch, and the reason the row in the view-options card reads as "off" on a
 * fresh install.
 */
export const DEFAULT_VIEW: ViewConfig = Object.freeze({
  showEmptyGroups: false,
});

/** Three- or six-digit hex, with the leading `#`; both forms normalize to six. */
const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** One font family name: letters, digits, spaces and the separators fonts use. */
const FONT_NAME = /^[\p{L}\p{N} ._-]+$/u;
/** Font names longer than this are a pasted paragraph, not a family. */
export const FONT_NAME_MAX_LENGTH = 64;

/**
 * Normalize one user-entered colour to lowercase `#rrggbb`.
 *
 * The settings boundary accepts the short form as well, so a hand-edited patch
 * file and the colour input both land on one spelling.
 * @param value - raw section value of any type.
 * @returns the normalized colour, or an empty string when it is not a hex colour.
 */
export function normalizeColour(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  if (!HEX_COLOUR.test(trimmed)) return '';
  if (trimmed.length === 4) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  return trimmed;
}

/**
 * Normalize one user-entered font family name.
 *
 * A comma or a parenthesis would turn the value into a stack or a `url()`; the
 * theme layer composes the stack itself, so a single family is all that is
 * accepted. Quotes are dropped because the composer adds its own.
 * @param value - raw section value of any type.
 * @returns the collapsed family name, or an empty string when it is not one.
 */
export function normalizeFontName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const collapsed = value.replace(/["']/g, '').replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0 || collapsed.length > FONT_NAME_MAX_LENGTH) return '';
  if (!FONT_NAME.test(collapsed)) return '';
  return collapsed;
}

function resolveSection<T extends string>(
  label: string,
  fields: readonly T[],
  defaults: Readonly<Record<T, string>>,
  normalize: (value: unknown) => string,
  input: Partial<Record<T, unknown>> | undefined,
  strict: boolean,
): Readonly<Record<T, string>> {
  const section = { ...defaults } as Record<T, string>;
  for (const field of fields) {
    const value = input?.[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      if (strict) throw new TypeError(`${label}.${field} must be a string`);
      continue;
    }
    if (value.trim() === '') {
      section[field] = '';
      continue;
    }
    const normalized = normalize(value);
    if (normalized === '') {
      if (strict) throw new TypeError(`${label}.${field} is not a usable value`);
      continue;
    }
    section[field] = normalized;
  }
  return Object.freeze(section);
}

export function resolveConfig(input: StyleOptions = {}): StyleConfig {
  const features = { ...DEFAULT_FEATURES };
  for (const id of FEATURE_IDS) {
    const value = input.features?.[id];
    if (value !== undefined) {
      if (typeof value !== 'boolean') throw new TypeError(`features.${id} must be boolean`);
      features[id] = value;
    }
  }
  for (const key of ['enabled', 'debug'] as const) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') {
      throw new TypeError(`${key} must be boolean`);
    }
  }
  const view = { ...DEFAULT_VIEW };
  for (const field of VIEW_FIELDS) {
    const value = input.view?.[field];
    if (value !== undefined) {
      if (typeof value !== 'boolean') throw new TypeError(`view.${field} must be boolean`);
      view[field] = value;
    }
  }
  return Object.freeze({
    enabled: input.enabled ?? false,
    debug: input.debug ?? false,
    features: Object.freeze(features),
    appearance: resolveSection('appearance', APPEARANCE_FIELDS, DEFAULT_APPEARANCE, normalizeColour, input.appearance, true),
    fonts: resolveSection('fonts', FONT_FIELDS, DEFAULT_FONTS, normalizeFontName, input.fonts, true),
    view: Object.freeze(view),
  });
}

function section(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

/**
 * Fold the Host-served configuration section into a validated StyleConfig.
 * The client half reads its configuration through the settings transport, so
 * the value arrives as untyped JSON from a user-editable patch file: unknown
 * keys, wrong types and an absent section all fall back to the declared
 * defaults instead of failing the whole activation.
 * @param value - the section value from the Host, or undefined before it loads.
 * @returns the validated configuration; never throws.
 */
export function adoptConfig(value: unknown): StyleConfig {
  const input = section(value);
  if (input === undefined) return resolveConfig();
  const features: Record<FeatureId, boolean> = { ...DEFAULT_FEATURES };
  const rawFeatures = section(input.features);
  if (rawFeatures !== undefined) {
    for (const id of FEATURE_IDS) {
      if (typeof rawFeatures[id] === 'boolean') features[id] = rawFeatures[id];
    }
  }
  const view: Record<ViewField, boolean> = { ...DEFAULT_VIEW };
  const rawView = section(input.view);
  if (rawView !== undefined) {
    for (const field of VIEW_FIELDS) {
      if (typeof rawView[field] === 'boolean') view[field] = rawView[field];
    }
  }
  return resolveConfig({
    ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}),
    ...(typeof input.debug === 'boolean' ? { debug: input.debug } : {}),
    features,
    appearance: pickFields(APPEARANCE_FIELDS, section(input.appearance), normalizeColour),
    fonts: pickFields(FONT_FIELDS, section(input.fonts), normalizeFontName),
    view,
  });
}

/** Keep only declared fields and normalize them, so the strict resolver below
 * never sees an unusable value coming out of a hand-edited patch file. */
function pickFields<T extends string>(
  fields: readonly T[],
  input: Record<string, unknown> | undefined,
  normalize: (value: unknown) => string,
): Partial<Record<T, string>> {
  const picked: Partial<Record<T, string>> = {};
  if (input === undefined) return picked;
  for (const field of fields) {
    const value = input[field];
    if (value === undefined) continue;
    picked[field] = typeof value === 'string' && value.trim() === '' ? '' : normalize(value);
  }
  return picked;
}
