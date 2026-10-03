import type { BlankSessionsPort, Disposer } from '../contracts/ports.ts';
import { ROOT_ATTRIBUTE } from '../../shared/identity.ts';
import { ANCHOR } from './host-dom.ts';

/**
 * Hide provisional root sessions using SessionSummary.blank from
 * dsh-api-session-controller and ui-workspace's data-row-key=session:<id>.
 * Remove the display marker after the first message or scope release.
 * Fork children retain their rows while their summaries are settling.
 *
 * The hide has to be in force before the host measures the list, not merely
 * before it paints. `ui-workspace`'s AnimatedRows reads every keyed row's
 * rectangle inside the commit that mounts it — `getSnapshotBeforeUpdate` then
 * `componentDidUpdate`, both before any microtask — and glides the rows below
 * from their previous position. A marker written by a MutationObserver lands
 * one microtask too late: the row is measured as a real box, and the height it
 * then drops out of the flow becomes a jump the host's 200ms glide plays back
 * (issue 04). The ids are therefore written twice: as a rule in the plugin's
 * own adopted sheet, keyed by `data-row-key`, which is the one value the
 * element carries from the moment React creates it and which is known one
 * store notification earlier, before the row is committed at all; and as the
 * marker attribute below, which is the same fact recorded on an element that
 * already exists and the fallback wherever a document cannot carry the sheet.
 */

/** Marks one host row the stylesheet keeps out of the column. */
export const BLANK_ROW_ATTRIBUTE = 'data-ccd-blank-session';

/** `data-row-key` value prefix of one Session row, from `ui-workspace` Rows.tsx. */
const SESSION_KEY_PREFIX = 'session:';

/** The slice of one host list row this filter reads. */
export interface SessionRowFacts {
  /** Host presentation fact: created and not yet given durable history. */
  readonly blank?: boolean;
  /** Direct parent, present on fork and subagent children. */
  readonly parentId?: string;
}

/** The slice of the host session list this filter reads (`SessionListState`). */
export interface SessionListFacts {
  readonly ids: readonly string[];
  readonly byId: Readonly<Record<string, SessionRowFacts | undefined>>;
}

/**
 * Ids whose provisional row must stay out of the column.
 *
 * A row qualifies when the host still calls it blank and it is a root Session:
 * a blank child is a fork that has not received its authoritative summary yet,
 * not a New Session placeholder.
 *
 * @param state - host session-list snapshot.
 * @returns the ids to hide, in no particular order.
 */
export function blankSessionIds(state: SessionListFacts): ReadonlySet<string> {
  const blank = new Set<string>();
  for (const id of state.ids) {
    const row = state.byId[id];
    if (row === undefined || row.blank !== true || row.parentId !== undefined) continue;
    blank.add(id);
  }
  return blank;
}

/**
 * Session id carried by one `data-row-key`, or null for any other row.
 *
 * @param key - the attribute value, as read from the DOM.
 * @returns the id, or null when the row is not a Session row.
 */
export function rowSessionId(key: string | null | undefined): string | null {
  if (typeof key !== 'string' || !key.startsWith(SESSION_KEY_PREFIX)) return null;
  const id = key.slice(SESSION_KEY_PREFIX.length);
  return id === '' ? null : id;
}

/** Whether one mutated node is, or contains, a keyed row. */
function carriesRow(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return node.matches(ANCHOR.sessionRows) || node.querySelector(ANCHOR.sessionRows) !== null;
}

/** One plugin-owned sheet holding the id-keyed half of the row filter. */
interface BlankRowSheet {
  /** Take exactly these ids out of the column; rewritten when the set moves. */
  update(ids: ReadonlySet<string>): void;
  dispose(): void;
}

/**
 * The selector that takes one provisional row out of the column.
 *
 * It matches the row key the host writes as it creates the element — the same
 * identity the marker attribute is set from — so the rule is already in force
 * for that row's first style pass, and for every later mount of the same id
 * (collapsing a group unmounts its rows; expanding it again creates new
 * elements that no attribute could have reached). The plugin's own root
 * attribute keeps the rule on the same gate as `features/sidebar/sidebar.css`.
 *
 * @param id - session id the host still calls blank.
 * @returns one selector, for that session's row wherever the host renders it.
 */
function blankRowSelector(id: string): string {
  /* Session ids are host-generated slugs; anything else is hex-escaped so an
     unexpected character can never turn the rule into a parse error, which
     would be a sheet this document refuses. */
  const key = id.replace(/[^A-Za-z0-9_-]/gu, match => `\\${(match.codePointAt(0) ?? 0).toString(16)} `);
  return `html[${ROOT_ATTRIBUTE}="true"] [data-row-key="${SESSION_KEY_PREFIX}${key}"]`;
}

/**
 * Install the id-keyed sheet, where the document can carry one.
 *
 * The rules are adopted rather than appended as a `<style>` element: this is a
 * plugin-owned style surface rather than a node in the host's tree, and the
 * feature's resource accounting keeps naming exactly the stylesheets it mounts.
 * A document that cannot construct a stylesheet — a narrow document double, an
 * engine without constructable sheets — keeps the marker attribute as its only
 * signal.
 *
 * @param document - renderer document carrying the sidebar.
 * @param report - sink for a sheet this document refuses; the marker stays.
 * @returns the sheet, or null when the document cannot adopt one.
 */
function mountBlankRowSheet(
  document: Document,
  report: (error: unknown) => void,
): BlankRowSheet | null {
  if (typeof CSSStyleSheet !== 'function' || !Array.isArray(document.adoptedStyleSheets)) return null;
  const sheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  const release = () => {
    const adopted = document.adoptedStyleSheets;
    /* A document an owner has already replaced the list on has dropped the
       sheet with it; this path runs inside the host's own listener loop, so
       nothing here may throw. */
    if (!Array.isArray(adopted)) return;
    document.adoptedStyleSheets = adopted.filter(kept => kept !== sheet);
  };
  let applied: string | null = null;
  let dropped = false;
  return {
    update(ids) {
      if (dropped) return;
      /* A reconcile runs per list change; the sheet is rewritten only when the
         id set it speaks for actually moved. */
      const text = [...ids].map(id => `${blankRowSelector(id)}{display:none}`).join('\n');
      if (text === applied) return;
      applied = text;
      try {
        sheet.replaceSync(text);
      } catch (error) {
        /* `replaceSync` is the one call here that can throw, and it runs
           inside the host list's own notification loop: a sheet this document
           will not take is dropped and reported rather than allowed to fail
           the host's other subscribers. The marker attribute still holds the
           row out, one microtask later. */
        dropped = true;
        release();
        report(error);
      }
    },
    dispose() {
      dropped = true;
      release();
    },
  };
}

/**
 * Keep the host's provisional New Session rows out of the sidebar column.
 *
 * Reconciliation runs synchronously (never on an animation frame, which a
 * hidden or occluded window throttles) and is driven by two signals: the host
 * session list, which is what makes a row stop being provisional, and the
 * document's own childList changes, which is how a row arrives at all. A
 * mutation outside the Workspace browser is ignored before any query runs, so
 * a streaming Conversation never pays for this observer.
 *
 * Both signals write the same fact to two places: the sheet, which reaches the
 * list before the row lays out, and the marker attribute on the row, which is
 * what a stylesheet can hide and what the release path clears.
 *
 * @param document - renderer document carrying the sidebar.
 * @param source - provisional-id source built over the host session list.
 * @param report - sink for source failures; the native rows stay untouched.
 * @returns disposer that stops both signals, removes the sheet, and clears
 *   every tag it wrote.
 */
export function mountBlankSessionRows(
  document: Document,
  source: BlankSessionsPort,
  report: (error: unknown) => void,
): Disposer {
  const marked = new Set<Element>();
  /* Opened before the first read: the sheet is what keeps a row the next
     commit mounts out of the flow from its first layout pass, while the marker
     attribute below records the same fact on the elements that exist now. */
  const sheet = mountBlankRowSheet(document, report);
  let reconciling = false;
  let disposed = false;

  const sync = () => {
    if (disposed) return;
    let blank: ReadonlySet<string>;
    try {
      blank = source.ids();
    } catch (error) {
      report(error);
      return;
    }
    sheet?.update(blank);
    for (const row of document.querySelectorAll(ANCHOR.sessionRows)) {
      const id = rowSessionId(row.getAttribute('data-row-key'));
      if (id !== null && blank.has(id)) {
        /* Re-tagging an already tagged row would be a no-op write on every
           reconciliation, so the attribute is only written on the edge. */
        if (!row.hasAttribute(BLANK_ROW_ATTRIBUTE)) row.setAttribute(BLANK_ROW_ATTRIBUTE, '');
        marked.add(row);
        continue;
      }
      if (!row.hasAttribute(BLANK_ROW_ATTRIBUTE)) continue;
      row.removeAttribute(BLANK_ROW_ATTRIBUTE);
      marked.delete(row);
    }
    /* React drops rows without telling anyone; forget the dead references. */
    for (const row of marked) if (!row.isConnected) marked.delete(row);
  };

  const reconcile = () => {
    if (reconciling || disposed) return;
    reconciling = true;
    try {
      sync();
    } finally {
      reconciling = false;
    }
  };

  const touchesRows = (records: readonly MutationRecord[]): boolean => {
    const browser = document.querySelector(ANCHOR.workspaces);
    for (const record of records) {
      if (browser !== null && browser.contains(record.target)) return true;
      for (const node of record.addedNodes) if (carriesRow(node)) return true;
      for (const node of record.removedNodes) if (carriesRow(node)) return true;
    }
    return false;
  };

  const observer = new MutationObserver(records => {
    if (touchesRows(records)) reconcile();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  let unsubscribe: Disposer;
  try {
    unsubscribe = source.subscribe(reconcile);
  } catch (error) {
    /* A subscription that never landed owns nothing to release, but the
       observer opened above does, and so does the sheet. */
    observer.disconnect();
    sheet?.dispose();
    report(error);
    return () => {};
  }
  reconcile();

  return () => {
    if (disposed) return;
    disposed = true;
    unsubscribe();
    observer.disconnect();
    sheet?.dispose();
    for (const row of marked) row.removeAttribute(BLANK_ROW_ATTRIBUTE);
    marked.clear();
  };
}
