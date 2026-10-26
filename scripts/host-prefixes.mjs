#!/usr/bin/env node
/**
 * Refresh the pinned host class prefixes from a shipped DSH build.
 *
 * DSH hashes CSS-module class names per build, and the macOS and Windows
 * installers of one version are separate builds. This plugin therefore keeps
 * one prefix table per build in `src/client/compat/host-builds.ts`, and every
 * table has to be re-read from that build's `app.asar` whenever DSH ships a
 * new one. This command does that reading and writing.
 *
 *   # A new Windows build (the usual case: only the other platform moved)
 *   node scripts/host-prefixes.mjs --windows /path/to/windows/app.asar --write
 *
 *   # A new release: rebind the authored prefixes, then the other build
 *   node scripts/host-prefixes.mjs --pinned /path/to/macos/app.asar \
 *     --windows /path/to/windows/app.asar --write
 *
 * `--pinned` rewrites every host class named in `src/` (the stylesheets are
 * authored against that build) and the Windows table's keys with them, so run
 * it before `--windows`. The reference build defaults to the installed app;
 * a registered reference build is translated back to the authored prefixes.
 * Pass `--authored` to use a different reference archive.
 *
 * Without `--write` nothing is touched and the mapping is printed. A prefix
 * that cannot be paired exactly is reported and exits non-zero, because a
 * guessed pairing is a silently unstyled interface.
 *
 * After writing, run `npm run check`: the tests re-derive the tables from the
 * sources and fail on a prefix without a counterpart.
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  asarBuildIdentity, asarModules, isSourceFile, mapPrefixes, readAsar,
  renderWindowsBuild, rewritePrefixes,
} from './lib/host-prefixes.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const BUILD_FILE = resolve(root, 'src/client/compat/host-builds.ts');

/** Where an installed app keeps its `app.asar`, per platform. */
function installedAsar() {
  const candidates = [
    '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar',
    join(homedir(), 'AppData', 'Local', 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'),
  ];
  return candidates.find(candidate => existsSync(candidate)) ?? null;
}

function parseArguments(argv) {
  const options = { pinned: null, windows: null, authored: null, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--write') options.write = true;
    else if (argument === '--pinned') options.pinned = argv[++index];
    else if (argument === '--windows') options.windows = argv[++index];
    else if (argument === '--authored') options.authored = argv[++index];
    else throw new Error(`unknown argument ${JSON.stringify(argument)}`);
  }
  if (options.pinned === null && options.windows === null) {
    throw new Error('pass --windows <app.asar>, --pinned <app.asar>, or both');
  }
  options.authored ??= installedAsar();
  if (options.authored === null) {
    throw new Error('no installed app.asar found; pass --authored <app.asar>');
  }
  return options;
}

/** Every source file the plugin names host classes in. */
function sourceFiles() {
  return readdirSync(resolve(root, 'src'), { recursive: true, encoding: 'utf8' })
    .filter(isSourceFile)
    .map(path => ({ path: resolve(root, 'src', path), text: readFileSync(resolve(root, 'src', path), 'utf8') }));
}

/** One build's CSS modules, keyed by hash, with its identity. */
function loadBuild(path) {
  /* Only the client bundles and the two manifests are needed; the runtime's
     binaries and assets would otherwise be read into memory for nothing. */
  const wanted = entry => entry === 'package.json' || entry === 'dsh/package.json'
    || (entry.startsWith('dsh/') && /\.(js|mjs|cjs)$/u.test(entry));
  const asar = readAsar(path, wanted);
  return { modules: asarModules(asar), identity: asarBuildIdentity(asar) };
}

/** The eight characters a commit is referred to by, in ids and in comments. */
function shortCommit(identity) {
  return identity.commit === undefined ? 'unknown' : identity.commit.slice(0, 8);
}

/** `dsh-<version>-<short commit>`, the id both tables are labelled with. */
function buildId(identity) {
  return `dsh-${identity.version ?? 'unknown'}-${shortCommit(identity)}`;
}

/** Pair every prefix with one target build, or exit with the reasons. */
function pair(prefixes, reference, target) {
  /* The installed reference may be newer than the authored build. Its
     registered table identifies the same modules under their current hashes. */
  const id = buildId(reference.identity);
  const registered = HOST_BUILDS.find(build =>
    (build.id === id || build.id === `${id}-win32`)
    && reference.modules.get(build.frameClass.slice(0, -'_frame'.length))?.locals.has('frame'));
  const modules = new Map(reference.modules);
  for (const prefix of prefixes) {
    const actual = registered?.prefixes[prefix];
    const module = actual === undefined ? undefined : reference.modules.get(actual.slice(0, -1));
    if (module !== undefined) modules.set(prefix.slice(0, -1), module);
  }
  const { mapping, problems } = mapPrefixes(prefixes, modules, target.modules);
  if (problems.size > 0) {
    for (const [prefix, reason] of problems) process.stderr.write(`host-prefixes: ${prefix}: ${reason}\n`);
    throw new Error(`${problems.size} prefix(es) could not be paired`);
  }
  return mapping;
}

function replaceBlock(text, marker, rendered) {
  const pattern = new RegExp(`/\\*\\*\\n \\* ${marker}[\\s\\S]*?\\n\\}\\);`, 'u');
  if (!pattern.test(text)) throw new Error(`host-builds.ts: ${marker} block not found`);
  return text.replace(pattern, rendered);
}

const options = parseArguments(process.argv.slice(2));
/* The current tables decide which prefixes are the authored ones. */
const { HOST_BUILDS, PINNED_BUILD, WINDOWS_BUILD } = await import(
  new URL('../src/client/compat/host-builds.ts', import.meta.url)
);
let prefixes = Object.keys(WINDOWS_BUILD.prefixes);
/* Local names never contain an underscore, so the prefix ends at the last one. */
let framePrefix = PINNED_BUILD.frameClass.slice(0, PINNED_BUILD.frameClass.lastIndexOf('_') + 1);
let referencePath = options.authored;
let reference = loadBuild(referencePath);
let sources = sourceFiles();
const written = [];

if (options.pinned !== null) {
  const target = loadBuild(options.pinned);
  const mapping = pair(prefixes, reference, target);
  const frameClass = `${mapping.get(framePrefix)}frame`;
  process.stdout.write(`--pinned ${buildId(target.identity)} (reference ${buildId(reference.identity)}): ${mapping.size} prefixes\n`);
  for (const [from, to] of mapping) if (from !== to) process.stdout.write(`  ${from} -> ${to}\n`);
  if (options.write) {
    for (const file of sources) {
      const next = rewritePrefixes(file.text, mapping);
      if (next === file.text) continue;
      writeFileSync(file.path, next);
      written.push(relative(root, file.path));
    }
    const rendered = [
      '/**',
      ` * The build the stylesheets are authored against: DSH \`${target.identity.version}\`, macOS`,
      ` * commit \`${shortCommit(target.identity)}\`. An empty table is the identity rewrite.`,
      ' */',
      'export const PINNED_BUILD: HostBuild = Object.freeze({',
      `  id: '${buildId(target.identity)}',`,
      `  frameClass: '${frameClass}',`,
      '  prefixes: Object.freeze({}),',
      '});',
    ].join('\n');
    writeFileSync(BUILD_FILE, replaceBlock(readFileSync(BUILD_FILE, 'utf8'), 'The build the stylesheets', rendered));
    written.push(relative(root, BUILD_FILE));
    /* The rewritten sources now carry the target build's prefixes. */
    prefixes = [...mapping.values()];
    framePrefix = mapping.get(framePrefix) ?? framePrefix;
    referencePath = options.pinned;
    reference = target;
    sources = sourceFiles();
  }
}

if (options.windows !== null) {
  const target = loadBuild(options.windows);
  const mapping = pair(prefixes, reference, target);
  const frameClass = `${mapping.get(framePrefix)}frame`;
  process.stdout.write(`--windows ${buildId(target.identity)} (reference ${buildId(reference.identity)}): ${mapping.size} prefixes, frame ${frameClass}\n`);
  /* Windows and macOS can share both version and commit but hash differently.
     Keep their selector caches and diagnostic identities distinct. */
  const rendered = renderWindowsBuild({ id: `${buildId(target.identity)}-win32`, frameClass, prefixes: mapping });
  if (options.write) {
    const header = [
      '/**',
      ` * DSH \`${target.identity.version}\`, Windows commit \`${shortCommit(target.identity)}\`. Read from that build's`,
      " * `app.asar`: each entry is the same CSS module's class-name map, keyed by the",
      ' * prefix this plugin authored.',
      ' */',
    ].join('\n');
    writeFileSync(BUILD_FILE, replaceBlock(
      readFileSync(BUILD_FILE, 'utf8'), 'DSH `', `${header}\n${rendered}`,
    ));
    written.push(relative(root, BUILD_FILE));
  } else {
    process.stdout.write(`${rendered}\n`);
  }
}

process.stdout.write(options.write
  ? `updated: ${[...new Set(written)].join(', ')}\n`
  : `dry run against ${referencePath}; pass --write to update host-builds.ts\n`);
