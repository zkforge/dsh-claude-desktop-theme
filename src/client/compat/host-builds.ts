/**
 * CSS-module prefix tables for the shipped DSH builds.
 *
 * DSH hashes CSS-module class names per build, and the installers are separate
 * builds even at one version: `0.2.0-rc.2` ships commit `5e9e301d` for macOS and
 * `04f392c9` for Windows, and every class of the pinned UI packages hashes
 * differently between them. This plugin's stylesheets and `HOST` selectors are
 * authored against the macOS build; a build listed below is rewritten through
 * {@link aliasHostClasses} before it reaches the document, so one source styles
 * both installers instead of duplicating every selector.
 *
 * Only the prefix differs. The local name after it (`_frame`, `_newSession`)
 * and the static web frontend's markdown classes (`_markdown_1ypvv_5`) are
 * identical in both builds, so neither needs an entry here.
 *
 * Keep the authored build stable and register each verified release below.
 * A new release may rehash every prefix; read its tables from `app.asar`.
 * The latest macOS build is also the preload fallback before the frame mounts.
 */

/** One shipped DSH build and the prefixes it uses for the pinned classes. */
export interface HostBuild {
  /** Stable identity of the build, used for diagnostics and memoized tables. */
  readonly id: string;
  /** The layout frame's own class name, which identifies the build in a document. */
  readonly frameClass: string;
  /** Authored prefix → this build's prefix; empty for the authored build. */
  readonly prefixes: Readonly<Record<string, string>>;
}

/**
 * The build the stylesheets are authored against: DSH `0.2.0-rc.2`, macOS
 * commit `5e9e301d`. An empty table is the identity rewrite.
 */
export const PINNED_BUILD: HostBuild = Object.freeze({
  id: 'dsh-0.2.0-rc.2-5e9e301d',
  frameClass: '_6Qf49G_frame',
  prefixes: Object.freeze({}),
});

/**
 * DSH `0.2.0-rc.2`, Windows commit `04f392c9`. Read from that build's
 * `app.asar`: each entry is the same CSS module's class-name map, keyed by the
 * prefix this plugin authored.
 */
export const WINDOWS_BUILD: HostBuild = Object.freeze({
  id: 'dsh-0.2.0-rc.2-04f392c9',
  frameClass: 'BynINW_frame',
  prefixes: Object.freeze({
    '-gRAhq_': 'ws8cKG_',
    'Da3aKq_': '_4Nnt6q_',
    'Dws9Sa_': 'wCInkW_',
    'HiSsxa_': '_3GBCTG_',
    'IzP3Va_': 'cJsG2q_',
    'OpZ85W_': 'iq1doa_',
    'Q2dzhW_': 'pFy1Ka_',
    'ST7X_W_': 'Dc7zOa_',
    'ZogL4G_': 'ET65mq_',
    '_2tNPVa_': 'EBLgjq_',
    '_3WPZCG_': '_2H3hWW_',
    '_3li69W_': 'b06baG_',
    '_6Qf49G_': 'BynINW_',
    '_7514NG_': '_9lTDKa_',
    'bocITq_': 'Hqq-bq_',
    'cl2Rlq_': 'wq12jW_',
    'dVdiKa_': 'srf2qa_',
    'gKv1-q_': 'v5IAXa_',
    'icaHSq_': 'xz4KEq_',
    'iq4beG_': 'WgQWqa_',
    'jJkEga_': 'hIlkoa_',
    'wXeviG_': 'dlU_AG_',
    'y0jqnG_': '_2WTFBq_',
    'yhfFVG_': 'RlGAzG_',
  }),
});

/** DSH `0.2.1-rc.3`, macOS commit `be72761e`, read from its shipped app.asar. */
export const MACOS_BUILD: HostBuild = Object.freeze({
  id: 'dsh-0.2.1-rc.3-be72761e',
  frameClass: 'PIRFFq_frame',
  prefixes: Object.freeze({
    '-gRAhq_': 'BFlR-G_',
    'Da3aKq_': 'sDDavq_',
    'Dws9Sa_': '_77Pn0W_',
    'HiSsxa_': 'ijfCxa_',
    'IzP3Va_': 'AkCqbG_',
    'OpZ85W_': 'TQ0rwa_',
    'Q2dzhW_': 'UHhYua_',
    'ST7X_W_': 'kiGsTW_',
    'ZogL4G_': 'hjANda_',
    '_2tNPVa_': 'XdyUwa_',
    '_3WPZCG_': 'kB3qhq_',
    '_3li69W_': 'nIjNjW_',
    '_6Qf49G_': 'PIRFFq_',
    '_7514NG_': 'Kjh-qa_',
    'bocITq_': '_8tPydW_',
    'cl2Rlq_': 'htuFrW_',
    'dVdiKa_': 'pNt0EW_',
    'gKv1-q_': 'XNZzAa_',
    'icaHSq_': 'tnXGgG_',
    'iq4beG_': 'ga5fXW_',
    'jJkEga_': 'JoiKIa_',
    'wXeviG_': 'SJRB_q_',
    'y0jqnG_': 'X0HXfW_',
    'yhfFVG_': 'JZLxKW_',
  }),
});

/** Every build whose class names this plugin knows how to speak. */
export const HOST_BUILDS: readonly HostBuild[] = Object.freeze([PINNED_BUILD, WINDOWS_BUILD, MACOS_BUILD]);

/** Detection results that came from the document itself, so they never change. */
const identified = new WeakMap<Document, HostBuild>();

/** How a document's build was decided. */
export type HostBuildState =
  /** The frame named a registered build. */
  | 'identified'
  /** The shell has not rendered its frame yet; the preload's platform decided. */
  | 'pending'
  /** A frame exists and belongs to no registered build: the classes cannot match. */
  | 'unknown';

/** One document's build and how confidently it was recognised. */
export interface HostBuildStatus {
  readonly build: HostBuild;
  readonly state: HostBuildState;
}

/** The frame's class names, or an empty list when there is no frame yet. */
function frameClasses(document: Document): string[] {
  const frame = typeof document.querySelector === 'function'
    ? document.querySelector('[data-slot="root"] > div')
    : null;
  return typeof frame?.className === 'string' ? frame.className.split(/\s+/u) : [];
}

/** The build the preload's `data-platform` suggests; a guess, not evidence. */
function platformBuild(document: Document): HostBuild {
  const platform = document.documentElement?.dataset?.platform;
  return platform === 'win32' ? WINDOWS_BUILD : platform === 'darwin' ? MACOS_BUILD : PINNED_BUILD;
}

/**
 * Identify the build behind one document, and say how it was identified.
 *
 * The frame's own class name is the evidence: it is present from the first
 * paint of the shell and names the build exactly. Before the shell renders,
 * the Electron preload's `data-platform` attribute decides — it is written
 * before any page script runs — so a stylesheet mounted during client boot is
 * already rewritten for the right build.
 *
 * `unknown` is the state worth reporting: the frame is on screen, its classes
 * match no table here, and every host selector in this plugin will therefore
 * miss until the tables are refreshed from that build.
 *
 * @param document - the renderer document to identify.
 * @returns the matching build and whether the document itself confirmed it.
 */
export function hostBuildStatus(document: Document): HostBuildStatus {
  const known = identified.get(document);
  if (known !== undefined) return { build: known, state: 'identified' };
  const names = frameClasses(document);
  if (names.length === 0) return { build: platformBuild(document), state: 'pending' };
  const match = HOST_BUILDS.find(build => names.includes(build.frameClass));
  if (match === undefined) return { build: platformBuild(document), state: 'unknown' };
  identified.set(document, match);
  return { build: match, state: 'identified' };
}

/**
 * Identify the build behind one document.
 * @param document - the renderer document to identify.
 * @returns the matching build, or the authored one when nothing is recognised.
 */
export function detectHostBuild(document: Document): HostBuild {
  return hostBuildStatus(document).build;
}

/**
 * Report the build as soon as the shell's frame settles the question.
 *
 * The frame appears after this plugin's client boots, so a status read at mount
 * time is still `pending`; this watches for the first frame and then stops,
 * which is also the moment an unregistered build becomes visible.
 *
 * @param document - the renderer document to watch.
 * @param settle - receives the first non-pending status, exactly once.
 * @returns disposer that stops the watch.
 */
export function watchHostBuild(document: Document, settle: (status: HostBuildStatus) => void): () => void {
  const status = hostBuildStatus(document);
  if (status.state !== 'pending') {
    settle(status);
    return () => {};
  }
  if (typeof MutationObserver !== 'function' || document.documentElement === null) return () => {};
  let released = false;
  const observer = new MutationObserver(() => {
    if (released) return;
    const next = hostBuildStatus(document);
    if (next.state === 'pending') return;
    released = true;
    observer.disconnect();
    settle(next);
  });
  try {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  } catch {
    observer.disconnect();
    return () => {};
  }
  return () => {
    if (released) return;
    released = true;
    observer.disconnect();
  };
}

/**
 * Rewrite authored host prefixes in one stylesheet or selector.
 *
 * The authored build is returned untouched, and a build without a table for a
 * prefix keeps it, so an unknown class degrades to "the selector does not
 * match" instead of corrupting the rule.
 * @param text - stylesheet text or a selector list using authored prefixes.
 * @param build - build whose prefixes the text should carry.
 * @returns the text as that build names its classes.
 */
export function aliasHostClasses(text: string, build: HostBuild): string {
  let out = text;
  for (const [authored, actual] of Object.entries(build.prefixes)) {
    if (out.includes(authored)) out = out.split(authored).join(actual);
  }
  return out;
}
