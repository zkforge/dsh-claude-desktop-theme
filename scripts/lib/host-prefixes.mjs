/**
 * Host prefix extraction for the pinned DSH builds.
 *
 * DSH hashes CSS-module class names per build, so `src/client/compat/
 * host-builds.ts` holds one table per shipped build. This module turns the
 * tedious half of that — reading a build's real class names out of its
 * `app.asar` and pairing them with the classes the plugin names — into data
 * transforms the CLI in `scripts/host-prefixes.mjs` can print or write.
 *
 * An asar is a header pickle followed by the files' bytes, uncompressed, so a
 * reader is a few lines and no dependency. Class maps are the object literals
 * the client bundles carry (`"frame": "BynINW_frame"`); the local name after
 * the prefix is what pairs one build's module with another's.
 */

import { closeSync, openSync, readSync } from 'node:fs';

/** Read the asar header and return `path -> Buffer` for accepted entries. */
export function readAsar(path, accept = () => true) {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, head.length, 0);
    const headerSize = head.readUInt32LE(4);
    const jsonLength = head.readUInt32LE(12);
    const json = Buffer.alloc(jsonLength);
    readSync(fd, json, 0, jsonLength, 16);
    const files = new Map();
    const dataStart = 8 + headerSize;
    const visit = (node, prefix) => {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        const entryPath = prefix === '' ? name : `${prefix}/${name}`;
        if (entry.files !== undefined) visit(entry, entryPath);
        /* Symbolic links carry a `link` target and no bytes of their own. */
        else if (entry.offset !== undefined && accept(entryPath)) {
          const offset = Number(entry.offset);
          const size = Number(entry.size);
          const buffer = Buffer.alloc(size);
          readSync(fd, buffer, 0, size, dataStart + offset);
          files.set(entryPath, buffer);
        }
      }
    };
    visit(JSON.parse(json.toString('utf8')), '');
    return files;
  } finally {
    closeSync(fd);
  }
}

/**
 * `hash -> Set<local>` for every CSS module named in one bundle text.
 *
 * A bundle holds several CSS modules, and the hash is the module's identity:
 * every class of one module shares it, and the local names after it are what
 * pairs that module with the same module in another build.
 */
export function parseClassMaps(text) {
  const modules = new Map();
  for (const match of text.matchAll(/"([A-Za-z][A-Za-z0-9_]*)":\s*"([A-Za-z0-9_-]{3,14})_\1"/g)) {
    const [, local, hash] = match;
    if (!modules.has(hash)) modules.set(hash, new Set());
    modules.get(hash).add(local);
  }
  return modules;
}

/** `hash -> { file, locals }` for every CSS module in one asar. */
export function asarModules(asar) {
  const modules = new Map();
  for (const [path, buffer] of asar) {
    if (!/\.(js|mjs|cjs)$/u.test(path)) continue;
    for (const [hash, locals] of parseClassMaps(buffer.toString('utf8'))) {
      if (!modules.has(hash)) modules.set(hash, { file: path, locals: new Set() });
      const module = modules.get(hash);
      for (const local of locals) module.locals.add(local);
    }
  }
  return modules;
}

/** The asar's own build identity, read from its runtime package manifest. */
export function asarBuildIdentity(asar) {
  const manifest = asar.get('package.json');
  const runtime = asar.get('dsh/package.json');
  const commit = manifest === undefined ? undefined
    : /"dshBuildCommit":\s*"([a-f0-9]+)"/u.exec(manifest.toString('utf8'))?.[1];
  const version = runtime === undefined ? undefined
    : /"version":\s*"([^"]+)"/u.exec(runtime.toString('utf8'))?.[1];
  return { version, commit };
}

/**
 * Pair each authored prefix with the module the target build gives it.
 *
 * The reference is the build the sources are currently pinned to: a prefix is
 * that build's hash for one CSS module, and the module's *whole* set of local
 * names is its fingerprint. Matching on the few names the plugin happens to use
 * is not enough — `body` alone names forty modules — so the authored build is
 * read as well and the target module must carry the same set.
 *
 * @param prefixes - the authored prefixes to pair.
 * @param reference - `hash -> { file, locals }` of the build the sources pin.
 * @param target - `hash -> { file, locals }` of the build to pair with.
 * @returns `{ mapping, problems }`, both keyed by authored prefix.
 */
export function mapPrefixes(prefixes, reference, target) {
  const mapping = new Map();
  const problems = new Map();
  const sameSet = (left, right) => left.size === right.size
    && [...left].every(local => right.has(local));
  for (const prefix of prefixes) {
    const module = reference.get(prefix.slice(0, -1));
    if (module === undefined) {
      problems.set(prefix, 'the reference build has no module with this prefix');
      continue;
    }
    // A retained hash in the same owning bundle is stronger evidence than a
    // local-name fingerprint. References can also be indexed by authored hash.
    const retained = [...reference].filter(([, entry]) => entry === module)
      .filter(([hash]) => target.get(hash)?.file === module.file);
    if (retained.length === 1) {
      mapping.set(prefix, `${retained[0][0]}_`);
      continue;
    }
    const candidates = [...target].filter(([, entry]) => sameSet(entry.locals, module.locals));
    if (candidates.length === 0) {
      problems.set(prefix, `no target module carries the same ${module.locals.size} local names`);
    } else if (candidates.length > 1) {
      problems.set(prefix, `ambiguous: ${candidates.map(([hash]) => `${hash}_`).join(', ')} are indistinguishable`);
    } else mapping.set(prefix, `${candidates[0][0]}_`);
  }
  return { mapping, problems };
}

/** Replace authored prefixes with the target build's, in one pass. */
export function rewritePrefixes(text, mapping) {
  const pattern = [...mapping.keys()].sort((left, right) => right.length - left.length)
    .map(prefix => prefix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
  if (pattern === '') return text;
  return text.replace(new RegExp(pattern, 'gu'), prefix => mapping.get(prefix) ?? prefix);
}

/** The `WINDOWS_BUILD` block, rendered from one target build. */
export function renderWindowsBuild({ id, frameClass, prefixes }) {
  const rows = [...prefixes.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([authored, actual]) => `    '${authored}': '${actual}',`).join('\n');
  return [
    'export const WINDOWS_BUILD: HostBuild = Object.freeze({',
    `  id: '${id}',`,
    `  frameClass: '${frameClass}',`,
    '  prefixes: Object.freeze({',
    rows,
    '  }),',
    '});',
  ].join('\n');
}

/** Every file under `src/` the plugin names host classes in. */
export function isSourceFile(path) {
  return /\.(css|ts|tsx)$/u.test(path);
}
