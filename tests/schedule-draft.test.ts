import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { mountScheduleDraft, NEW_SCHEDULE_DRAFT, prefillScheduleDraft } from '../src/client/compat/schedule-draft.ts';
import { SCHEDULE_TEMPLATES } from '../src/client/compat/schedule-page.ts';

type Input = Parameters<typeof prefillScheduleDraft>[0];
function inputFixture(draft = '', phase = 'plain', attachmentIds: string[] = []) {
  const state = { draft, phase, attachmentIds };
  let focused = 0;
  const input = { state: { getSnapshot: () => state },
    setDraft: (text: string) => { state.draft = text; }, focus: () => { focused++; },
  } as unknown as Input;
  return { input, state, get focused() { return focused; } };
}

test('new task seeds the exact requested draft, focuses once and preserves subsequent edits', () => {
  const f = inputFixture();
  assert.equal(prefillScheduleDraft(f.input), true);
  assert.equal(f.state.draft, '帮我设置一个定时任务。问我它应该做什么、多久运行一次以及在什么时间运行,然后创建它。');
  assert.equal(f.focused, 1);
  f.state.draft += '我补充的内容';
  assert.equal(prefillScheduleDraft(f.input), false);
  assert.equal(f.focused, 1);
});

test('each template prefills its own prompt and preserves an existing draft', () => {
  for (const template of SCHEDULE_TEMPLATES) {
    const f = inputFixture();
    assert.equal(prefillScheduleDraft(f.input, template.prompt), true);
    assert.equal(f.state.draft, template.prompt);
    assert.equal(f.focused, 1);
    assert.equal(prefillScheduleDraft(f.input, NEW_SCHEDULE_DRAFT), false);
    assert.equal(f.state.draft, template.prompt);
  }
});

test('existing drafts, attachments and busy inputs are preserved', () => {
  for (const f of [inputFixture('已有草稿'), inputFixture('', 'submitting'), inputFixture('', 'plain', ['file'])]) {
    const before = f.state.draft;
    assert.equal(prefillScheduleDraft(f.input), false);
    assert.equal(f.state.draft, before);
    assert.equal(f.focused, 0);
  }
});

test('pending task waits for the blank session editor, seeds only once, and stops on disposal', () => {
  const priorObserver = globalThis.MutationObserver;
  let mutation = () => {};
  let frame: FrameRequestCallback | undefined;
  let ready = false;
  let blank = true;
  let subscribed = () => {};
  const f = inputFixture();
  const errors: unknown[] = [];
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: class {
    constructor(callback: () => void) { mutation = callback; }
    observe() {} disconnect() {}
  } });
  const ctx = {
    sessions: {
      binding: () => ({ ctx: {} }),
      list: { getSnapshot: () => ({ byId: { demo: { blank } } }), subscribe: (callback: () => void) => { subscribed = callback; return () => {}; } },
    },
    inject: (_: unknown, callback: (scope: unknown) => void) => {
      callback({ conversation: { input: { for: () => f.input } }, effect: () => {} });
      return { dispose() {} };
    },
  } as unknown as Context;
  const document = { body: {},
    defaultView: { requestAnimationFrame: (callback: FrameRequestCallback) => { frame = callback; return 1; }, cancelAnimationFrame: () => { frame = undefined; } },
    // The session id is on ConversationContent, whose hero marker differs
    // from ConversationMainPanel and the editor's plain input phase.
    querySelector: (selector: string) => ready && selector === '[data-conversation-content][data-conversation-session][data-content-phase="hero"]'
      ? { getAttribute: () => 'demo', querySelector: () => ({}) } : null,
  } as unknown as Document;
  const flush = () => { const run = frame; frame = undefined; run?.(0); };
  const port = mountScheduleDraft(ctx, document, error => errors.push(error));
  try {
    const templatePrompt = SCHEDULE_TEMPLATES[1]!.prompt;
    port.prepare(templatePrompt); flush();
    assert.equal(f.state.draft, '');
    ready = true; blank = false; mutation(); flush();
    assert.equal(f.state.draft, '', 'existing conversation is never seeded');
    blank = true; subscribed(); flush();
    assert.equal(f.state.draft, templatePrompt);
    f.state.draft = ''; mutation(); flush();
    assert.equal(f.state.draft, '', 'consumed request does not refill a cleared draft');
    port.prepare(); flush();
    assert.equal(f.state.draft, NEW_SCHEDULE_DRAFT, 'new task resets to the default prompt after a template');
    f.state.draft = '';
    port.prepare(templatePrompt); port.dispose(); mutation(); flush();
    assert.equal(f.state.draft, '', 'disposal cancels a pending fill');
    assert.deepEqual(errors, []);
  } finally {
    port.dispose();
    Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: priorObserver });
  }
});
