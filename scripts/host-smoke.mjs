#!/usr/bin/env node
/** Real packaged macOS Desktop + installed tarball, with disposable DSH/Electron state.
 * No DOM fixtures, module injection, account credentials or model requests.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Devtools } from './lib/headless-chrome.mjs';
import { readAsar, asarBuildIdentity } from './lib/host-prefixes.mjs';

const { values } = parseArgs({ options: {
  app: { type: 'string', default: process.env.DSH_CCD_APP ?? '/Applications/DeepSeek Harness.app' },
  tarball: { type: 'string' },
  output: { type: 'string', default: 'artifacts/host-smoke' },
  'fail-after': { type: 'string' },
} });
assert.equal(process.platform, 'darwin', 'This runner currently verifies the real macOS Desktop only');
assert.ok(values.tarball, 'Usage: npm run test:host -- --tarball <packed .tgz> [--app <DSH.app>]');
const steps = ['native-baseline', 'shell', 'sidebar-visual', 'composer', 'permission', 'model-menu', 'navigation', 'disable-enable', 'restart', 'runtime-errors'];
assert.ok(!values['fail-after'] || steps.includes(values['fail-after']), 'Unknown --fail-after step');
const app = resolve(values.app);
const source = resolve(values.tarball);
const bytes = await readFile(source);
const asar = join(app, 'Contents/Resources/app.asar');
const host = asarBuildIdentity(readAsar(asar, p => p === 'package.json' || p === 'dsh/package.json'));
await mkdir(resolve(values.output), { recursive: true });
const directory = await mkdtemp(join(resolve(values.output), 'run-'));
const evidence = join(directory, 'evidence');
const userData = join(directory, 'electron');
const dshHome = join(directory, 'dsh-home');
const workspace = join(directory, 'workspace');
await Promise.all([evidence, userData, workspace].map(path => mkdir(path, { recursive: true })));
const tarball = join(directory, basename(source));
await copyFile(source, tarball);
await writeFile(join(workspace, 'demo.txt'), 'DSH host smoke demonstration workspace.\n');
const env = { ...process.env, DSH_HOME: dshHome };
delete env.ELECTRON_RUN_AS_NODE;
const report = {
  status: 'running', host, platform: process.platform, arch: process.arch,
  tarball: basename(tarball), sha256: createHash('sha256').update(bytes).digest('hex'),
  startedAt: new Date().toISOString(), steps: [],
  coverage: ['packaged Desktop startup', 'installed plugin', 'composer draft', 'permission change',
    'empty model directory', 'native page navigation', 'disable/enable', 'restart persistence'],
  excluded: ['model inference/streaming', 'tool execution', 'Windows', 'file preview', 'clear/replay'],
};
let child, page, port, stage = 'initialize';
const consoleEvents = [], exceptions = [];
let hostLog = '';
const redact = text => String(text)
  .replace(/([?&]token=)[^\s"'<>\\]+/gu, '$1<REDACTED>')
  .replace(/(Bearer\s+)[\w.-]+/giu, '$1<REDACTED>')
  .replaceAll(homedir(), '<USER_HOME>');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error(`Desktop exited (${child.exitCode ?? child.signalCode}): ${description}`);
    await pause(100);
  }
  throw new Error(`Timed out: ${description}`);
}

async function start() {
  await rm(join(userData, 'DevToolsActivePort'), { force: true });
  child = spawn(join(app, 'Contents/MacOS/DeepSeek Harness'), [
    `--user-data-dir=${userData}`, '--remote-debugging-port=0',
  ], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', error => { hostLog += `${error.stack}\n`; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => {
    hostLog += data;
    appendFileSync(join(evidence, 'host.log'), redact(data));
  });
  await waitFor(async () => {
    const text = await readFile(join(userData, 'DevToolsActivePort'), 'utf8').catch(() => '');
    port = Number.parseInt(text, 10);
    return Number.isInteger(port) && port > 0;
  }, 'Desktop publishes DevTools port', 30000);
}

async function stop() {
  page?.close(); page = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const killTimer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try { await exited; } finally { clearTimeout(killTimer); }
}

async function connectMain() {
  await waitFor(async () => {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
    const main = targets.find(t => t.type === 'page' && t.url.startsWith('dsh-app://app'));
    if (main) {
      page = new Devtools(main.webSocketDebuggerUrl, { timeoutMs: 10000 });
      await page.ready;
      page.events.set('Runtime.consoleAPICalled', [event => consoleEvents.push({
        stage, type: event.type, text: redact(event.args.map(a => a.value ?? a.description ?? a.type).join(' ')),
      })]);
      page.events.set('Runtime.exceptionThrown', [event => exceptions.push({ stage, details: redact(JSON.stringify(event.exceptionDetails)) })]);
      await page.send('Runtime.enable');
      await page.send('Page.enable');
      await page.send('Emulation.setDeviceMetricsOverride', { width: 1392, height: 932, deviceScaleFactor: 1, mobile: false });
      return true;
    }
    // The native onboarding window is replaced by a new target after skipping credentials.
    const onboarding = targets.find(t => t.type === 'page' && t.url.startsWith('file:'));
    if (onboarding) {
      const welcome = new Devtools(onboarding.webSocketDebuggerUrl, { timeoutMs: 10000 });
      try {
        await welcome.ready;
        await welcome.evaluate(`(() => {
          const buttons = [...document.querySelectorAll('button')].filter(b => b.getBoundingClientRect().width);
          const next = buttons.find(b => /^(稍后配置|Set up later|Configure later|Skip for now)$/i.test(b.textContent.trim()))
            ?? buttons.find(b => /^(添加 API Key|Add API Key)$/i.test(b.textContent.trim()));
          next?.click();
        })()`);
      } catch (error) {
        if (!String(error).includes('connection closed')) throw error;
      } finally { welcome.close(); }
    }
    return false;
  }, 'native onboarding → real main window', 45000);
}

async function click(selector) {
  appendFileSync(join(evidence, 'actions.log'), `${stage}: locate ${selector}\n`);
  await waitFor(() => page.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), selector);
  const point = await page.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const before = element.getBoundingClientRect();
    if (before.top < 0 || before.bottom > innerHeight) element.scrollIntoView({ block: 'center' });
    const r = element.getBoundingClientRect();
    if (!r.width || !r.height || element.disabled) throw Error('Control not actionable: ' + ${JSON.stringify(selector)});
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`);
  appendFileSync(join(evidence, 'actions.log'), `${stage}: click ${JSON.stringify(point)}\n`);
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  appendFileSync(join(evidence, 'actions.log'), `${stage}: clicked\n`);
}

async function key(key, code, windowsVirtualKeyCode, modifiers = 0) {
  for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode, modifiers });
}

async function capture(name) {
  if (!page) return;
  const results = await Promise.allSettled([
    page.send('Page.captureScreenshot', { format: 'png' }).then(result => writeFile(join(evidence, `${name}.png`), Buffer.from(result.data, 'base64'))),
    page.evaluate('document.documentElement.outerHTML').then(html => writeFile(join(evidence, `${name}.html`), redact(html))),
  ]);
  for (const result of results) if (result.status === 'rejected') report.steps.push({ name: `${name}:capture`, error: String(result.reason) });
}

async function step(name, run) {
  stage = name;
  console.log(`RUN ${name}`);
  const started = Date.now();
  await run();
  if (values['fail-after'] === name) throw new Error(`Injected failure after ${name}`);
  report.steps.push({ name, status: 'passed', durationMs: Date.now() - started });
  await capture(name);
  console.log(`PASS ${name}`);
}

// A stalled protocol call must not hang CI indefinitely; keep evidence and stop the owned process.
const watchdog = setTimeout(() => {
  report.status = 'failed'; report.error = `Overall timeout at ${stage}`;
  child?.kill('SIGKILL'); page?.close();
}, 180000);
try {
  await start();
  await waitFor(async () => !!await readFile(join(dshHome, 'profiles/desktop/package.json')).catch(() => null), 'Desktop initializes isolated profile');
  await connectMain();
  await step('native-baseline', async () => {
    await waitFor(() => page.evaluate('!!document.querySelector("[contenteditable=true]")'), 'native composer mounts before plugin installation');
    assert.notEqual(await page.evaluate('document.documentElement.dataset.dshCcdStyle'), 'true');
  });
  await stop();
  stage = 'install';
  child = spawn(join(app, 'Contents/Resources/runtime/cli/bin/dsh'), ['plugin', '--profile', 'desktop', 'add', tarball], {
    env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { hostLog += data; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0, 'tarball installs through the real DSH CLI');
  await start();
  await connectMain();
  await step('shell', async () => {
    await waitFor(() => page.evaluate('document.documentElement.dataset.dshCcdStyle === "true" && !!document.querySelector(".ccd-model-controls")'), 'plugin activates in real Desktop');
    assert.equal(await page.evaluate('document.documentElement.dataset.platform'), 'darwin');
  });
  await step('sidebar-visual', async () => {
    await waitFor(() => page.evaluate('!!document.querySelector(".ccd-sidebar-search-row") && !!document.querySelector("[data-ccd-nav=plugins]")'), 'sidebar navigation is themed');
    const geometry = await page.evaluate(`(() => {
      const search = document.querySelector('.ccd-sidebar-search-row');
      const rows = [...document.querySelectorAll('[data-ccd-panel][data-ccd-nav], [data-ccd-nav=more]')];
      const boxes = [search, ...rows].map(row => row.getBoundingClientRect());
      const tokens = getComputedStyle(search);
      return {
        heights: boxes.map(box => box.height),
        gaps: boxes.slice(1).map((box, i) => box.top - boxes[i].bottom),
        pins: rows.flatMap(row => {
          const pin = row.parentElement.querySelector('button[class$="_panelUnpin"] svg');
          if (!pin) return [];
          const icon = pin.getBoundingClientRect();
          const box = row.getBoundingClientRect();
          return [icon.top + icon.height / 2 - (box.top + box.height / 2)];
        }),
        height: parseFloat(tokens.getPropertyValue('--ccd-nav-row-height')),
        gap: parseFloat(tokens.getPropertyValue('--ccd-nav-gap')),
      };
    })()`);
    assert.ok(geometry.heights.every(height => Math.abs(height - geometry.height) < 1), JSON.stringify(geometry));
    assert.ok(geometry.gaps.every(gap => Math.abs(gap - geometry.gap) < 1), JSON.stringify(geometry));
    if (await page.evaluate('!!document.querySelector("[data-sidebar-scrollport]")')) {
      assert.ok(geometry.pins.length > 0 && geometry.pins.every(offset => Math.abs(offset) < 0.5), JSON.stringify(geometry));
    }
    await click('[data-ccd-nav=more]');
    await waitFor(() => page.evaluate('!!document.querySelector("[data-ccd-sidebar-more-menu]")'), 'sidebar More card opens');
    const popup = await page.evaluate(`(() => {
      const menu = getComputedStyle(document.querySelector('[data-ccd-sidebar-more-menu]'));
      return {
        radius: menu.borderRadius,
        expectedRadius: menu.getPropertyValue('--ccd-radius-panel').trim(),
        shadow: menu.boxShadow,
        visibleBacking: [...document.querySelectorAll('[data-menu-backing]')]
          .some(node => getComputedStyle(node).display !== 'none'),
      };
    })()`);
    assert.equal(popup.radius, popup.expectedRadius);
    assert.notEqual(popup.shadow, 'none');
    assert.equal(popup.visibleBacking, false);
    await capture('sidebar-more');
    await key('Escape', 'Escape', 27);
    await waitFor(() => page.evaluate('!document.querySelector("[data-ccd-sidebar-more-menu]")'), 'sidebar More card closes');
  });
  await step('composer', async () => {
    await click('[contenteditable="true"]');
    await page.send('Input.insertText', { text: 'DSH smoke draft — never sent' });
    await waitFor(() => page.evaluate('document.querySelector("[contenteditable=true]")?.textContent.includes("DSH smoke draft")'), 'native composer accepts input');
    await key('a', 'KeyA', 65, 4);
    await key('Backspace', 'Backspace', 8);
    await waitFor(() => page.evaluate('!document.querySelector("[contenteditable=true]")?.textContent.trim()'), 'native composer clears draft');
  });
  await step('permission', async () => {
    await click('button[aria-label^="访问模式"],button[aria-label^="Access mode"]');
    await waitFor(() => page.evaluate('[...document.querySelectorAll("[role=menuitem]")].some(e=>/手动|Manual/.test(e.textContent))'), 'permission menu');
    await click('[data-ccd-permission-mode="read-only"]');
    await waitFor(() => page.evaluate('[...document.querySelectorAll("button")].some(e=>/访问模式.*仅可查看|Access mode.*Read.only/i.test(e.getAttribute("aria-label")??""))'), 'host permission state becomes read-only');
  });
  await step('model-menu', async () => {
    await click('button[aria-label^="选择模型"],button[aria-label^="Select model"]');
    await waitFor(() => page.evaluate('/暂无可用模型|No models available/i.test(document.body.innerText)'), 'real empty model directory (no credentials)');
    await key('Escape', 'Escape', 27);
    await waitFor(() => page.evaluate('!/暂无可用模型|No models available/i.test(document.body.innerText)'), 'model menu closes');
  });
  await step('navigation', async () => {
    await click('button[aria-label="自定义"],button[aria-label="Customize"]');
    await waitFor(() => page.evaluate('!!document.querySelector("[data-plugin-panel][data-ccd-plugin-page]")'), 'real plugin manager');
    await click('button[aria-label="定时任务"],button[aria-label="Scheduled tasks"]');
    await waitFor(() => page.evaluate('!!document.querySelector("[data-testid=task-manager-page]")'), 'real task manager');
    await click('button[aria-label="主题"],button[aria-label="Theme"]');
    await waitFor(() => page.evaluate('!!document.querySelector("#ccd-settings-enabled")'), 'plugin settings');
  });
  await step('disable-enable', async () => {
    await click('#ccd-settings-enabled');
    await waitFor(() => page.evaluate('document.documentElement.dataset.dshCcdStyle !== "true" && !document.querySelector(".ccd-model-controls,[data-ccd-balance-slot]")'), 'disabling releases theme and plugin controls');
    await click('#ccd-settings-enabled');
    await waitFor(() => page.evaluate('document.documentElement.dataset.dshCcdStyle === "true"'), 'enabling restores theme');
    await click('#ccd-settings-show-api-balance');
    await waitFor(() => page.evaluate('document.querySelector("#ccd-settings-show-api-balance")?.getAttribute("aria-checked") === "false" && !document.querySelector("[data-ccd-balance-slot]")'), 'saved setting changes actual UI');
    await waitFor(async () => /showApiBalance:\s*false/.test(await readFile(join(dshHome, 'profiles/desktop/cordis.patch.yml'), 'utf8')), 'host persists setting to disk');
  });
  await step('restart', async () => {
    await stop(); await start(); await connectMain();
    await waitFor(() => page.evaluate('document.documentElement.dataset.dshCcdStyle === "true"'), 'plugin activates after restart');
    await click('button[aria-label="主题"],button[aria-label="Theme"]');
    await waitFor(() => page.evaluate('document.querySelector("#ccd-settings-show-api-balance")?.getAttribute("aria-checked") === "false"'), 'saved setting survives actual process restart');
    assert.equal(await page.evaluate('document.querySelectorAll("[data-ccd-balance-slot]").length'), 0);
  });
  await step('runtime-errors', async () => {
    assert.deepEqual(exceptions, [], 'uncaught renderer errors');
    const errors = consoleEvents.filter(e => e.type === 'error' && /dsh-claude-desktop-theme|ccd-style|activation failed|unregistered DSH build/i.test(e.text));
    assert.deepEqual(errors, [], 'plugin runtime errors');
  });
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = redact(error.stack ?? error);
  report.steps.push({ name: stage, status: 'failed', error: redact(error.message) });
  await capture('failure');
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await stop();
  report.finishedAt = new Date().toISOString();
  await Promise.all([
    writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2)),
    writeFile(join(evidence, 'console.json'), JSON.stringify({ consoleEvents, exceptions }, null, 2)),
    writeFile(join(evidence, 'host.log'), redact(hostLog)),
  ]);
  console.log(`${report.status.toUpperCase()}: ${join(evidence, 'report.json')}`);
  // Keep only reviewable evidence and the exact input package; never publish profiles or auth state.
  await Promise.all([userData, dshHome, workspace].map(path => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
}
