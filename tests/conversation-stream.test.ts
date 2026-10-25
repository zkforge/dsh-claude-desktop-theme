import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountConversationStream, streamingAppendStart } from '../src/client/compat/conversation-stream.ts';

test('stream entrances follow append-only text, including Chinese and split surrogate pairs', () => {
  assert.equal(streamingAppendStart('Hello', 'Hello world'), 5);
  assert.equal(streamingAppendStart('你好', '你好世界'), 2);
  assert.equal(streamingAppendStart('', 'first'), 0);
  assert.equal(streamingAppendStart('same', 'same'), null);
  assert.equal(streamingAppendStart('**bold', 'bold'), null, 'a Markdown reparse never replays the old words');
  assert.equal(streamingAppendStart('long text', 'short'), null);
  assert.equal(streamingAppendStart('x\uD83D', 'x😀'), 1);
});

test('unsupported renderers keep their native streaming untouched', () => {
  assert.doesNotThrow(() => mountConversationStream({ defaultView: {} } as Document, () => {
    assert.fail('missing optional Highlight API is not an error');
  })());
});
