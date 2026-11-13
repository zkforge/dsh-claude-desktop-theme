#!/usr/bin/env node
/** Read the same official macOS ARM64 nightly feed used by the installed Desktop updater. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import YAML from 'yaml';

export const DSH_FEED = 'https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml';

/** Validate remote metadata once, before it becomes a download URL or a cache key. */
export function releaseFromFeed(text) {
  const feed = YAML.parse(text);
  assert.ok(feed && typeof feed.version === 'string' && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/u.test(feed.version), 'Invalid DSH release version');
  assert.ok(Array.isArray(feed.files), 'DSH release has no files');
  const archive = feed.files.find(file => typeof file?.url === 'string' && file.url.endsWith('-mac-arm64.zip'));
  assert.ok(archive, 'DSH release has no macOS ARM64 zip');
  const url = new URL(archive.url, DSH_FEED);
  assert.equal(url.origin, 'https://download.deepseek.com', 'Expected official DSH download origin');
  assert.ok(url.pathname.startsWith('/dsh-desk/bin/mac-arm64/'), 'Unexpected DSH archive path');
  assert.ok(Number.isSafeInteger(archive.size) && archive.size > 0, 'Invalid DSH archive size');
  assert.ok(typeof archive.sha512 === 'string' && Buffer.from(archive.sha512, 'base64').length === 64
    && Buffer.from(archive.sha512, 'base64').toString('base64') === archive.sha512, 'Invalid DSH archive SHA-512');
  return { version: feed.version, url: url.href, size: archive.size, sha512: archive.sha512 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    output: { type: 'string', default: 'artifacts/dsh-release.yml' },
    manifest: { type: 'string' },
    download: { type: 'string' },
  } });
  const response = values.manifest ? null : await fetch(DSH_FEED, { signal: AbortSignal.timeout(30000) });
  if (response) assert.ok(response.ok, `DSH feed HTTP ${response.status}`);
  const text = values.manifest ? await readFile(values.manifest, 'utf8') : await response.text();
  const release = releaseFromFeed(text);
  const key = createHash('sha256').update(JSON.stringify(release)).digest('hex');
  await mkdir(dirname(resolve(values.output)), { recursive: true });
  await writeFile(values.output, text);
  console.log(JSON.stringify({ ...release, key }, null, 2));
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `key=${key}\nversion=${release.version}\n`);
  if (values.download) {
    const destination = resolve(values.download);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.partial`;
    try {
      const archive = await fetch(release.url, { signal: AbortSignal.timeout(300000) });
      assert.ok(archive.ok && archive.body, `DSH archive HTTP ${archive.status}`);
      const hash = createHash('sha512');
      let size = 0;
      await pipeline(Readable.fromWeb(archive.body), new Transform({ transform(chunk, encoding, callback) {
        size += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      } }), createWriteStream(temporary));
      assert.equal(size, release.size, 'DSH archive byte length differs from feed');
      assert.equal(hash.digest('base64'), release.sha512, 'DSH archive checksum differs from feed');
      await rename(temporary, destination);
      console.log(`Verified archive: ${destination}`);
    } finally { await rm(temporary, { force: true }); }
  }
}
