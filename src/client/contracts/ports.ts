import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { ThemePreference, ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client';
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client';

export type { ThemePreference };

export type Disposer = () => void;

/**
 * One settings-path operation, the shape `remote.settings.mutate` accepts on
 * the wire. A nested field is addressed by its path segments — `set()` only
 * ever sends a one-segment path — and `unset` removes the profile override so
 * the schema default takes over again.
 * Source: packages/client/ui-settings/src/client/config-forms.ts and
 * packages/api/settings-controller (`SettingsPathOp`).
 */
export type SettingsPathOp =
  | { readonly op: 'set'; readonly path: readonly string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: readonly string[] };

/** Read side of one namespace's form; only the members this plugin uses. */
export interface ConfigFormSnapshot {
  /** `loading` until the describe view arrives, `ready` once a valid value is served, `unavailable` without one. */
  readonly status: string;
  /** The effective section, projected to the volatile fields; undefined until `ready`. */
  readonly value: unknown;
  /** Host revision of this namespace, the fence every write carries. */
  readonly revision?: number;
  /** Whether the Host will persist a write from this page. */
  readonly writable?: boolean;
}

/**
 * One namespace's configuration form, structurally matching
 * `@deepseek-ai/dsh-client-ui-settings`' `ConfigForm` — the service every
 * settings-backed client plugin reads its own section through. Only the
 * members this plugin uses are declared, and the real service object is passed
 * through unchanged, so no second definition of its behaviour lives here.
 * Source: packages/client/ui-settings/src/client/config-forms.ts.
 */
export interface ConfigFormPort {
  /** Current section snapshot; `value` is the effective section until it is served. */
  getSnapshot(): ConfigFormSnapshot;
  /** Observe snapshot replacements. */
  subscribe(listener: () => void): Disposer;
  /** Queue one scalar write into the section; resolves with the Host's verdict. */
  set(field: string, value: unknown): Promise<boolean>;
  /** Queue one field clear, restoring the inherited or default value. */
  unset(field: string): Promise<boolean>;
  /** Queue one atomic namespace mutation, fenced by the revision it was read at. */
  mutate(ops: readonly SettingsPathOp[], expectedRevision?: number): Promise<boolean>;
}

/** Namespace-addressed access to the settings transport. */
export interface ConfigFormsPort {
  /** @param namespace - the loader entry id whose section is wanted. */
  get(namespace: string): ConfigFormPort;
}

/**
 * One right-Sidebar tab as the cross-plugin face reports it: membership only,
 * independent of visible panes.
 * Source: packages/client/ui-sidebar-right/src/client/persistence.ts.
 */
export interface SidebarTabRecord {
  readonly sessionId: string;
  readonly tabId: string;
  readonly kind: string;
  readonly contentId?: string;
}

/**
 * The cross-plugin right-Sidebar face the official panel plugins publish as
 * `ctx.sidebarRight`, a reflect-provided service
 * (`dsh-client-ui-sidebar-right`, "Cross-plugin right-Sidebar face"). That
 * package is not part of this plugin's type baseline, so only the members the
 * header uses are declared here and the real object is passed through
 * unchanged; a partial service means no header views rather than a dead button.
 */
export interface SidebarRightPort {
  /** Open one page kind for the on-screen Session; an unregistered kind throws. */
  openTab(kind: string, options?: { readonly params?: Record<string, string> }): void;
  /** Focus a tab and the pane holding it; a missing tab is left alone. */
  focus(tabId: string): void;
  /** Open tab metadata across adopted Sessions. */
  readonly openTabs: { getSnapshot(): readonly SidebarTabRecord[] };
  /**
   * Collapse the column, or expand it and focus its active dock pane.
   *
   * The header's shipped re-entry control (`ExpandButton`) is shadowed by this
   * plugin's corner entry, so the Session menu's own row is what reveals a
   * collapsed column again; a build whose face does not carry this member
   * keeps that row out rather than offering one that cannot act.
   */
  toggleExpanded?(): void;
}

/**
 * The tab-type registry that face publishes as `ctx.sidebarRightTabs`. A header
 * view is only offered while its kind is registered, so a build without the
 * terminal or browser plugin keeps no dead button. Membership is read by
 * presence and observed through the registry's own low-frequency signal.
 * Source: packages/client/ui-sidebar-right/src/client/tab-registry.ts.
 */
export interface SidebarRightTabsPort {
  /** @param kind - page type the panel can place; undefined when unregistered. */
  get(kind: string): unknown;
  /** @param listener - synchronous invalidation callback. */
  subscribe(listener: () => void): Disposer;
}

/**
 * The host's provisional New Sessions, as the sidebar column reads them.
 *
 * DSH creates the Session the moment its New Session entry is used and keeps
 * the row in the list while `SessionSummary.blank` is true — the host's own
 * fact for "created, no message yet". The Workspace browser shows the selected
 * blank entry; the CCD column keeps every blank row out of the list, so the
 * entry arrives with the first sent message. Filtering is presentation: the
 * plugin writes no session state and hides nothing the host would call durable.
 */
export interface BlankSessionsPort {
  /** Session ids the host still presents as a provisional New Session. */
  ids(): ReadonlySet<string>;
  /** Observe list replacements and row-state changes; returns the releaser. */
  subscribe(listener: () => void): Disposer;
}

/** Actual SDK types, never a second definition of DSH component props. */
export interface HostServices {
  readonly slots: Context['slots'];
  readonly theme: Pick<ThemeRuntime, 'overrideTokens'>;
  /**
   * The native light／dark／system preference as the configuration page sees it,
   * or null on a build whose theme service does not publish it. DSH owns the
   * value (the user-settings document owns the durable preference and
   * `prefers-color-scheme` answers for `system`), so the page reads and writes
   * it instead of holding a copy.
   */
  readonly themePreference: ThemePreferencePort | null;
  readonly workspace: Pick<UiWorkspace, 'openSession' | 'openWorkspace' | 'startSession'>;
  /**
   * Provisional New Sessions, or null on a build that does not publish the
   * session list; a null port leaves the native rows exactly as they are.
   */
  readonly blankSessions: BlankSessionsPort | null;
  /** The settings transport carrying this plugin's own configuration section. */
  readonly configForms: ConfigFormsPort;
}

/**
 * Read／write face of the theme service's preference: the same members the
 * official Appearance row uses (`getTheme`／`setTheme`／`theme/change`), so a
 * second control cannot disagree with the first one.
 */
export interface ThemePreferencePort {
  /** The persisted preference — never the resolved active theme. */
  preference(): ThemePreference;
  /** Switch the preference through the theme service's only write entry. */
  set(preference: ThemePreference): void;
  /** Observe preference, registry and OS-scheme changes; returns the releaser. */
  subscribe(listener: () => void): Disposer;
}

export interface DomPort {
  activate(): Disposer;
  mountStyles(css: string): Disposer;
}

export interface Logger {
  debug(message: string): void;
  /** `error` carries a cause when there is one; a report without one is fine. */
  error(message: string, error?: unknown): void;
}
