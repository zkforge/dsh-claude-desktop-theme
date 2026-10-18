import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountSidebarActionAlignment } from '../src/client/compat/sidebar-action-alignment.ts';
import { mountOpenTargetMode } from '../src/client/compat/open-target.ts';
import { HOST } from '../src/client/compat/host-dom.ts';

test('sidebar alignment coalesces relevant mutations, ignores streaming and cancels pending work', () => {
  const oldMutation = globalThis.MutationObserver, oldResize = globalThis.ResizeObserver;
  let mutate = (_records: MutationRecord[]) => {}, resize = () => {};
  const observed = new Set<unknown>();
  globalThis.MutationObserver = class {
    constructor(callback: (records: MutationRecord[]) => void) { mutate = callback; }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) { resize = callback; }
    observe(node: unknown) { observed.add(node); }
    unobserve(node: unknown) { observed.delete(node); }
    disconnect() { observed.clear(); }
  } as unknown as typeof ResizeObserver;
  let reads = 0, right = 190, id = 0;
  const header = { style: { paddingRight: '4px' }, getBoundingClientRect: () => { reads++; return { width: 200, right: 200 }; } };
  const row = { getBoundingClientRect: () => { reads++; return { width: 180, right }; } };
  let currentRow: typeof row | null = row;
  const sidebar = {
    isConnected: true,
    contains: (node: unknown) => node === sidebar || node === header || node === row,
    querySelector: (selector: string) => selector === HOST.browserSectionHeader ? header : currentRow,
  };
  const frames = new Map<number, FrameRequestCallback>();
  const doc = {
    documentElement: {}, querySelector: () => null,
    querySelectorAll: () => [sidebar],
    defaultView: {
      requestAnimationFrame(callback: FrameRequestCallback) { frames.set(++id, callback); return id; },
      cancelAnimationFrame(handle: number) { frames.delete(handle); },
    },
  } as unknown as Document;
  const paint = () => { for (const [handle, callback] of [...frames]) { frames.delete(handle); callback(16); } };
  try {
    const dispose = mountSidebarActionAlignment(doc);
    assert.equal(header.style.paddingRight, '10px');
    assert.equal(reads, 2, 'each box is read once');
    mutate([{ type: 'childList', target: {}, addedNodes: [{ nodeType: 3 }], removedNodes: [] } as unknown as MutationRecord]);
    assert.equal(frames.size, 0, 'transcript text does not schedule sidebar work');
    right = 180;
    for (let index = 0; index < 30; index++) {
      mutate([{ type: 'childList', target: sidebar, addedNodes: [], removedNodes: [] } as unknown as MutationRecord]);
      resize();
    }
    assert.equal(frames.size, 1);
    paint();
    assert.equal(reads, 4, 'a burst performs one geometry pass');
    assert.equal(header.style.paddingRight, '20px');
    currentRow = null;
    resize(); paint();
    assert.equal(observed.size, 0, 'obsolete anchors are unobserved even if still connected');
    assert.equal(header.style.paddingRight, '4px');
    currentRow = row;
    resize(); paint();
    resize();
    dispose();
    assert.equal(frames.size, 0);
    assert.equal(observed.size, 0);
    assert.equal(header.style.paddingRight, '4px');
  } finally {
    globalThis.MutationObserver = oldMutation; globalThis.ResizeObserver = oldResize;
  }
});

test('open-target restores replaced children and releases removed direct anchors immediately', () => {
  const oldMutation = globalThis.MutationObserver;
  let mutate = () => {};
  globalThis.MutationObserver = class {
    constructor(callback: () => void) { mutate = callback; }
    observe() {} disconnect() {}
  } as unknown as typeof MutationObserver;
  const node = () => {
    const attributes = new Map<string, string>();
    let writes = 0;
    return {
      get writes() { return writes; },
      getAttribute: (name: string) => attributes.get(name) ?? null,
      setAttribute(name: string, value: string) { writes++; attributes.set(name, value); },
      removeAttribute: (name: string) => { attributes.delete(name); },
    };
  };
  const main = node(), first = node();
  first.setAttribute('title', 'Original application');
  let chevron: ReturnType<typeof node> | null = first;
  const anchor = { ...node(), querySelector: (selector: string) => selector === HOST.openTargetChevron ? chevron : main };
  let anchors = [anchor];
  const doc = {
    documentElement: { lang: 'en' }, querySelector: () => null, querySelectorAll: () => anchors,
  } as unknown as Document;
  const errors: unknown[] = [];
  try {
    const dispose = mountOpenTargetMode(doc, error => errors.push(error));
    assert.equal(first.getAttribute('title'), 'Choose how to open');
    assert.equal(main.getAttribute('tabindex'), '-1');
    const second = node(); chevron = second;
    mutate();
    assert.equal(first.getAttribute('title'), 'Original application');
    assert.equal(first.getAttribute('aria-label'), null);
    assert.equal(second.getAttribute('title'), 'Choose how to open');
    const writes = second.writes;
    mutate();
    assert.equal(second.writes, writes, 'unchanged names do not write DOM again');
    chevron = null; mutate();
    assert.equal(main.getAttribute('tabindex'), null);
    assert.equal(second.getAttribute('title'), null);
    assert.equal(anchor.getAttribute('data-ccd-open-mode'), 'direct');
    anchors = []; mutate();
    assert.equal(anchor.getAttribute('data-ccd-open-mode'), null, 'direct anchors are released without waiting for unload');
    dispose();
    assert.deepEqual(errors, []);
  } finally { globalThis.MutationObserver = oldMutation; }
});
