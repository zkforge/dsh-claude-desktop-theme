import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { FEATURE_IDS } from '../src/shared/config.ts';
import { PLUGIN_ID, TARGET_DSH_VERSION } from '../src/shared/identity.ts';
import { ANCHOR } from '../src/client/compat/host-dom.ts';
import { BASELINE_MODULES } from './lib/platform.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
assert.equal(pkg.name, PLUGIN_ID);
assert.equal(pkg.dsh.engines.dsh, `=${TARGET_DSH_VERSION}`);
for (const [name, version] of Object.entries(pkg.devDependencies)) {
  if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, TARGET_DSH_VERSION);
}
const browser = await readFile(join(root, 'lib/client.js'), 'utf8');
let registration;
/* Resource bookkeeping: every compat observer and window listener a module
   opens must be closed again by teardown. */
let observersOpened = 0;
let observersClosed = 0;
let listenersOpened = 0;
let listenersClosed = 0;
let documentListenersOpened = 0;
let documentListenersClosed = 0;
const sandbox = {
  window: {
    __ModuleLoader__: { load(row) { assert.equal(registration, undefined); registration = row; } },
    addEventListener() { listenersOpened += 1; },
    removeEventListener() { listenersClosed += 1; },
  },
  console,
};
runInNewContext(browser, sandbox);
assert.equal(registration.id, pkg.name);
const require = createRequire(import.meta.url);
const client = registration.factory(id => {
  assert.ok(BASELINE_MODULES.includes(id), `Unexpected module-table request: ${id}`);
  return require(id);
});
assert.deepEqual(Object.keys(client).sort(), ['apply', 'inject']);
assert.equal(typeof client.apply, 'function');
client.apply(new Proxy({}, { get() { throw new Error('Disabled plugin accessed a Host service'); } }));
// Exercise the actual bundled entry against a narrow DOM/service fixture.
// This proves activation ownership and the settings-transport contract, not the
// Desktop renderer or its settings UI.
const attributes = new Map();
const styles = new Set();
class FakeObserver {
  constructor() { observersOpened += 1; }
  observe() {}
  disconnect() { observersClosed += 1; }
}
sandbox.MutationObserver = FakeObserver;
sandbox.ResizeObserver = FakeObserver;
sandbox.requestAnimationFrame = callback => setTimeout(callback, 0);
sandbox.cancelAnimationFrame = handle => clearTimeout(handle);
sandbox.getComputedStyle = () => ({ position: 'static', gridTemplateColumns: '' });
/* The blank-session Composer card the whale is measured from; a plain box, so
   the anchor's read-and-publish path runs against something shaped like the
   host's card rather than against nothing. */
let heroCard = null;
/** One keyed Session row of the Workspace browser, as the sidebar tags it. */
function fakeSessionRow(key) {
  const rowAttributes = new Map([['data-row-key', key]]);
  return {
    isConnected: true,
    getAttribute: name => rowAttributes.get(name) ?? null,
    setAttribute: (name, value) => rowAttributes.set(name, value),
    hasAttribute: name => rowAttributes.has(name),
    removeAttribute: name => rowAttributes.delete(name),
  };
}
const [chatRow, blankRow] = [fakeSessionRow('session:session-1'), fakeSessionRow('session:session-2')];
sandbox.document = {
  documentElement: {
    getAttribute: key => attributes.get(key) ?? null,
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: key => attributes.delete(key),
  },
  body: {},
  hidden: false,
  querySelector: selector => (selector === ANCHOR.composerCardHero ? heroCard : null),
  querySelectorAll: selector => (selector === ANCHOR.sessionRows ? [chatRow, blankRow] : []),
  addEventListener() { documentListenersOpened += 1; },
  removeEventListener() { documentListenersClosed += 1; },
  createElement: () => {
    const style = { dataset: {}, textContent: '', remove: () => styles.delete(style) };
    return style;
  },
  head: { appendChild: style => styles.add(style) },
};
heroCard = {
  getBoundingClientRect: () => ({ top: 500, right: 800, width: 770, height: 120 }),
  querySelector: () => null,
};
/** Minimal settings transport: one section, one subscriber list. */
function createConfigForms(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    published: next => { value = next; for (const listener of [...listeners]) listener(); },
    get(namespace) {
      assert.equal(namespace, 'ui-skin-ccd-style');
      return {
        getSnapshot: () => ({ status: 'ready', value, writable: true }),
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        set(field, next) { value = { ...value, [field]: next }; return true; },
      };
    },
  };
}
let teardown;
let paletteLayers = 0;
const modelSeats = new Set();
const headerViews = new Set();
/** The corner cell's retirement entry: it renders nothing and takes the seat. */
const cornerSeats = new Set();
/** The Composer whale's overlay seat, and the scope that owns it. */
const blankPetSeats = new Set();
/** The sidebar's view-options card: its own overlay seat, with the driver. */
const viewOptionsSeats = new Set();
/** The row configuration page and its dictionary outlive the activation scope. */
const rowConfigPages = new Set();
const dictionaries = [];
let modelScopes = 0;
let headerScopes = 0;
let petScopes = 0;
let settingsScopes = 0;
const openedKinds = [];
const focusedTabs = [];
const sidebarTabs = [];
/** Right-Sidebar faces the client half injects; the header views live on them. */
const sidebarRight = {
  openTab(kind) { openedKinds.push(kind); },
  focus(tabId) { focusedTabs.push(tabId); },
  openTabs: { getSnapshot: () => sidebarTabs },
};
const sidebarRightTabs = {
  kinds: new Set(['terminal', 'browser', 'files']),
  listeners: new Set(),
  get(kind) { return this.kinds.has(kind) ? { kind } : undefined; },
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); },
  refresh() { for (const listener of [...this.listeners]) listener(); },
};
const slots = {
  inject(name, register) {
    assert.ok([
      'conversation.input.model',
      'conversation.session.header.utilities',
      'conversation.session.header.corner',
      'shell.overlay',
      'plugins.row.config',
    ].includes(name), `unexpected slot: ${name}`);
    return register();
  },
  register(options) {
    if (options.name === 'plugins.row.config') {
      assert.equal(options.key, `${PLUGIN_ID}#ui-skin-ccd-style`);
      assert.equal(options.locale, 'ccdSettings');
      rowConfigPages.add(options);
      return () => rowConfigPages.delete(options);
    }
    if (options.name === 'conversation.input.model') {
      assert.equal(options.priority, -10);
      modelSeats.add(options);
      return () => modelSeats.delete(options);
    }
    if (options.name === 'shell.overlay') {
      // Two occupants, told apart by their ids: the whale, whose anchor is also
      // what keeps it off every conversation, and the sidebar's view-options
      // card, which hangs from the host's own trigger.
      assert.equal(typeof options.inject, 'function');
      if (options.id === 'ccd-view-options') {
        viewOptionsSeats.add(options);
        return () => viewOptionsSeats.delete(options);
      }
      assert.equal(options.id, 'ccd-blank-pet');
      blankPetSeats.add(options);
      return () => blankPetSeats.delete(options);
    }
    if (options.name === 'conversation.session.header.corner') {
      // The corner is a single cell whose shipped occupant is the panel's own
      // expand control: this registration takes it by sitting below that
      // occupant's rank, and its component renders nothing (see `cornerSeats`).
      assert.equal(options.priority, -10);
      assert.equal('id' in options, false);
      cornerSeats.add(options);
      return () => cornerSeats.delete(options);
    }
    assert.equal(options.name, 'conversation.session.header.utilities');
    // The project folder leads the row, below every native seat (the retired
    // open-in-app control at -10 and scheduled tasks at -5); the terminal and
    // browser views then sit ahead of the native session menu at 0.
    assert.ok(options.order < 0, `header view order: ${options.order}`);
    assert.equal(typeof options.inject, 'function');
    headerViews.add(options);
    return () => headerViews.delete(options);
  },
};
/** The browser's session list store: the whale's running flag and the sidebar's
    provisional-row filter both read this one host fact. */
const sessionRows = { 'session-1': { running: true }, 'session-2': { blank: true } };
const sessionListeners = new Set();
const sessions = {
  list: {
    getSnapshot: () => ({ ids: ['session-1', 'session-2'], byId: sessionRows }),
    subscribe(listener) { sessionListeners.add(listener); return () => sessionListeners.delete(listener); },
  },
};
const disabled = { enabled: false, features: Object.fromEntries(FEATURE_IDS.map(id => [id, false])) };
/** Locale face the configuration page's copy registers into. */
const locale = {
  register(namespace, dicts) {
    assert.equal(namespace, 'ccdSettings');
    assert.deepEqual(Object.keys(dicts).sort(), ['en', 'zh']);
    dictionaries.push(namespace);
    return () => { dictionaries.splice(dictionaries.indexOf(namespace), 1); };
  },
};
/* The injected child scope owns the page's effects, exactly as the Cordis fiber
   does: disposing the injection releases the dictionary it registered. */
const settingsEffects = [];
const settingsScope = {
  slots,
  locale,
  effect(callback) {
    const released = callback();
    const release = typeof released === 'function' ? released : () => {};
    settingsEffects.push(release);
    return () => {
      const index = settingsEffects.indexOf(release);
      if (index >= 0) settingsEffects.splice(index, 1);
      release();
    };
  },
};
const configForms = createConfigForms(disabled);
/** The services the loader hands this entry: exactly the ones `inject` names. */
const declaredServices = new Set(client.inject);
const rootServices = {
  slots,
  theme: { overrideTokens() { paletteLayers++; return () => { paletteLayers--; }; } },
  uiWorkspace: { startSession() {} },
  configForms,
  sessions,
  workspaces: {
    list: {
      getSnapshot: () => ({ phase: 'ready', items: [], archivedSessionIds: [] }),
      subscribe: () => () => {},
    },
  },
};
/** One child injection, with the scope the real Cordis fiber would expose. */
function injectService(dependencies, mount) {
  const names = Array.from(dependencies).join(',');
  let release;
  let scope;
  if (names === 'slots,sidebarRight,sidebarRightTabs') {
    scope = 'header';
    release = mount({ slots, sidebarRight, sidebarRightTabs });
    headerScopes += 1;
  } else if (names === 'modelDirectories,sessions,slots,remote,remote.session') {
    scope = 'model';
    release = mount({ slots });
    modelScopes += 1;
  } else if (names === 'slots') {
    scope = 'pet';
    release = mount({ slots });
    petScopes += 1;
  } else {
    assert.equal(names, 'slots,locale', 'unexpected injection');
    scope = 'settings';
    release = mount(settingsScope);
    settingsScopes += 1;
  }
  let disposed = false;
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      release();
      if (scope === 'header') headerScopes -= 1;
      else if (scope === 'model') modelScopes -= 1;
      else if (scope === 'pet') petScopes -= 1;
      else {
        settingsScopes -= 1;
        for (const effect of settingsEffects.splice(0).reverse()) effect();
      }
    },
  };
}
/*
 * Cordis refuses to resolve a service the entry did not declare — reading it
 * throws `cannot get property "<name>" without inject`, and because that read
 * happens while the plugin is being assembled, the throw takes the whole entry
 * down instead of one feature. The fixture therefore resolves services the same
 * way: only names declared in the bundle's own `inject` are readable, and
 * anything else fails loudly here rather than silently in the application.
 */
const rootCtx = new Proxy(rootServices, {
  get(target, property, receiver) {
    if (property === 'inject') return injectService;
    if (property === 'effect') return execute => { teardown = execute(); };
    if (typeof property !== 'string' || !(property in target)) {
      throw new Error(`the plugin read an unknown context property: ${String(property)}`);
    }
    assert.ok(declaredServices.has(property),
      `the plugin reads ctx.${property} but does not declare it in inject`);
    return Reflect.get(target, property, receiver);
  },
});
client.apply(rootCtx);
assert.equal(attributes.has('data-dsh-ccd-style'), false, 'a disabled section must not restyle the interface');
/* Only the configuration page is mounted while the interface is off: it is how
   the interface gets switched back on from inside the app. */
assert.equal(styles.size, 1);
assert.equal(rowConfigPages.size, 1, 'the configuration page must survive being disabled');
assert.deepEqual(dictionaries, ['ccdSettings']);
assert.equal(settingsScopes, 1);
// Re-enabling through the settings transport activates without a reload.
configForms.published({ ...disabled, enabled: true });
assert.equal(attributes.get('data-dsh-ccd-style'), 'true');
// Design variables, the shared composer geometry, the host popup chrome, and the page stylesheet.
assert.equal(styles.size, 4);
assert.equal(paletteLayers, 1);
// Exercise the actual bundled model-seat registration and its cleanup scope.
configForms.published({ ...disabled, enabled: true, features: { ...disabled.features, conversation: true } });
assert.equal(modelSeats.size, 1);
assert.equal(modelScopes, 1);
assert.equal(headerViews.size, 3);
assert.equal(cornerSeats.size, 1);
assert.equal(headerScopes, 1);
assert.equal(styles.size, 8); // page + theme + Composer + menus + model controls + effort + conversation + header actions
/* The whale has its own switch, so the conversation feature alone mounts none. */
assert.equal(blankPetSeats.size, 0);
assert.equal(petScopes, 0);
/* The project folder is the cluster's first entry, and the three added views
   open their right-panel kind — focusing the Session's existing tab of that
   kind instead of stacking a second one. */
assert.deepEqual([...headerViews].map(view => view.id), ['ccd-folder', 'ccd-terminal', 'ccd-browser']);
const folderView = [...headerViews][0];
assert.equal(folderView.inject('session-1').kind, 'files');
folderView.inject('session-1').open();
assert.deepEqual(openedKinds, ['files']);
openedKinds.length = 0;
const terminalView = [...headerViews].find(view => view.id === 'ccd-terminal');
assert.equal(terminalView.inject('session-1').kind, 'terminal');
terminalView.inject('session-1').open();
assert.deepEqual(openedKinds, ['terminal']);
sidebarTabs.push({ sessionId: 'session-1', tabId: 'tab7', kind: 'terminal' });
terminalView.inject('session-1').open();
assert.deepEqual(focusedTabs, ['tab7']);
/* A build without a panel kind keeps no button for it, and recovers when the
   kind registers again — the registry's own signal drives both. */
sidebarRightTabs.kinds.delete('files');
sidebarRightTabs.kinds.delete('browser');
sidebarRightTabs.refresh();
assert.deepEqual([...headerViews].map(view => view.id), ['ccd-terminal']);
sidebarRightTabs.kinds.add('files');
sidebarRightTabs.kinds.add('browser');
sidebarRightTabs.refresh();
assert.equal(headerViews.size, 3);
// Repeated unchanged configuration must not register a duplicate seat.
configForms.published({ ...disabled, enabled: true, features: { ...disabled.features, conversation: true } });
assert.equal(modelSeats.size, 1);
assert.equal(headerViews.size, 3);
/* The Composer whale: one switch, one overlay seat, on the new-session page
   only. The seat belongs to that page's own layout, so it arrives with
   `new-session` — and the compat anchor measures the card under
   `data-phase="hero"` instead of assuming it, which is also what keeps the pet
   out of every conversation. */
configForms.published({
  ...disabled,
  enabled: true,
  features: { ...disabled.features, conversation: true, 'new-session': true, 'composer-pet': true },
});
assert.equal(blankPetSeats.size, 1);
assert.equal(petScopes, 1);
// page + theme + Composer + menus + model controls + effort + conversation + header actions + new session + pet
assert.equal(styles.size, 10);
const petFace = [...blankPetSeats][0].inject();
// The pet is decoration: the seat injects the measured corner and nothing else
// — no session, no reaction state, no timer, no copy.
assert.deepEqual(Object.keys(petFace), ['useAnchor']);
assert.equal(typeof petFace.useAnchor, 'function');
assert.ok(documentListenersOpened > 0, 'the frame-wide seat must observe the card');
/* The provisional New Session row: the column keeps the host's blank Session
   out of the list and leaves the real rows alone; the tag is a resource of the
   sidebar scope, so disabling the interface takes it back off the row. */
const beforeSidebarStyles = styles.size;
configForms.published({ ...disabled, enabled: true, features: { ...disabled.features, sidebar: true } });
assert.equal(blankRow.getAttribute('data-ccd-blank-session'), '', 'the blank Session row must be tagged');
assert.equal(chatRow.getAttribute('data-ccd-blank-session'), null, 'a real Session row stays in the list');
/* The sidebar feature mounts its column stylesheet, the account-menu sheet and
   the view-options card's own. */
assert.equal(styles.size, 7);
assert.equal(viewOptionsSeats.size, 1, 'the sidebar draws the view-options card');
assert.deepEqual(
  Object.keys([...viewOptionsSeats][0].inject()).sort(),
  ['port', 'setShowEmptyGroups', 'showEmptyGroups'],
  'the seat injects the driver, the switch and its writer',
);
assert.equal([...viewOptionsSeats][0].inject().showEmptyGroups, false, 'the switch defaults off');
assert.ok(beforeSidebarStyles > styles.size, 'the previous feature scope was released first');
configForms.published({ ...disabled, enabled: true });
assert.equal(blankRow.getAttribute('data-ccd-blank-session'), null, 'disabling releases the tag');
// Disabling again releases every owned resource.
configForms.published(disabled);
assert.equal(attributes.has('data-dsh-ccd-style'), false);
assert.equal(styles.size, 1, 'the page stylesheet stays while the interface is off');
assert.equal(paletteLayers, 0);
assert.equal(modelSeats.size, 0);
assert.equal(modelScopes, 0);
assert.equal(headerViews.size, 0);
assert.equal(cornerSeats.size, 0);
assert.equal(headerScopes, 0);
assert.equal(blankPetSeats.size, 0);
assert.equal(petScopes, 0);
assert.equal(rowConfigPages.size, 1);
assert.equal(settingsScopes, 1);
configForms.published({ ...disabled, enabled: true });
assert.equal(typeof teardown, 'function');
teardown();
teardown();
assert.equal(attributes.has('data-dsh-ccd-style'), false);
assert.equal(styles.size, 0);
assert.equal(paletteLayers, 0);
assert.equal(rowConfigPages.size, 0, 'teardown releases the configuration page');
assert.equal(settingsScopes, 0);
assert.deepEqual(dictionaries, []);
/* The compat observers and listeners are resources like any other: none may
   outlive teardown. */
assert.ok(observersOpened > 0, 'the compat layer must observe the host DOM');
assert.equal(observersClosed, observersOpened);
assert.ok(listenersOpened > 0, 'the compat layer must own its window listeners');
assert.equal(listenersClosed, listenersOpened);
assert.ok(documentListenersOpened > 0, 'the compat layer must own its document listeners');
assert.equal(documentListenersClosed, documentListenersOpened);
const host = await import(pathToFileURL(join(root, 'lib/index.js')).href);
assert.equal(typeof host.apply, 'function');
assert.ok(host.Config);

const result = spawnSync('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], {
  cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_cache: join(root, '.cache/npm') },
});
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr);
const packed = JSON.parse(result.stdout)[0].files.map(file => file.path);
for (const file of ['lib/index.js', 'lib/client.js', 'lib/types/host/index.d.ts', 'cordis.patch.yml', 'README.md', 'LICENSE']) {
  assert.ok(packed.includes(file), `Missing package file: ${file}`);
}
assert.ok(packed.every(file => /^(lib\/|cordis\.patch\.yml$|README\.md$|LICENSE$|package\.json$)/.test(file)),
  'Unexpected source, screenshot, cache, or development asset in package');
console.log(`DSH loader envelope, activation cleanup fixture, Host entry, and ${packed.length} package files passed.`);
