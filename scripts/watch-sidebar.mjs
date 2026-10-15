/*
 * Live watcher for the right-sidebar crash behind "a file link does nothing".
 *
 * The plugin drives the host's right column (float/dock/openTab/toggle) and the
 * host's `rightbar.session` seat can crash with
 *
 *   Error: sidebarRight: tab "<id>" has no committed occurrence in session "<id>"
 *       at TabDomain.occurrence (...)
 *
 * after which the panel element is gone, every `openResource`/`openTab` is a
 * silent no-op and the column cannot be reopened until the app restarts. This
 * script attaches to the running desktop app's DevTools port, records every
 * console error with its stack, and samples the sidebar state whenever it
 * changes, so the action that precedes the crash can be read afterwards.
 *
 * Usage:
 *   node scripts/watch-sidebar.mjs   # against an app launched with --remote-debugging-port
 *   ... reproduce the broken link click ...
 *   # read /tmp/dsh-sidebar-watch.log
 */
import { appendFileSync } from 'node:fs';
import { Devtools } from './lib/headless-chrome.mjs';

const LOG = process.env.DSH_SIDEBAR_WATCH_LOG ?? '/tmp/dsh-sidebar-watch.log';
const MINUTES = Number(process.env.DSH_SIDEBAR_WATCH_MINUTES ?? 180);
const write = line => {
  const stamp = new Date().toISOString().slice(11, 23);
  appendFileSync(LOG, `${stamp} ${line}\n`);
  process.stdout.write(`${stamp} ${line}\n`);
};

/** One line of state: what the plugin/host currently draw for the right column. */
const SAMPLE = `JSON.stringify((function(){
  var panel = document.querySelector('[data-sidebar-right-panel]');
  var collapsed = document.querySelector('[data-slot="root"] > div[data-rightbar-collapsed]') !== null;
  return {
    session: (document.querySelector('[data-conversation-session]') || { getAttribute: function(){ return null; } }).getAttribute('data-conversation-session'),
    panel: panel !== null,
    open: panel ? panel.hasAttribute('data-sidebar-right-open') : null,
    collapsed: collapsed,
    tabs: document.querySelectorAll('[data-dockkit-content]').length,
    panes: document.querySelectorAll('[data-ccd-pane]').length,
    kinds: [].slice.call(document.querySelectorAll('[data-ccd-pane]')).map(function(p){ return p.getAttribute('data-ccd-pane-kind') + (p.hasAttribute('data-ccd-pane-inactive') ? '!' : ''); }).join(',')
  };
})())`;

const devtools = await Devtools.open(Number(process.env.DSH_DEBUG_PORT ?? 9333));
await devtools.ready;
write(`watching (port ${process.env.DSH_DEBUG_PORT ?? 9333}); log ${LOG}`);

let last = '';
let sampling = false;
const sample = async reason => {
  if (sampling) return;
  sampling = true;
  try {
    const state = await devtools.evaluate(SAMPLE);
    if (state !== last) {
      last = state;
      write(`state (${reason}) ${state}`);
    }
  } catch (error) {
    write(`sample failed: ${String(error).slice(0, 200)}`);
  } finally {
    sampling = false;
  }
};

const text = args => (args ?? []).map(a => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ');

devtools.events.set('Runtime.consoleAPICalled', [event => {
  if (event.type !== 'error' && event.type !== 'warning') return;
  write(`console.${event.type}: ${text(event.args).replace(/\s+/gu, ' ').slice(0, 1200)}`);
  void sample('after console error');
}]);
devtools.events.set('Runtime.exceptionThrown', [event => {
  const details = event.exceptionDetails ?? {};
  write(`exception: ${String(details.exception?.description ?? details.text ?? '').replace(/\s+/gu, ' ').slice(0, 1200)}`);
  void sample('after exception');
}]);
devtools.events.set('Log.entryAdded', [event => {
  const entry = event.entry ?? {};
  if (entry.level !== 'error') return;
  write(`log.${entry.level}: ${String(entry.text).replace(/\s+/gu, ' ').slice(0, 400)}`);
}]);
await devtools.send('Runtime.enable');
await devtools.send('Log.enable');
await sample('start');

/* Also sample periodically: a crash without a console error still changes the DOM. */
const timer = setInterval(() => { void sample('tick'); }, 3000);

const stop = () => {
  clearInterval(timer);
  write('watcher stopped');
  devtools.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setTimeout(stop, MINUTES * 60 * 1000);
