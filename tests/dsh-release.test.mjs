import assert from 'node:assert/strict';
import { test } from 'node:test';
import YAML from 'yaml';
import { releaseFromFeed } from '../scripts/dsh-release.mjs';

const feed = {
  version: '0.2.2-rc.1',
  files: [{ url: 'https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.2.2-rc.1-mac-arm64.zip',
    size: 353501474, sha512: 'mHn+lwXZd7I3ZvakFhRg0lxrGe0pNSmWhMU65AQiyrjy/yfa0C8Rq6nQ6tLcxnqdFYl+j5BN4ghOToTLiT2qGA==' }],
};

test('official updater metadata retains prereleases and archive identity', () => {
  assert.deepEqual(releaseFromFeed(YAML.stringify(feed)), { version: feed.version, ...feed.files[0] });
});

test('changed upstream metadata cannot silently select an unverified archive', () => {
  for (const changed of [
    { ...feed, version: 'invalid\nversion' }, { ...feed, files: [] },
    ...[{ url: 'https://example.com/app-mac-arm64.zip' }, { sha512: 'missing' }, { size: 0 }]
      .map(fields => ({ ...feed, files: [{ ...feed.files[0], ...fields }] })),
  ]) assert.throws(() => releaseFromFeed(YAML.stringify(changed)));
});
