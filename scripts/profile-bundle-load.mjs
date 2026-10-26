/** Measure the built client envelope and factory over preloaded real runtimes.
 * npm run build
 * CCD_PERF_DIR=artifacts/performance/components-final CCD_PERF_TRACE=1 node scripts/profile-bundle-load.mjs
 * This excludes DSH startup, disk/network fetch, service injection and rendering.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { withPage } from './lib/headless-chrome.mjs';

if (!process.env.CCD_PERF_DIR) throw new Error('Set CCD_PERF_DIR to retain the measurements');
const root = fileURLToPath(new URL('../', import.meta.url));
const client = await readFile(join(root, 'lib/client.js'), 'utf8');
const runtimes = await build({ stdin: { resolveDir: root, loader: 'js', contents: [
  "import * as React from 'react';",
  "import * as jsx from 'react/jsx-runtime';",
  "import * as cordis from '@deepseek-ai/cordis';",
  "const table={'react':React,'react/jsx-runtime':jsx,'@deepseek-ai/cordis':cordis};",
  "window.runtimeModule=id=>{if(!table[id])throw Error('Unexpected runtime '+id);return table[id];};",
].join('\n') }, bundle: true, write: false, format: 'iife', platform: 'browser' });
for (let run = 0; run < 3; run++) {
  const profile = await mkdtemp(join(tmpdir(), 'ccd-bundle-'));
  try {
    await withPage({ url: 'about:blank', width: 1392, height: 932, profile }, async page => {
      await page.evaluate(runtimes.outputFiles[0].text);
      await page.evaluate('window.pluginCode=' + JSON.stringify(client) + ';window.__ModuleLoader__={load:row=>window.registration=row};');
      await page.evaluate("__ccdPerf.measure('bundle:register',()=>{(0,eval)(pluginCode)},()=>!!window.registration)");
      await page.evaluate("__ccdPerf.measure('bundle:factory',()=>{window.client=registration.factory(runtimeModule)},()=>typeof window.client?.apply==='function')");
      assert.deepEqual(await page.evaluate('Object.keys(window.client).sort()'), ['apply', 'inject']);
      console.log(JSON.stringify({ run: run + 1, bytes: Buffer.byteLength(client), measurements: await page.evaluate('__ccdPerf.measures') }));
    });
  } finally { await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}
