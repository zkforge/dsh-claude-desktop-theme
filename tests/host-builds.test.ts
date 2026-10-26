import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  HOST_BUILDS, MACOS_BUILD, PINNED_BUILD, WINDOWS_BUILD, WINDOWS_LEGACY_BUILD, aliasHostClasses, detectHostBuild, hostBuildStatus, watchHostBuild,
} from '../src/client/compat/host-builds.ts';
import type { HostBuildStatus } from '../src/client/compat/host-builds.ts';
import { hostAnchors, hostSelectors } from '../src/client/compat/host-dom.ts';

/*
 * The macOS and Windows installers of DSH `0.2.0-rc.2` are separate builds —
 * commits `5e9e301d` and `04f392c9` — and every CSS-module class of the pinned
 * UI packages hashes differently between them. The stylesheets and `HOST`
 * selectors are authored against the macOS build, so these tests keep the
 * Windows table honest: complete (every class the plugin names is in it),
 * distinct (no entry is the identity) and correct for the classes read from
 * that build's `app.asar`.
 */

/**
 * Classes the static web frontend owns; both builds ship them unchanged.
 *
 * `_1ypvv_` / `_1wejo_` are the markdown and code-block sheets. Everything of
 * `_4ub78_` is `ui-primitives`' `Menu` — its card, its rows, its label seat and
 * its check — which reaches the renderer from the same `dsh-web-frontend` dist
 * on both installers; the plugin's sheets and its selector table name those
 * directly (`theme/menus.css` hides the icon seat, `theme/tokens.css` paints the
 * check, `theme/composer.css` drops the mode card's second line,
 * `compat/host-dom.ts` reads the row's label and the row group). That bundle is
 * matched by shape rather than by name, because an entry-by-entry list would
 * have to grow with every class the plugin reads next, and because a name like
 * `_itemLabel_4ub78_190` is one class rather than the `_itemLabel_` prefix the
 * scan below would otherwise collect.
 */
const SHARED_CLASSES = ['_markdown_1ypvv_5', '_fileMention_1ypvv_85', '_linkIcon_1ypvv_94', '_markdown_1wejo_28'];

/** Shared frontend Menu, Modal and RiskConfirmation classes: `<local>_<hash>_<line>`. */
const SHARED_MENU = /_[_A-Za-z0-9]*_(?:4ub78|o6lrb|cjd8z)_\d+/gu;

const root = fileURLToPath(new URL('../', import.meta.url));

/** Drop the shared classes, so only build-specific ones are collected. */
function withoutShared(text: string): string {
  let out = text.replace(SHARED_MENU, '');
  for (const name of SHARED_CLASSES) out = out.split(name).join('');
  return out;
}

function sources(extension: string): string[] {
  return readdirSync(`${root}src`, { recursive: true, encoding: 'utf8' })
    .filter(name => name.endsWith(extension))
    .map(name => readFileSync(`${root}src/${name}`, 'utf8'));
}

/** Host prefixes named by the stylesheets' selectors. */
function cssPrefixes(): Set<string> {
  const found = new Set<string>();
  for (const sheet of sources('.css')) {
    for (const match of withoutShared(sheet).matchAll(/\.([A-Za-z0-9_-]{4,14})_[a-zA-Z]/gu)) {
      found.add(`${match[1]}_`);
    }
  }
  return found;
}

/** Host prefixes named by the pinned selector tables. */
function tablePrefixes(): Set<string> {
  const found = new Set<string>();
  for (const match of withoutShared(readFileSync(`${root}src/client/compat/host-dom.ts`, 'utf8'))
    .matchAll(/'\.([A-Za-z0-9_-]{4,14})_[^']*'/gu)) {
    found.add(`${match[1]}_`);
  }
  return found;
}

/** A document double carrying only what detection reads. */
function documentDouble(platform: string | undefined, frameClass?: string) {
  const frame = frameClass === undefined ? null : { className: frameClass };
  return {
    documentElement: { dataset: platform === undefined ? {} : { platform } },
    querySelector: (selector: string) => (selector === '[data-slot="root"] > div' ? frame : null),
  } as unknown as Document;
}

test('every host class the plugin names is aliased for the Windows build', () => {
  const known = new Set(Object.keys(WINDOWS_BUILD.prefixes));
  const named = [...cssPrefixes(), ...tablePrefixes()];
  assert.ok(named.length > 20, 'the scan found too few host classes to be meaningful');
  for (const prefix of named) assert.ok(known.has(prefix), `${prefix} has no Windows counterpart`);
});

test('no Windows entry is the identity rewrite', () => {
  for (const [authored, actual] of Object.entries(WINDOWS_BUILD.prefixes)) {
    assert.notEqual(authored, actual);
    assert.match(authored, /^[A-Za-z0-9_-]+_$/u);
    assert.match(actual, /^[A-Za-z0-9_-]+_$/u);
  }
});

test('aliasing carries the Windows build the classes read from its app.asar', () => {
  const css = aliasHostClasses(
    'html[data-dsh-ccd-style="true"] ._3WPZCG_root ._3WPZCG_newSession, ._6Qf49G_frame:before, .yhfFVG_card {}',
    WINDOWS_BUILD,
  );
  assert.ok(css.includes('.wtg9ga_root'));
  assert.ok(css.includes('.wtg9ga_newSession'));
  assert.ok(css.includes('.mP3x-q_frame:before'));
  assert.ok(css.includes('.GRgSLq_card'));
  assert.ok(!css.includes('_3WPZCG_'));
  /* Stable hooks and shared classes are never rewritten. */
  const stable = '[data-slot="root"] > div, [role="menu"], ._markdown_1ypvv_5';
  assert.equal(aliasHostClasses(stable, WINDOWS_BUILD), stable);
});

test('the authored build is the identity rewrite', () => {
  const css = 'html[data-dsh-ccd-style="true"] ._3WPZCG_root ._6Qf49G_frame {}';
  assert.equal(aliasHostClasses(css, PINNED_BUILD), css);
});

test('detection reads the frame first, then the preload platform', () => {
  assert.equal(detectHostBuild(documentDouble('win32')), WINDOWS_BUILD);
  assert.equal(detectHostBuild(documentDouble('darwin')), MACOS_BUILD);
  assert.equal(detectHostBuild(documentDouble(undefined)), PINNED_BUILD);
  assert.equal(detectHostBuild(documentDouble('darwin', 'mP3x-q_frame _6Qf49G_quietBars')), WINDOWS_BUILD);
  assert.equal(detectHostBuild(documentDouble('win32', '_6Qf49G_frame')), PINNED_BUILD);
});

test('an unregistered frame is the state the page and the log report', () => {
  /* No frame yet: the platform hint decides, and nothing is claimed. */
  assert.equal(hostBuildStatus(documentDouble('win32')).state, 'pending');
  assert.equal(hostBuildStatus(documentDouble('win32')).build, WINDOWS_BUILD);
  /* A frame this plugin knows. */
  assert.equal(hostBuildStatus(documentDouble('darwin', 'mP3x-q_frame')).state, 'identified');
  assert.equal(hostBuildStatus(documentDouble('darwin', 'mP3x-q_frame')).build, WINDOWS_BUILD);
  /* A frame from a build with class names this plugin has never seen. */
  const stranger = documentDouble('darwin', 'Qq9Zz0_frame');
  assert.equal(hostBuildStatus(stranger).state, 'unknown');
  assert.equal(hostBuildStatus(stranger).build, MACOS_BUILD);
  /* The state is re-read, so a later frame can still identify the build. */
  assert.equal(hostBuildStatus(stranger).state, 'unknown');
});

/** Observer double recording the callback and target so a test can fire it. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly callback: () => void;
  observed: unknown = null;
  disconnected = false;
  constructor(callback: () => void) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }
  observe(target: unknown): void { this.observed = target; }
  disconnect(): void { this.disconnected = true; }
}

test('the build is reported once the shell renders its frame, then the watch stops', () => {
  const scope = globalThis as { MutationObserver?: unknown };
  const original = scope.MutationObserver;
  FakeObserver.instances = [];
  scope.MutationObserver = FakeObserver;
  try {
    let frame: { className: string } | null = null;
    const document = {
      documentElement: { dataset: { platform: 'win32' } },
      querySelector: () => frame,
    } as unknown as Document;
    const seen: HostBuildStatus[] = [];
    const release = watchHostBuild(document, status => seen.push(status));

    /* Nothing is claimed before the frame exists. */
    assert.equal(seen.length, 0);
    assert.equal(FakeObserver.instances.length, 1);
    assert.notEqual(FakeObserver.instances[0]?.observed, null);

    frame = { className: 'Qq9Zz0_frame' };
    FakeObserver.instances[0]?.callback();
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.state, 'unknown');
    assert.equal(FakeObserver.instances[0]?.disconnected, true);

    /* A record delivered after the report cannot report twice. */
    FakeObserver.instances[0]?.callback();
    assert.equal(seen.length, 1);
    release();
  } finally {
    if (original === undefined) delete scope.MutationObserver;
    else scope.MutationObserver = original;
  }
});

test('a document whose frame is already known reports immediately', () => {
  const scope = globalThis as { MutationObserver?: unknown };
  const original = scope.MutationObserver;
  FakeObserver.instances = [];
  scope.MutationObserver = FakeObserver;
  try {
    const seen: HostBuildStatus[] = [];
    const release = watchHostBuild(documentDouble('darwin', 'mP3x-q_frame'), status => seen.push(status));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.state, 'identified');
    assert.equal(FakeObserver.instances.length, 0);
    release();
  } finally {
    if (original === undefined) delete scope.MutationObserver;
    else scope.MutationObserver = original;
  }
});

test('resolved tables speak the document build and keep the authored table intact', () => {
  const windows = hostSelectors(documentDouble('win32'));
  assert.equal(windows.frame, '.mP3x-q_frame');
  assert.equal(windows.sidebarNewSession, '.wtg9ga_newSession');
  assert.equal(hostAnchors(documentDouble('win32')).composerCardHero, '.an3WzG_root[data-phase="hero"] [data-composer-card]');

  const pinned = hostSelectors(documentDouble('darwin', PINNED_BUILD.frameClass));
  assert.equal(pinned.frame, '._6Qf49G_frame');
  assert.equal(hostAnchors(documentDouble('darwin', PINNED_BUILD.frameClass)).composerCardHero, '.ST7X_W_root[data-phase="hero"] [data-composer-card]');

  /* A resolved table is a copy: the authored one keeps the authored names. */
  assert.equal(hostSelectors(documentDouble(undefined)).frame, '._6Qf49G_frame');
});

test('verified builds are declared once, with the authored one first', () => {
  assert.equal(HOST_BUILDS[0], PINNED_BUILD);
  assert.equal(HOST_BUILDS.length, 4);
  assert.equal(new Set(HOST_BUILDS.map(build => build.id)).size, HOST_BUILDS.length, 'platform builds need distinct selector cache keys');
  assert.equal(PINNED_BUILD.frameClass, '_6Qf49G_frame');
  assert.equal(WINDOWS_BUILD.frameClass, 'mP3x-q_frame');
});

test('the current macOS release resolves every authored module before and after the frame mounts', () => {
  for (const prefix of [...cssPrefixes(), ...tablePrefixes()]) {
    assert.ok(Object.hasOwn(MACOS_BUILD.prefixes, prefix), prefix + ' has no current macOS counterpart');
  }
  const pending = documentDouble('darwin');
  const rendered = documentDouble('darwin', 'PIRFFq_frame');
  assert.equal(hostBuildStatus(pending).state, 'pending');
  assert.equal(hostBuildStatus(rendered).state, 'identified');
  for (const document of [pending, rendered]) {
    assert.equal(detectHostBuild(document), MACOS_BUILD);
    assert.equal(hostSelectors(document).frame, '.PIRFFq_frame');
    assert.equal(hostSelectors(document).sidebarNewSession, '.kB3qhq_newSession');
    assert.equal(hostAnchors(document).composerCardHero, '.kiGsTW_root[data-phase="hero"] [data-composer-card]');
    assert.equal(aliasHostClasses('._6Qf49G_frame .yhfFVG_card', detectHostBuild(document)), '.PIRFFq_frame .JZLxKW_card');
  }
});


test('Windows rc.3 resolves every authored module before and after the frame mounts', () => {
  for (const prefix of [...cssPrefixes(), ...tablePrefixes()]) {
    assert.ok(Object.hasOwn(WINDOWS_BUILD.prefixes, prefix), prefix + ' has no current Windows counterpart');
  }
  assert.equal(WINDOWS_BUILD.id, 'dsh-0.2.1-rc.3-be72761e-win32');
  const pending = documentDouble('win32');
  const rendered = documentDouble('win32', 'mP3x-q_frame');
  assert.equal(hostBuildStatus(pending).state, 'pending');
  assert.equal(hostBuildStatus(rendered).state, 'identified');
  for (const document of [pending, rendered]) {
    assert.equal(detectHostBuild(document), WINDOWS_BUILD);
    assert.equal(hostSelectors(document).frame, '.mP3x-q_frame');
    assert.equal(hostSelectors(document).sidebarNewSession, '.wtg9ga_newSession');
    assert.equal(hostAnchors(document).composerCardHero, '.an3WzG_root[data-phase="hero"] [data-composer-card]');
    assert.equal(aliasHostClasses('._6Qf49G_frame .yhfFVG_card', detectHostBuild(document)), '.mP3x-q_frame .GRgSLq_card');
  }
  // Resolving Windows must not reuse the current macOS build's cached selectors.
  assert.equal(hostSelectors(documentDouble('darwin', MACOS_BUILD.frameClass)).frame, '.PIRFFq_frame');
});

test('the registered Windows rc.2 frame retains its original mapping', () => {
  const document = documentDouble('win32', 'BynINW_frame');
  assert.equal(hostBuildStatus(document).state, 'identified');
  assert.equal(detectHostBuild(document), WINDOWS_LEGACY_BUILD);
  assert.equal(hostSelectors(document).frame, '.BynINW_frame');
  assert.equal(hostSelectors(document).sidebarNewSession, '._2H3hWW_newSession');
});
