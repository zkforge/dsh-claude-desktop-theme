import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileSummaryParts, toolFileSummary } from '../src/client/compat/tool-file-summary.ts';

function row(tool: string, state = 'ok', added = '+2', removed = '-0') {
  const header = {
    querySelector(selector: string) {
      const text = selector.includes('_fileLink') ? 'test.txt' : selector.includes('_diffAdded') ? added
        : selector.includes('_diffRemoved') ? removed : undefined;
      return text === undefined ? null : { textContent: text };
    },
  };
  return { getAttribute: (name: string) => name === 'data-tool' ? tool : state,
    querySelector: () => header } as unknown as Element;
}

test('writes are not inferred to be creates; only successful native file headers are summarized', () => {
  assert.deepEqual(toolFileSummary(row('write')), { action: 'write', name: 'test.txt', added: 2, removed: 0 });
  assert.equal(toolFileSummary(row('edit'))?.action, 'edit');
  for (const state of ['running', 'preparing', 'error', 'stopped', 'awaiting-approval']) {
    assert.equal(toolFileSummary(row('write', state)), null);
  }
  assert.equal(toolFileSummary(row('str_replace_editor')), null);
  assert.equal(toolFileSummary({ getAttribute: () => 'ok' } as unknown as Element), null);
});

test('statistics accept native minus forms, reject incomplete values and never invent missing counts', () => {
  assert.equal(toolFileSummary(row('edit', 'ok', '+12', '−3'))?.removed, 3);
  for (const added of ['', '+', '+2 lines', '+999999999999999999999']) {
    const file = toolFileSummary(row('write', 'ok', added))!;
    assert.equal(file.added, undefined);
    assert.equal(fileSummaryParts([file], []).some(part => part.tone === 'added'), false);
  }
});

test('mixed summaries retain filenames, bound the file list and aggregate complete statistics', () => {
  const files = [toolFileSummary(row('write'))!, toolFileSummary(row('edit', 'ok', '+1', '-1'))!];
  const parts = fileSummaryParts(files, ['Ran 1 command']);
  assert.equal(parts.map(part => part.text).join(''), 'Wrote test.txt, Edited test.txt, Ran 1 command+3−1');
  assert.deepEqual(parts.slice(-2), [{ text: '+3', tone: 'added' }, { text: '−1', tone: 'removed' }]);
  const many = fileSummaryParts([...files, ...files], []);
  assert.equal(many.filter(part => part.tone === 'file').length, 2);
  assert.ok(many.some(part => part.text === ' (4 file operations)'));
  assert.equal(fileSummaryParts([files[0]!, { action: 'edit', name: 'unknown.ts' }], []).some(part => part.tone === 'added'), false);
});
