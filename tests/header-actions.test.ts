import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { Context } from '@deepseek-ai/cordis';
import type { SidebarRightPort, SidebarTabRecord } from '../src/client/contracts/ports.ts';
import { headerLabels } from '../src/client/compat/header-labels.ts';
import { HOST } from '../src/client/compat/host-dom.ts';
import { mountOpenTargetMode } from '../src/client/compat/open-target.ts';
import { DSH_SLOTS, OVERRIDE_PRIORITY } from '../src/client/compat/slots.ts';
import { VIEWS, cornerRetirement, sidebarExpandRow, utilitiesEntry } from '../src/client/features/conversation/header-actions/entries.ts';
import { openView, resolveSidebarRight, resolveSidebarTabs } from '../src/client/features/conversation/header-actions/sidebar-view.ts';

/** Narrow element double: attributes only, like the renderer's own nodes. */
function element(initial: Record<string, string> = {}) {
  const attributes = new Map(Object.entries(initial));
  return {
    attributes,
    isConnected: true,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    removeAttribute: (name: string) => { attributes.delete(name); },
  };
}

/** Observer double recording the last instance so a test can force a pass. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  readonly callback: () => void;
  disconnected = false;
  constructor(callback: () => void) {
    this.callback = callback;
    FakeObserver.instances.push(this);
  }
  observe() {}
  disconnect() { this.disconnected = true; }
}

test('header labels follow the document language, not a borrowed namespace', () => {
  const document = (lang: string) => ({ documentElement: { lang } }) as unknown as Document;
  assert.equal(headerLabels(document('zh-CN')).terminal, '打开终端');
  assert.equal(headerLabels(document('zh-CN')).open, '选择打开方式');
  assert.equal(headerLabels(document('zh-CN')).files, '打开项目文件夹');
  assert.equal(headerLabels(document('zh-CN')).expand, '打开侧边栏');
  assert.equal(headerLabels(document('en-US')).terminal, 'Open terminal');
  assert.equal(headerLabels(document('en-US')).browser, 'Open browser');
  assert.equal(headerLabels(document('en-US')).files, 'Open project folder');
  assert.equal(headerLabels(document('en-US')).expand, 'Open sidebar');
});

test('the project folder follows the browser, before the session menu', () => {
  const opened: string[] = [];
  const labels = { terminal: '打开终端', browser: '打开浏览器', files: '打开项目文件夹' };
  const open = (kind: string, sessionId: string) => { opened.push(`${kind}:${sessionId}`); };

  const utilities = VIEWS.map(view => utilitiesEntry(view, labels, open));
  assert.deepEqual(
    utilities.map(entry => [entry.id, entry.order]),
    [['ccd-terminal', -3], ['ccd-browser', -2], ['ccd-folder', -1]],
  );
  const folder = utilities[2]?.inject('session-1');
  assert.deepEqual([folder?.kind, folder?.label], ['files', '打开项目文件夹']);
  folder?.open();
  assert.deepEqual(opened, ['files:session-1']);
});

test('the corner cell is retired below the shipped control’s own rank', () => {
  /* The single cell renders the lowest priority, so this is what keeps
     `ui-sidebar-right`'s expand control out of the header. */
  const corner = cornerRetirement();
  assert.equal(corner.name, DSH_SLOTS.sessionHeaderCorner);
  assert.equal(corner.priority, OVERRIDE_PRIORITY);
  assert.equal('id' in corner, false, 'a single cell carries no id');
});

test('the Session menu\u2019s expand row follows the panel\u2019s own state', () => {
  const calls: string[] = [];
  const collapsed = {
    querySelector: (selector: string) => (selector.includes('data-rightbar-collapsed') ? {} : null),
  } as unknown as Document;
  const expanded = { querySelector: () => null } as unknown as Document;
  const face = {
    openTab: () => {},
    focus: () => {},
    openTabs: { getSnapshot: () => [] },
    toggleExpanded: () => { calls.push('toggle'); },
  } as SidebarRightPort;
  const bare = { openTab: () => {}, focus: () => {}, openTabs: { getSnapshot: () => [] } } as SidebarRightPort;

  const row = sidebarExpandRow(face, collapsed, '打开侧边栏');
  assert.equal(row.label, '打开侧边栏');
  assert.equal(row.wanted(), true);
  row.act();
  assert.deepEqual(calls, ['toggle']);

  /* A panel that is already shown has nothing for the row to do, and a face
     without the method could not act at all. */
  assert.equal(sidebarExpandRow(face, expanded, '打开侧边栏').wanted(), false);
  assert.equal(sidebarExpandRow(bare, collapsed, '打开侧边栏').wanted(), false);
});

test('a header view focuses the Session\u2019s own tab and opens one otherwise', () => {
  const calls: string[] = [];
  const sidebar = (tabs: readonly SidebarTabRecord[] = []) => ({
    openTab: (kind: string) => { calls.push(`open:${kind}`); },
    focus: (tabId: string) => { calls.push(`focus:${tabId}`); },
    openTabs: { getSnapshot: () => tabs },
  }) as SidebarRightPort;

  openView(sidebar(), 'terminal', 'session-1');
  assert.deepEqual(calls, ['open:terminal']);

  calls.length = 0;
  openView(sidebar([{ sessionId: 'session-1', tabId: 'tab7', kind: 'terminal' }]), 'terminal', 'session-1');
  assert.deepEqual(calls, ['focus:tab7']);

  /* Another Session's tab is not this header's view of the kind. */
  calls.length = 0;
  openView(sidebar([{ sessionId: 'session-2', tabId: 'tab9', kind: 'terminal' }]), 'terminal', 'session-1');
  assert.deepEqual(calls, ['open:terminal']);

  /* A face without the inventory still opens the view. */
  calls.length = 0;
  const bare = { openTab: (kind: string) => { calls.push(`open:${kind}`); }, focus: () => {} } as unknown as SidebarRightPort;
  openView(bare, 'browser', 'session-1');
  assert.deepEqual(calls, ['open:browser']);
});

test('a partial right-Sidebar face yields no header views instead of a dead button', () => {
  const complete = {
    sidebarRight: { openTab: () => {}, focus: () => {} },
    sidebarRightTabs: { get: () => undefined },
  } as unknown as Context;
  assert.notEqual(resolveSidebarRight(complete), undefined);
  assert.notEqual(resolveSidebarTabs(complete), undefined);
  assert.equal(resolveSidebarRight({ sidebarRight: { openTab: () => {} } } as unknown as Context), undefined);
  assert.equal(resolveSidebarTabs({} as unknown as Context), undefined);
});

test('the open control is marked menu/direct and every written attribute is restored', () => {
  const originalObserver = globalThis.MutationObserver;
  FakeObserver.instances = [];
  globalThis.MutationObserver = FakeObserver as unknown as typeof MutationObserver;
  try {
    const anchor = element();
    const main = element({ 'aria-label': '用 VS Code 打开' });
    let chevron: ReturnType<typeof element> | null = element({ 'aria-label': '更多打开方式', title: '更多打开方式' });
    const document = {
      documentElement: { lang: 'zh-CN' },
      querySelectorAll: () => [anchor],
    };
    (anchor as Record<string, unknown>).querySelector = (selector: string) => {
      if (selector === HOST.openTargetChevron) return chevron;
      if (selector === HOST.openTargetMain) return main;
      return null;
    };

    const dispose = mountOpenTargetMode(document as unknown as Document, error => { throw error; });
    assert.equal(anchor.attributes.get('data-ccd-open-mode'), 'menu');
    assert.equal(chevron?.attributes.get('aria-label'), '选择打开方式');
    assert.equal(chevron?.attributes.get('title'), '选择打开方式');
    assert.equal(main.attributes.get('aria-hidden'), 'true');
    assert.equal(main.attributes.get('tabindex'), '-1');

    /* The host re-renders the chevron's own name; the next pass puts ours back. */
    chevron?.setAttribute('aria-label', '更多打开方式');
    FakeObserver.instances.at(-1)?.callback();
    assert.equal(chevron?.attributes.get('aria-label'), '选择打开方式');

    /* No menu: the glyph would promise a chooser, so the control hides. */
    chevron = null;
    (document.documentElement as { lang: string }).lang = 'en-US';
    FakeObserver.instances.at(-1)?.callback();
    assert.equal(anchor.attributes.get('data-ccd-open-mode'), 'direct');
    assert.equal(main.attributes.has('aria-hidden'), false);
    assert.equal(main.attributes.has('tabindex'), false);

    dispose();
    assert.equal(anchor.attributes.has('data-ccd-open-mode'), false);
    assert.equal(FakeObserver.instances.at(-1)?.disconnected, true);
  } finally {
    globalThis.MutationObserver = originalObserver;
  }
});

interface Rule {
  readonly selector: string;
  readonly body: string;
}

/** Flat `selector { body }` pairs; nested at-rule wrappers are skipped. */
function rules(sheet: string): Rule[] {
  const source = sheet.replace(/\/\*[\s\S]*?\*\//gu, '');
  return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map(([, selector, body]) => ({
    selector: (selector ?? '').trim().replace(/\s+/gu, ' '),
    body: body ?? '',
  }));
}

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const actions = rules(read('../src/client/features/conversation/header-actions/header-actions.css'));
const conversation = rules(read('../src/client/features/conversation/conversation.css'));
const newSession = rules(read('../src/client/features/new-session/new-session.css'));

test('the corner control paints the project folder, once', () => {
  const glyph = actions.filter(rule => rule.selector.includes('[data-ccd-header-view="files"]'));
  assert.equal(glyph.length, 1, 'one rule draws the corner mark');
  assert.match(glyph[0]?.body ?? '', /mask-image:\s*var\(--ccd-icon-folder\)/u);
  /* The workspace chip's own folder is the one glyph: no second folder artwork. */
  assert.match(read('../src/client/theme/tokens.css'), /--ccd-icon-folder:\s*url\("data:image\/svg/u);
});

test('the utilities seat sizes controls, never the tooltip bubble beside one', () => {
  const seats = conversation.filter(rule => rule.selector.includes('headerUtilities > [data-slot] > *'));
  assert.ok(seats.length >= 2, 'the box is sized at both cluster widths');
  for (const rule of seats) {
    /* `ui-primitives`' Tooltip renders its bubble as a sibling of the control it
       clones, so both nodes land in the seat: the box belongs to the control. */
    assert.ok(rule.selector.includes(':not([role="tooltip"])'), rule.selector);
    assert.match(rule.body, /width:\s*var\(--ccd-header-action/u);
  }
});

test('the corner seat is retired without a control left behind', () => {
  /* Nothing reaches for the shipped expand control's marker: its occupant is
     shadowed through the slot registry (`cornerRetirement`), which leaves no
     hidden button, no hover surface and no tooltip in the cell. */
  for (const rule of [...actions, ...conversation, ...newSession]) {
    assert.ok(!rule.selector.includes('data-sidebar-right-expand'), rule.selector);
  }
  /* The empty seat keeps no box of its own, so the utilities group ends where
     the reference measures the cluster's 12px inset. */
  const corner = conversation.filter(rule => rule.selector.endsWith('.ST7X_W_headerCorner'));
  assert.equal(corner.length, 1);
  assert.match(corner[0]?.body ?? '', /margin:\s*0;/u);
  /* A blank page renders neither the utilities group nor a corner control, so
     that row needs no rule of its own. */
  assert.ok(!newSession.some(rule => rule.selector.includes('data-conversation-header-corner')));
});

test('the cluster ends on the Composer where the Composer fills the column', () => {
  /* The design's 12px trailing inset is measured in a window whose column is
     wider than the Composer's 770px cap, so the Composer is centred inside the
     column and the two rows end in different places. Where the Composer fills
     the column instead — an expanded right panel leaves exactly that — the
     reference ends the cluster on the input surface's own right border, the
     line its closing ⋮ sits directly above. The padding is therefore the
     surface's edge, taken from the numbers that draw it, less half the closing
     control: the `min()` keeps the measured inset as the ceiling, so a wider
     side clearance in a deployment cannot push the cluster further in than the
     reference draws it. */
  const header = conversation.filter(rule => rule.selector.endsWith('.ST7X_W_header'));
  const edge = header.filter(rule => /--ccd-composer-trailing-edge:\s*calc\(/u.test(rule.body));
  assert.equal(edge.length, 1, 'the surface edge is declared once, on the header');
  assert.match(edge[0]?.body ?? '', /var\(--dsh-composer-side-clearance/u);
  assert.match(edge[0]?.body ?? '', /var\(--dsh-scrollbar-width/u);
  const alignment = header.filter(rule => /padding-right:\s*min\(/u.test(rule.body));
  assert.equal(alignment.length, 2, 'both cluster widths take the surface edge');
  for (const rule of alignment) {
    assert.match(rule.body, /min\(\s*var\(--ccd-header-trailing-inset\),/u);
    assert.match(rule.body, /var\(--ccd-composer-trailing-edge\)/u);
  }
  assert.equal(alignment.filter(rule => /--ccd-header-action-compact/u.test(rule.body)).length, 1);
  /* One inset, not two: the replaced `--ccd-header-trailing-inset-compact` is
     gone from the token sheet, so no rule can drift back to a second value. */
  assert.ok(!read('../src/client/theme/tokens.css').includes('--ccd-header-trailing-inset-compact'));
});

test('the three views and the title step aside only for the switcher still in the row', () => {
  /* The switcher is normally parked in the sidebar's window-control row
     (`compat/view-switch.ts` marks the tablist with `data-ccd-view-dock`), and
     the header row is then the title, the team chip and the cluster — the three
     views and the title fit every width that state can leave (the frame
     protects a 400px floor for this column while the right panel is open), and
     with the right panel expanded the views are the only way back to its other
     tabs. With the switcher still in the row (a Windows build, or a collapsed
     macOS sidebar) there are four pieces on the line, and the plugin's own three
     views and the title are the ones that go — the native team chip keeps its
     full label either way. */
  const hidden = conversation.filter(rule => rule.body.includes('display: none')
    && rule.selector.includes('[data-ccd-header-view]'));
  assert.equal(hidden.length, 1, 'one rule withdraws the views');
  const selector = hidden[0]?.selector ?? '';
  assert.ok(selector.includes(':has(.ST7X_W_tabs:not([data-ccd-view-dock]))'), selector);
  assert.ok(selector.includes('.ST7X_W_headerUtilities'), selector);
  /* The title is the piece that still yields at that width — to that same
     switcher, so a parked one leaves the title on the line — and the team chip
     keeps its own label: nothing hides the crumbs outside the narrow block, and
     no rule hides the chip. */
  const crumbs = conversation.filter(rule => rule.selector.endsWith('.ST7X_W_crumbs') && rule.body.includes('display: none'));
  assert.equal(crumbs.length, 1, 'the title yields once');
  const titleSelector = crumbs[0]?.selector ?? '';
  assert.ok(titleSelector.includes(':has(.ST7X_W_tabs:not([data-ccd-view-dock]))'), titleSelector);
  assert.ok(!conversation.some(rule => rule.selector.includes('_2tNPVa_triggerLabel') && rule.body.includes('display: none')));
});
