/**
 * Headless Chrome plumbing shared by the README asset scripts.
 *
 * `pet-gifs.mjs` and `effort-gif.mjs` both drive real client code in a real
 * browser and screenshot the stills, so both need the same three pieces:
 * locating a Chrome binary, a DevTools protocol client, and a launch/teardown
 * wrapper that loads one page. Chrome is reached over the DevTools protocol
 * with Node's built-in WebSocket and its target list with the built-in
 * `fetch`, so the only external tool either script needs is Chrome itself.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const chromeCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

/** Absolute path to an installed Chrome, or a throw naming the override to set. */
export function findChrome() {
  if (process.env.CHROME) {
    if (!existsSync(process.env.CHROME)) throw new Error(`CHROME executable not found: ${process.env.CHROME}`);
    return process.env.CHROME;
  }
  const testingCandidates = [];
  if (process.platform === 'darwin') {
    const platform = process.arch === 'arm64' ? 'mac_arm' : 'mac';
    const archive = process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
    for (const product of ['chrome-headless-shell', 'chrome']) {
      const cache = join(homedir(), '.cache/chrome-for-testing', product);
      if (!existsSync(cache)) continue;
      const versions = readdirSync(cache).filter(name => name.startsWith(`${platform}-`))
        .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
      for (const version of versions) {
        testingCandidates.push(join(cache, version, `${product}-${archive}`, product === 'chrome'
          ? 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
          : 'chrome-headless-shell'));
      }
    }
    const playwright = join(homedir(), 'Library/Caches/ms-playwright');
    if (existsSync(playwright)) {
      const revisions = readdirSync(playwright).filter(name => /^chromium-\d+$/u.test(name))
        .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
      for (const revision of revisions) {
        testingCandidates.push(join(playwright, revision, `chrome-${archive}`,
          'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'));
      }
    }
  }
  const found = [...testingCandidates, ...chromeCandidates].find(candidate => existsSync(candidate));
  if (!found) throw new Error('Chrome not found; set CHROME to its executable');
  return found;
}

/** Runs a command, resolving with its output and rejecting on a non-zero exit. */
export function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}\n${stderr}`)));
  });
}

/** A DevTools protocol client over one target socket. */
export class Devtools {
  static async open(port) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json()).catch(() => null);
      const page = targets?.find(target => target.type === 'page');
      if (page) return new Devtools(page.webSocketDebuggerUrl);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Chrome never exposed a page target');
  }

  constructor(url, { timeoutMs = 0 } = {}) {
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.events = new Map();
    this.next = 1;
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve);
      this.socket.addEventListener('error', reject);
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id === undefined) {
        this.events.get(message.method)?.forEach(listener => listener(message.params));
        return;
      }
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
      else entry.resolve(message.result);
    });
    this.socket.addEventListener('close', () => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error(`${entry.method}: DevTools connection closed`));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = this.next;
    this.next += 1;
    return new Promise((resolve, reject) => {
      const timer = this.timeoutMs ? setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: DevTools command timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs) : undefined;
      this.pending.set(id, { resolve, reject, method, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method) {
    return new Promise(resolve => {
      const listeners = this.events.get(method) ?? [];
      const listener = params => {
        this.events.set(method, listeners.filter(entry => entry !== listener));
        resolve(params);
      };
      this.events.set(method, [...listeners, listener]);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return result.result.value;
  }

  close() { this.socket.close(); }
}

/**
 * Launches headless Chrome on one page, hands the open socket to `callback`,
 * and tears the browser down afterwards.
 *
 * The metrics override pins the viewport to the captured box, so a capture is
 * the same image whatever display and window the script runs on. `scale` is
 * both the page's device pixel ratio and the multiplier a capture applies to
 * its clip, which is how a mark drawn in CSS pixels becomes a still at the
 * device resolution the GIF is worth reading at.
 *
 * @param options - `url` to load, viewport `width`/`height` in CSS pixels,
 *   device pixel `scale`, whether to keep the page background transparent, and
 *   the Chrome profile directory to isolate the run in.
 * @param callback - receives the connected `Devtools`.
 * @returns whatever `callback` returns.
 */
export async function withPage({ url, width, height, scale = 1, transparent = false, hideScrollbars = true, profile }, callback) {
  // Chrome chooses an unused port. PID-modulo ports can collide with a live
  // DSH renderer or another browser test and attach to the wrong page.
  const portFile = join(profile, 'DevToolsActivePort');
  await rm(portFile, { force: true });
  const child = spawn(findChrome(), [
    '--headless=new',
    '--disable-gpu',
    ...(hideScrollbars ? ['--hide-scrollbars'] : []),
    '--no-first-run',
    '--no-default-browser-check',
    '--allow-file-access-from-files',
    `--force-device-scale-factor=${scale}`,
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    `--window-size=${width},${height}`,
    'about:blank',
  ], { stdio: 'ignore' });
  try {
    let port = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await readFile(portFile, 'utf8').catch(() => '');
      port = Number.parseInt(value, 10);
      if (Number.isFinite(port) && port > 0) break;
      if (child.exitCode !== null) throw new Error(`Chrome exited before exposing DevTools (${child.exitCode})`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!Number.isFinite(port) || port <= 0) throw new Error('Chrome did not publish its DevTools port');
    const devtools = await Devtools.open(port);
    await devtools.ready;
    try {
      await devtools.send('Page.enable');
      await devtools.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
      if (transparent) await devtools.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      const loaded = devtools.once('Page.loadEventFired');
      await devtools.send('Page.navigate', { url });
      await loaded;
      // Opt-in diagnostic sampling also works with existing browser fixtures.
      // Ordinary tests and asset generation keep their original execution path.
      const recording = process.env.CCD_PERF_DIR
        ? await (await import('./page-performance.mjs')).recordPage(devtools, { width, height, scale })
        : null;
      let failure;
      try {
        return await callback(devtools);
      } catch (error) {
        failure = String(error);
        throw error;
      } finally {
        await recording?.finish(failure);
      }
    } finally {
      devtools.close();
    }
  } finally {
    child.kill();
  }
}
