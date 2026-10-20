import { build, context } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { BASELINE_MODULES } from './lib/platform.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
// lib is exclusively generated; discard obsolete declarations and assets.
await rm(join(root, 'lib'), { recursive: true, force: true });
await mkdir('lib', { recursive: true });
await mkdir('artifacts/build', { recursive: true });

// Shared module identities come from the DSH shell, never private copies.
const baseline = BASELINE_MODULES;
const host = {
  entryPoints: ['src/host/index.ts'], outfile: 'lib/index.js', bundle: true,
  format: 'esm', platform: 'node', target: 'node22',
  external: [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)],
};
const client = {
  entryPoints: ['src/client/index.ts'], outfile: 'lib/client.js', bundle: true,
  format: 'cjs', platform: 'browser', target: 'es2022', metafile: true,
  external: baseline, loader: { '.css': 'text' },
  define: { __CCD_PLUGIN_VERSION__: JSON.stringify(pkg.version) },
  banner: { js: `window.__ModuleLoader__.load({\n  id: ${JSON.stringify(pkg.name)},\n  factory(require) {\n    const module = { exports: {} };\n    const exports = module.exports;` },
  footer: { js: '\n    return module.exports;\n  }\n});' },
  plugins: [{
    name: 'check-shared-module-requests',
    setup(builder) {
      builder.onResolve({ filter: /^@deepseek-ai\/dsh-/ }, args => {
        if (!baseline.includes(args.path)) {
          return { errors: [{ text: `Dynamic DSH packages are type-only; use ctx/slots instead: ${args.path}` }] };
        }
        return undefined;
      });
      builder.onEnd(async result => {
        if (result.errors.length > 0 || result.metafile === undefined) return;
        const requests = Object.values(result.metafile.outputs)
          .flatMap(output => output.imports).filter(item => item.external);
        for (const request of requests) {
          if (!baseline.includes(request.path)) {
            throw new Error(`Undeclared DSH module request: ${request.path}`);
          }
        }
        await writeFile(join(root, 'artifacts/build/client-meta.json'), JSON.stringify(result.metafile, null, 2));
      });
    },
  }],
};

function emitTypes() {
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json'], {
    stdio: 'inherit', cwd: root,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Declaration build failed');
}

if (process.argv.includes('--watch')) {
  emitTypes();
  const hostContext = await context(host);
  const clientContext = await context(client);
  await Promise.all([hostContext.watch(), clientContext.watch()]);
  console.log('Watching JS/CSS. Rerun npm run build to refresh declaration files before packaging.');
} else {
  await Promise.all([build(host), build(client)]);
  emitTypes();
  console.log('Built lib/index.js, the DSH module-loader client, and declaration files.');
}
