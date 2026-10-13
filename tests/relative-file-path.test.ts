import assert from 'node:assert/strict';
import test from 'node:test';
import { relativeFilePath } from '../src/client/compat/relative-file-path.ts';

test('preview paths are relative to the working directory and retain subdirectories', () => {
  assert.equal(relativeFilePath('/repo/install.md', '/repo'), 'install.md');
  assert.equal(relativeFilePath('/repo/docs/README.md', '/repo/'), 'docs/README.md');
  assert.equal(relativeFilePath('/repo-other/file.md', '/repo'), '../repo-other/file.md');
  assert.equal(relativeFilePath('docs/README.md', '/repo'), 'docs/README.md');
  assert.equal(relativeFilePath('/README.md', '/'), 'README.md');
  assert.equal(relativeFilePath('/repo', '/repo'), '.');
});

test('Windows paths compare case-insensitively and preserve unrelated volumes', () => {
  assert.equal(relativeFilePath('C:\\Repo\\docs\\README.md', 'c:\\repo\\'), 'docs/README.md');
  assert.equal(relativeFilePath('D:\\docs\\README.md', 'C:\\repo'), 'D:/docs/README.md');
  assert.equal(relativeFilePath('\\\\server\\share\\repo\\file.md', '\\\\SERVER\\share\\repo'), 'file.md');
  assert.equal(relativeFilePath('\\\\server\\other\\file.md', '\\\\server\\share\\repo'), '//server/other/file.md');
});
