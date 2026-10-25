import type { Disposer } from '../contracts/ports.ts';
import { paneIcon } from './pane-icons.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsIntroduce, recordsTouch } from './mutation-scope.ts';
import { paneLabels, paneLanguage, type FilesPaneLabels, type PaneLanguage } from './pane-labels.ts';

/**
 * The Files pane's own three controls, and the empty column beside it
 * (DESIGN.md §6.9).
 *
 * `right-panel.css` dresses what the host draws. Three things the reference
 * draws have nothing in the host's pane to dress, so this module supplies them
 * as nodes the sheet styles, and keeps them in place across React's renders:
 *
 * **The filter field.** The host's `FilesBody` header is a root path with a
 * reload and the open-in-app actions after it — there is no filter in the
 * package at all. The reference's pane leads with a rounded field over the tree
 * and nothing else, so the field takes the path's seat (the sheet hides the
 * label) and the host's own controls keep theirs at the row's end. Typing
 * filters the *loaded* rows by name: a row stays when its own name contains the
 * query or when it is an ancestor of a row that does. The host lists a
 * directory only once it is expanded, so a filtered tree can only narrow what
 * the reader has already opened — the reference searches its session on the
 * server, which this interface has no face for.
 *
 * **The tree's show / hide control.** The reference's own pane hides its file
 * tree from a control on the divider between its two columns and, once hidden,
 * leaves a small affordance at the pane's leading edge to bring it back. This
 * pane has one column, so the control lives in the header line: {@link
 * TOGGLE_ATTRIBUTE} marks the button, {@link TREE_ATTRIBUTE} on the root carries
 * the state, and the sheet swaps the rows for {@link EXPAND_ATTRIBUTE}'s row
 * while the tree is away.
 *
 * **The Files tab's mark.** The host's tab title draws a category-coloured
 * folder; the reference draws a three-row list on a tinted square. The mark
 * cannot be drawn on the host's glyph — a mask would clip the square with it —
 * so {@link TAB_ATTRIBUTE} marks the Files tab, {@link MARK_ATTRIBUTE} is the
 * node that takes the glyph's seat, and the sheet paints both.
 *
 * The empty column is DockKit's, not the Files package's: a dock column no tab
 * has claimed shows one line of the host's copy. The reference's landing state
 * is a folder over a title and a line of guidance, so the host's line is marked
 * ({@link EMPTY_SOURCE_ATTRIBUTE}) and left in the document, and a block this
 * module writes ({@link EMPTY_ATTRIBUTE}) is what the column draws.
 *
 * Everything written here lands on host nodes as `data-ccd-files-*` markers or
 * as plugin-owned nodes beside them, and the disposer takes all of it back.
 * The module shares the right-panel feature lifetime with its stylesheet,
 * so disabling that feature removes every enhancement before its styles.
 */

/** The state of the tree, written on the Files root: `hidden` or absent. */
export const TREE_ATTRIBUTE = 'data-ccd-files-tree';

/** Marks a row the filter excludes; the sheet does not draw it. */
export const ROW_ATTRIBUTE = 'data-ccd-files-hidden';

/** Marks the Files tab in the panel's strip. */
export const TAB_ATTRIBUTE = 'data-ccd-files-tab';

/** The filter field's own box, and the input inside it. */
export const FIELD_ATTRIBUTE = 'data-ccd-files-filter';

/** The filter's clear control. */
export const CLEAR_ATTRIBUTE = 'data-ccd-files-clear';

/** The header's tree show / hide control, and the pane's own re-open row. */
export const TOGGLE_ATTRIBUTE = 'data-ccd-files-toggle';
export const EXPAND_ATTRIBUTE = 'data-ccd-files-expand';

/** The Files tab's mark, in the seat the host's file-type glyph had. */
export const MARK_ATTRIBUTE = 'data-ccd-files-mark';

/** The empty column's block, and the host line it stands in for. */
export const EMPTY_ATTRIBUTE = 'data-ccd-files-empty';
export const EMPTY_SOURCE_ATTRIBUTE = 'data-ccd-files-empty-source';

/** One empty column's three parts. */
export const EMPTY_MARK_ATTRIBUTE = 'data-ccd-files-empty-mark';
export const EMPTY_TITLE_ATTRIBUTE = 'data-ccd-files-empty-title';
export const EMPTY_BODY_ATTRIBUTE = 'data-ccd-files-empty-body';

/** The line a query that matched nothing leaves under the list. */
export const NOMATCH_ATTRIBUTE = 'data-ccd-files-nomatch';

/** One Files pane and everything this module put in it. */
interface Pane {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly field: HTMLElement;
  readonly input: HTMLInputElement;
  readonly clear: HTMLButtonElement;
  readonly expand: HTMLButtonElement;
  readonly noMatch: HTMLElement;
  readonly landing: HTMLElement;
  readonly key: string;
  /** The language the pane's own words are written in (see `pane-labels.ts`). */
  language: PaneLanguage;
  /** Those words; rewritten when the document's language changes. */
  labels: FilesPaneLabels;
  query: string;
}

/** The last segment of a listed path, which is the name the row draws. */
function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The nearest entry row above `node`, or null at the level's root. */
function enclosingRow(node: Element): Element | null {
  return node.parentElement?.closest('[data-files-entry]') ?? null;
}

/**
 * The header line of one Files pane: the host's own row, which is the root's
 * only child that is not the scrolling body.
 * @param root - the `[data-files-root]` element.
 * @returns the header, or null while the host has not drawn one yet.
 */
function headerOf(root: HTMLElement): HTMLElement | null {
  for (const child of root.children) {
    if (!child.hasAttribute('data-files-body')) return child as HTMLElement;
  }
  return null;
}

/** One small button carrying a mask, the shape the pane's sheet expects. */
function iconButton(document: Document, attribute: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute(attribute, '');
  return button;
}

/** The field, its input and its clear control, in the order the reference draws. */
function buildField(document: Document): { field: HTMLElement; input: HTMLInputElement; clear: HTMLButtonElement } {
  const field = document.createElement('span');
  field.setAttribute(FIELD_ATTRIBUTE, '');
  const input = document.createElement('input');
  input.type = 'text';
  input.spellcheck = false;
  input.autocomplete = 'off';
  const clear = iconButton(document, CLEAR_ATTRIBUTE);
  clear.hidden = true;
  const search = document.createElement('span');
  search.setAttribute('data-ccd-files-search-icon', '');
  search.setAttribute('aria-hidden', 'true');
  search.innerHTML = paneIcon('Search');
  field.append(search, input, clear);
  return { field, input, clear };
}

/** The landing state one empty dock column draws; its two lines come from {@link writeEmpty}. */
function buildEmpty(document: Document): HTMLElement {
  const block = document.createElement('div');
  block.setAttribute(EMPTY_ATTRIBUTE, '');
  const mark = document.createElement('span');
  mark.setAttribute(EMPTY_MARK_ATTRIBUTE, '');
  mark.innerHTML = paneIcon('Folder');
  const title = document.createElement('p');
  title.setAttribute(EMPTY_TITLE_ATTRIBUTE, '');
  const body = document.createElement('p');
  body.setAttribute(EMPTY_BODY_ATTRIBUTE, '');
  block.append(mark, title, body);
  return block;
}

/**
 * Mount the Files pane's filter field, its tree control, its tab mark and the
 * empty column beside it.
 *
 * @param document - renderer document carrying the interface.
 * @param report - sink for observer failures; the host's own pane stays usable.
 * @returns disposer that removes every node, marker and listener added here.
 */
export function mountFilesPane(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const panes = new Map<HTMLElement, Pane>();
  const preferences = new Map<string, { query: string; hidden: boolean }>();
  /** Our block per empty column, and the host line it replaces. */
  const empties = new Map<HTMLElement, HTMLElement>();
  /** Our tab mark per panel tab, and the tab it belongs to. */
  const marks = new Map<HTMLElement, HTMLElement>();

  /** One control's two names, for the copy written by {@link applyCopy}. */
  const name = (element: HTMLElement, label: string) => {
    if (element.getAttribute('aria-label') !== label) element.setAttribute('aria-label', label);
    if (element.title !== label) element.title = label;
  };

  /** One line of this module's own copy, rewritten only when the word changes:
   *  the pass runs from a mutation observer, so an unchanged write would feed
   *  the observer its own notifications. */
  const text = (element: Element | null, value: string) => {
    if (element !== null && element.textContent !== value) element.textContent = value;
  };

  /** The landing state's two lines, for one block {@link buildEmpty} drew. */
  const writeEmpty = (block: HTMLElement, labels: FilesPaneLabels) => {
    text(block.querySelector(`[${EMPTY_TITLE_ATTRIBUTE}]`), labels.emptyTitle);
    text(block.querySelector(`[${EMPTY_BODY_ATTRIBUTE}]`), labels.emptyBody);
  };

  /** The tree control's words follow the tree's state, never the other way. */
  const labelToggle = (pane: Pane) => {
    const hidden = pane.root.hasAttribute(TREE_ATTRIBUTE);
    pane.toggle.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    name(pane.toggle, hidden ? pane.labels.show : pane.labels.hide);
  };

  /**
   * Write the pane's copy in the document's language onto its own nodes. The
   * host's words are elsewhere; only this module's field, controls and landing
   * state are written, and a language switch rewrites them in place.
   */
  const applyCopy = (pane: Pane) => {
    pane.language = paneLanguage(document);
    pane.labels = paneLabels(pane.language).files;
    if (pane.input.placeholder !== pane.labels.filter) pane.input.placeholder = pane.labels.filter;
    name(pane.input, pane.labels.filterLabel);
    name(pane.clear, pane.labels.clear);
    name(pane.expand, pane.labels.show);
    text(pane.expand, pane.labels.show);
    labelToggle(pane);
    text(pane.noMatch, pane.labels.noMatch);
    writeEmpty(pane.landing, pane.labels);
  };

  /** Show or hide the tree, and keep its two controls in step with the state. */
  const setTree = (pane: Pane, hidden: boolean) => {
    if (hidden) pane.root.setAttribute(TREE_ATTRIBUTE, 'hidden');
    else pane.root.removeAttribute(TREE_ATTRIBUTE);
    labelToggle(pane);
    preferences.set(pane.key, { query: pane.query, hidden });
    /* The floating scroll pill follows a surface's box, and this one has just
       stopped being laid out; a resize is the signal that module already
       listens for, so the pane does not reach into it. */
    window.dispatchEvent(new Event('resize'));
  };

  /**
   * Narrow the pane's loaded rows to the query: a row stays when its own name
   * contains it, or when it is an ancestor of a row that does. Directories are
   * listed lazily, so a match inside a closed directory is not known yet and
   * the query can only narrow what is open.
   */
  const applyFilter = (pane: Pane) => {
    const query = pane.query.trim().toLowerCase();
    const rows = [...pane.body.querySelectorAll<HTMLElement>('[data-files-entry]')];
    /* Only the difference is written. The pass runs on every structural
       mutation batch — a streaming transcript included — so re-marking rows
       that already carry the answer would both cost that many attribute writes
       and feed the observer its own notifications. */
    const mark = (row: HTMLElement, hidden: boolean) => {
      if (row.hasAttribute(ROW_ATTRIBUTE) === hidden) return;
      if (hidden) row.setAttribute(ROW_ATTRIBUTE, '');
      else row.removeAttribute(ROW_ATTRIBUTE);
    };
    if (query === '') {
      for (const row of rows) mark(row, false);
      if (!pane.noMatch.hidden) pane.noMatch.hidden = true;
      return;
    }
    const visible = new Set<Element>();
    let hits = 0;
    for (const row of rows) {
      const name = basename(row.getAttribute('data-files-path') ?? '').toLowerCase();
      if (!name.includes(query)) continue;
      hits++;
      for (let node: Element | null = row; node !== null; node = enclosingRow(node)) visible.add(node);
    }
    for (const row of rows) mark(row, !visible.has(row));
    pane.noMatch.hidden = hits > 0;
  };

  /** Put one query on the field, the clear control and the rows together. */
  const setQuery = (pane: Pane, query: string) => {
    pane.query = query;
    preferences.set(pane.key, { query, hidden: pane.root.hasAttribute(TREE_ATTRIBUTE) });
    if (pane.input.value !== query) pane.input.value = query;
    pane.clear.hidden = query === '';
    applyFilter(pane);
  };

  const adopt = (root: HTMLElement, body: HTMLElement) => {
    const header = headerOf(root);
    if (header === null) return;
    const toggle = iconButton(document, TOGGLE_ATTRIBUTE);
    const { field, input, clear } = buildField(document);
    const expand = iconButton(document, EXPAND_ATTRIBUTE);
    const noMatch = document.createElement('p');
    noMatch.setAttribute(NOMATCH_ATTRIBUTE, '');
    noMatch.hidden = true;
    /* The host lays the header out left to right and the reference leads with
       them, so both controls go in front of the path label's seat. */
    header.prepend(field);
    header.prepend(toggle);
    body.append(noMatch);
    root.append(expand);
    const landing = buildEmpty(document);
    landing.removeAttribute(EMPTY_ATTRIBUTE);
    landing.setAttribute('data-ccd-files-landing', '');
    root.append(landing);
    const key = `${root.closest('[data-sidebar-right-session]')?.getAttribute('data-sidebar-right-session')}:${root.closest('[data-dockkit-content]')?.getAttribute('data-dockkit-content')}`;
    const saved = preferences.get(key);
    const language = paneLanguage(document);
    const pane: Pane = {
      root,
      body,
      toggle,
      field,
      input,
      clear,
      expand,
      noMatch,
      landing,
      key,
      language,
      labels: paneLabels(language).files,
      query: saved?.query ?? '',
    };
    panes.set(root, pane);
    applyCopy(pane);
    input.addEventListener('input', () => setQuery(pane, input.value));
    input.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || input.value === '') return;
      event.stopPropagation();
      setQuery(pane, '');
    });
    clear.addEventListener('click', () => {
      setQuery(pane, '');
      input.focus();
    });
    toggle.addEventListener('click', () => {
      setTree(pane, !root.hasAttribute(TREE_ATTRIBUTE));
    });
    expand.addEventListener('click', () => {
      setTree(pane, false);
      toggle.focus();
    });
    setTree(pane, saved?.hidden ?? false);
    setQuery(pane, saved?.query ?? '');
  };

  const release = (pane: Pane) => {
    pane.toggle.remove();
    pane.field.remove();
    pane.expand.remove();
    pane.noMatch.remove();
    pane.landing.remove();
    pane.root.removeAttribute(TREE_ATTRIBUTE);
    for (const row of pane.body.querySelectorAll(`[${ROW_ATTRIBUTE}]`)) row.removeAttribute(ROW_ATTRIBUTE);
    panes.delete(pane.root);
  };

  /** The Files tab of the pane this tree sits in, marked and given its mark. */
  const adoptTab = (root: HTMLElement) => {
    const pane = root.closest<HTMLElement>('[data-dockkit-pane], [data-dockkit-float]');
    const tab = pane?.hasAttribute('data-dockkit-float')
      ? pane.querySelector<HTMLElement>('[data-dockkit-float-title]') ?? null
      : pane?.querySelector<HTMLElement>('[data-dockkit-tab][aria-selected="true"]') ?? null;
    const title = tab?.querySelector<HTMLElement>('[data-dockkit-tab-title]') ?? null;
    if (tab === null || title === null) return;
    tab.setAttribute(TAB_ATTRIBUTE, '');
    let mark = marks.get(tab);
    if (mark === undefined) {
      mark = document.createElement('span');
      mark.setAttribute(MARK_ATTRIBUTE, '');
      mark.setAttribute('aria-hidden', 'true');
      marks.set(tab, mark);
    }
    if (title.firstElementChild !== mark) title.prepend(mark);
  };

  /** One empty dock column: the host's line marked, the reference's block in. */
  const adoptEmpty = (pane: Element) => {
    /* The column's only paragraph is the host's own line; DockKit nests its
       boxes differently in a floating pane than in a docked one, so the box the
       block goes into is read off the line rather than assumed. */
    const line = pane.querySelector<HTMLElement>('p');
    const body = line?.parentElement ?? null;
    if (line === null || body === null) return;
    line.setAttribute(EMPTY_SOURCE_ATTRIBUTE, '');
    let block = empties.get(line);
    if (block === undefined) {
      block = buildEmpty(document);
      empties.set(line, block);
    }
    if (block.parentElement !== body) body.append(block);
    writeEmpty(block, paneLabels(paneLanguage(document)).files);
  };

  /* The boxes this module dresses, for the batch predicate only. The empty
     column keeps the host's own nesting: only a right panel's empty column
     gets the landing state, never another DockKit surface's. */
  const REGION_SELECTOR = [host.filesRoot, host.rightbarPanel].join(', ');
  const ARRIVAL_SELECTOR = [host.rightbarPanel, host.filesRoot, host.dockEmpty].join(', ');
  /* One descendant chain, exactly as the host nests it: only a dock pane
     inside a right panel's empty column is dressed. */
  const EMPTY_SELECTOR = `${host.rightbarPanel} ${host.dockEmpty} ${host.dockPane}`;
  /** Every box this module dresses, kept so a batch can be judged against them. */
  let regions: HTMLElement[] = [];
  const collectRegions = () => {
    /* Already adopted panes come first: a batch that says nothing about the
       trees they sit in still has to reach the row copy and the empty block. */
    const found = new Set<HTMLElement>();
    for (const pane of panes.values()) found.add(pane.root);
    for (const root of document.querySelectorAll<HTMLElement>(REGION_SELECTOR)) found.add(root);
    for (const root of document.querySelectorAll<HTMLElement>(ARRIVAL_SELECTOR)) found.add(root);
    regions = [...found];
  };
  /**
   * Whether a batch can change what this module writes.
   *
   * The panes, their tabs and the empty dock columns are the only places it
   * touches; everything else the body reports — a streaming transcript, the
   * sidebar, a conversation's own menus — cannot. An insertion that creates one
   * of those boxes is relevant too, which is also how a right panel that
   * arrives empty reaches the pass.
   */
  const relevant = (records: readonly MutationRecord[]): boolean => {
    if (regions.length === 0) return true;
    for (const region of regions) if (recordsTouch(records, region)) return true;
    return recordsIntroduce(records, ARRIVAL_SELECTOR);
  };
  const sync = () => {
    collectRegions();
    for (const pane of [...panes.values()]) {
      if (!pane.root.isConnected || pane.body !== pane.root.querySelector(host.filesBody)
        || pane.field.parentElement !== headerOf(pane.root)) release(pane);
    }
    /* The host points `<html lang>` at the locale and re-points it on a locale
       change, so a pane already on screen takes its copy from the language it
       now finds there rather than the one it was mounted in. */
    const language = paneLanguage(document);
    for (const pane of panes.values()) if (pane.language !== language) applyCopy(pane);
    for (const root of document.querySelectorAll<HTMLElement>(host.filesRoot)) {
      const body = root.querySelector<HTMLElement>(host.filesBody);
      if (body === null) continue;
      if (!panes.has(root)) adopt(root, body);
      adoptTab(root);
    }
    /* A level the reader expanded arrives as new rows, so a live query is
       applied again on every pass rather than only when it is typed. Without
       one there is nothing to undo — a fresh row carries no mark — and the
       observer sees every streaming token in the transcript, so the pass is
       skipped. */
    for (const pane of panes.values()) {
      if (pane.query.trim() === '' && pane.noMatch.hidden) continue;
      applyFilter(pane);
    }
    for (const line of [...empties.keys()]) {
      if (!line.isConnected) {
        empties.get(line)?.remove();
        empties.delete(line);
      }
    }
    for (const [tab, mark] of [...marks]) {
      if (!tab.isConnected) {
        mark.remove();
        marks.delete(tab);
        continue;
      }
      if (!tab.hasAttribute(TAB_ATTRIBUTE)) tab.setAttribute(TAB_ATTRIBUTE, '');
    }
    /* Only the right panel's columns are dressed: the empty pane's block is
       this interface's own surface, and `right-panel.css` states it inside the
       card. Another DockKit host in the document keeps the host's own line. */
    for (const pane of document.querySelectorAll<HTMLElement>(EMPTY_SELECTOR)) adoptEmpty(pane);
  };

  let observer: MutationObserver | undefined;
  try {
    observer = new MutationObserver(records => {
      if (relevant(records)) sync();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    /* `<html lang>` is the one attribute this pass reads that body mutations
       cannot report; it sits outside the body, so it gets its own observation. */
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    sync();
  } catch (error) {
    observer?.disconnect();
    for (const pane of [...panes.values()]) release(pane);
    for (const block of empties.values()) block.remove();
    for (const mark of marks.values()) mark.remove();
    report(error);
    return () => {};
  }

  return () => {
    observer?.disconnect();
    for (const pane of [...panes.values()]) release(pane);
    for (const [line, block] of empties) {
      line.removeAttribute(EMPTY_SOURCE_ATTRIBUTE);
      block.remove();
    }
    empties.clear();
    for (const [tab, mark] of marks) {
      tab.removeAttribute(TAB_ATTRIBUTE);
      mark.remove();
    }
    marks.clear();
  };
}
