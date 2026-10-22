import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { slashMenuOpener } from '../src/client/compat/slash-menu-port.ts';

for (const [draft, start, expected] of [['', 0, '/'], ['hello', 5, ' /'], ['hello ', 6, '/']] as const) {
  test(`slash launcher inserts a real trigger at the captured selection in ${JSON.stringify(draft)}`, () => {
    const inserted: unknown[] = [];
    const span = { start, end: start, draftRev: 7 };
    const scoped = {};
    let focused = false;
    const ctx = {
      sessions: { scope: (id: string) => { assert.equal(id, 'a'); return scoped; } },
      conversation: { input: { for: (scope: unknown) => {
        assert.equal(scope, scoped);
        return {
          focus: () => { focused = true; },
          state: { getSnapshot: () => ({ draft }) },
          actions: {
            captureInsertion: () => { assert.equal(focused, true); return span; },
            insertText: (text: string, selection: unknown) => { inserted.push(text, selection); return true; },
          },
        };
      } } },
    } as unknown as Context;
    slashMenuOpener(ctx)('a');
    assert.deepEqual(inserted, [expected, span]);
  });
}
