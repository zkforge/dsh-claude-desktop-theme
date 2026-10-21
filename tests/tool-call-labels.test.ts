import assert from 'node:assert/strict';
import { test } from 'node:test';
import { englishToolLabel, mountToolCallLabels } from '../src/client/compat/tool-call-labels.ts';

test('only known interface labels are translated, never paths or generated descriptions', () => {
  assert.equal(englishToolLabel('思考'), 'Thought');
  assert.equal(englishToolLabel('思考', true), 'Thinking');
  assert.equal(englishToolLabel('查找文件'), 'Find files');
  assert.equal(englishToolLabel('加载技能'), 'Skill');
  for (const text of ['scratch/思考.txt', '查看生成的文件', 'Show working directory and list files', '']) {
    assert.equal(englishToolLabel(text), undefined);
  }
});

test('English title siblings follow native changes and restore original nodes on disposal', async () => {
  const previous = globalThis.MutationObserver;
  let notify: (records: unknown[]) => void = () => {};
  globalThis.MutationObserver = class {
    constructor(callback: typeof notify) { notify = callback; }
    observe() {}
    disconnect() {}
  } as unknown as typeof MutationObserver;
  const attributes = new Map<string, string>([['class', 'host_title']]);
  const views: { textContent: string; nextElementSibling: unknown; removed: boolean }[] = [];
  let running = true;
  const parent = { insertBefore(view: typeof views[number], target: unknown) { view.nextElementSibling = target; } };
  const scope = { querySelectorAll: () => [source] };
  const source = {
    nodeType: 1, isConnected: true, parentElement: parent, textContent: '思考',
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    hasAttribute: (name: string) => attributes.has(name),
    querySelectorAll: () => [],
    closest: (selector: string) => selector.includes('data-chat-flow-kind') ? scope
      : selector === '[data-disclosure-row]' ? parent
        : selector === '[data-variant="think"]' ? { getAttribute: () => running ? 'running' : 'ok' } : null,
  };
  const body = { closest: () => null, querySelectorAll: () => [scope], nodeType: 1 };
  const errors: unknown[] = [];
  const dispose = mountToolCallLabels({ body, createElement() {
    const view = { textContent: '', nextElementSibling: null as unknown, removed: false,
      setAttribute() {}, remove() { this.removed = true; } };
    views.push(view); return view;
  } } as unknown as Document, error => errors.push(error));
  const deliver = async () => {
    notify([{ target: source, addedNodes: [] }]); await Promise.resolve();
  };
  try {
    assert.equal(views[0]?.textContent, 'Thinking');
    assert.equal(source.textContent, '思考');
    assert.ok(attributes.has('data-ccd-english-source'));
    running = false; await deliver();
    assert.equal(views[0]?.textContent, 'Thought');
    assert.equal(views.length, 1);
    source.textContent = '查找文件'; await deliver();
    assert.equal(views[0]?.textContent, 'Find files');
    attributes.set('data-ccd-file-title-source', ''); await deliver();
    assert.equal(views[0]?.removed, true);
    assert.equal(attributes.has('data-ccd-english-source'), false);
    attributes.delete('data-ccd-file-title-source'); await deliver();
    assert.equal(views[1]?.textContent, 'Find files');
    source.textContent = 'Generated description'; await deliver();
    assert.equal(views[1]?.removed, true);
    source.textContent = '加载技能'; await deliver();
    assert.equal(views[2]?.textContent, 'Skill');
    dispose();
    assert.equal(views[2]?.removed, true);
    assert.equal(attributes.has('data-ccd-english-source'), false);
    assert.equal(source.textContent, '加载技能');
    assert.deepEqual(errors, []);
  } finally { dispose(); globalThis.MutationObserver = previous; }
});
