import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountHeaderMenus } from '../src/client/compat/header-menus.ts';
import { HOST } from '../src/client/compat/host-dom.ts';

test('header menus skip transcript churn and still follow catalog changes and header replacements', () => {
  const previousObserver = globalThis.MutationObserver;
  let mutate = (_records: MutationRecord[]) => {}, notify = () => {};
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { mutate = callback; }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  const create = () => {
    const attributes = new Map<string, string>();
    let hidden = false, writes = 0;
    return {
      isConnected: true, textContent: '', innerHTML: '', title: '', type: '',
      get hidden() { return hidden; },
      set hidden(next: boolean) { writes++; hidden = next; },
      get hiddenWrites() { return writes; },
      setAttribute(name: string, value: string) { attributes.set(name, value); },
      removeAttribute(name: string) { attributes.delete(name); },
      hasAttribute: (name: string) => attributes.has(name),
      addEventListener() {}, removeEventListener() {},
      querySelectorAll: () => [],
      prepend() {}, append() {}, after() {},
      remove() { this.isConnected = false; },
    };
  };
  const nav = create();
  let sessionId = 'a', path = '/projects/theme', present = true, reads = 0, scans = 0;
  const root = { querySelector: () => ({ getAttribute: () => sessionId }) };
  const header = {
    isConnected: true,
    closest: () => root,
    contains: (node: unknown) => node === header || node === nav,
    matches: (selector: string) => selector === HOST.conversationHeader,
    querySelector: (selector: string) => selector === 'nav' ? nav : null,
  };
  const created: ReturnType<typeof create>[] = [];
  const listeners = new Set<string>();
  const doc = {
    documentElement: {},
    defaultView: { addEventListener: (type: string) => listeners.add(type), removeEventListener: (type: string) => listeners.delete(type) },
    querySelector: () => null,
    querySelectorAll: () => { scans++; return present ? [header] : []; },
    createElement: () => { const node = create(); created.push(node); return node; },
    addEventListener() {}, removeEventListener() {},
  } as unknown as Document;
  const errors: unknown[] = [];
  const readIds: string[] = [];
  try {
    const dispose = mountHeaderMenus(doc, {
      read(id) { reads++; readIds.push(id); return { title: 'Title', folder: 'theme', path }; },
      rename: async () => {}, fork: async () => {}, archive: async () => {},
      subscribe(listener) { notify = listener; return () => { notify = () => {}; }; },
    }, error => errors.push(error));
    assert.equal(reads, 1);
    const scansBefore = scans;
    for (let index = 0; index < 30; index++) mutate([{
      type: 'childList', target: {}, addedNodes: [{ nodeType: 3 }], removedNodes: [],
    } as unknown as MutationRecord]);
    assert.equal(reads, 1, 'streaming does not re-read session or workspace catalogs');
    assert.equal(scans, scansBefore, 'streaming does not re-scan headers');
    const project = created.find(node => node.hasAttribute('data-ccd-project-trigger'))!;
    path = ''; notify();
    assert.equal(project.hidden, true);
    const writes = project.hiddenWrites;
    notify();
    assert.equal(project.hiddenWrites, writes, 'unchanged project visibility produces no attribute churn');
    sessionId = 'b';
    mutate([{ type: 'attributes', attributeName: 'data-conversation-session', target: root } as unknown as MutationRecord]);
    assert.equal(readIds.at(-1), 'b');
    present = false; header.isConnected = false;
    mutate([{ type: 'childList', target: {}, addedNodes: [], removedNodes: [header] } as unknown as MutationRecord]);
    assert.equal(nav.hasAttribute('data-ccd-session-title'), false);
    assert.equal(project.isConnected, false);
    present = true; header.isConnected = true;
    mutate([{ type: 'childList', target: {}, addedNodes: [{ ...header, nodeType: 1 }], removedNodes: [] } as unknown as MutationRecord]);
    assert.equal(nav.hasAttribute('data-ccd-session-title'), true, 'a newly inserted header is discovered synchronously');
    dispose();
    assert.equal(nav.hasAttribute('data-ccd-session-title'), false);
    assert.equal(listeners.size, 0);
    assert.deepEqual(errors, []);
  } finally { globalThis.MutationObserver = previousObserver; }
});
