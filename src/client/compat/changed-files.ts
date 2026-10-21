import type { Disposer } from '../contracts/ports.ts';

const CARD = '[data-turn-tail] [data-changed-files]';
interface CardState {
  readonly footer: HTMLButtonElement;
  readonly label: HTMLElement;
  readonly totals: HTMLElement;
  readonly icons: Map<Element, { source: string; view: Element }>;
  counts: string;
  multi: { source: Element; label: HTMLElement } | null;
  single: { header: Element; heading: HTMLElement; name: HTMLElement; totals: HTMLElement; counts: string } | null;
}

/** Only the host's count title is normalized; file names are never translated. */
export function changedFilesTitle(title: string): string | undefined {
  const count = title.trim().match(/^(?:已编辑\s*(\d+)\s*个文件|Edited\s+(\d+)\s+files?)$/u);
  const value = count?.[1] ?? count?.[2];
  return value ? `已编辑 ${value} 个文件` : undefined;
}

/** Decorate native completed-turn summaries without moving React-owned nodes.
 * Native headers/rows retain review and hover-preview handlers. The added
 * footer delegates to the header, and decorative icons copy its native glyph. */
export function mountChangedFiles(document: Document, report: (error: unknown) => void): Disposer {
  const states = new Map<Element, CardState>();
  const dirty = new Set<Element>();
  let pending = false;
  let released = false;
  const clearSingle = (card: Element, state: CardState) => {
    state.single?.heading.remove();
    state.single?.name.remove();
    state.single?.totals.remove();
    state.single = null;
    card.removeAttribute('data-ccd-changes-single');
  };
  const clearMulti = (state: CardState) => {
    state.multi?.source.removeAttribute('data-ccd-changes-title-source');
    state.multi?.label.remove();
    state.multi = null;
  };
  const clear = (card: Element, state: CardState) => {
    state.footer.remove();
    clearSingle(card, state);
    clearMulti(state);
    for (const icon of state.icons.values()) icon.view.remove();
    states.delete(card);
  };
  const sync = (card: Element) => {
    const header = card.querySelector<HTMLButtonElement>('button[class*="_header"]');
    const list = card.querySelector('ul');
    const single = card.getAttribute('data-single') === 'true';
    let state = states.get(card);
    if (!card.isConnected || !card.matches(CARD) || !header || (!single && !list)) {
      if (state) clear(card, state);
      return;
    }
    if (!state) {
      const footer = document.createElement('button');
      footer.type = 'button';
      footer.setAttribute('data-ccd-changes-review', '');
      const label = document.createElement('span');
      const totals = document.createElement('span');
      totals.setAttribute('data-ccd-changes-total', '');
      footer.append(label, totals);
      footer.addEventListener('click', () => card.querySelector<HTMLButtonElement>('button[class*="_header"]')?.click());
      state = { footer, label, totals, counts: '', icons: new Map(), single: null, multi: null };
      states.set(card, state);
    }
    const text = '查看全部';
    if (state.label.textContent !== text) state.label.textContent = text;
    const hint = '查看本轮更改';
    if (state.footer.getAttribute('data-ccd-changes-tooltip') !== hint) {
      state.footer.setAttribute('data-ccd-changes-tooltip', hint);
      state.footer.setAttribute('aria-description', hint);
    }
    if (state.footer.disabled !== header.disabled) state.footer.disabled = header.disabled;
    const counts = header.querySelector('[class*="_statCounts"]');
    const signature = counts?.outerHTML ?? '';
    if (state.counts !== signature) {
      state.counts = signature;
      state.totals.replaceChildren(...(counts ? [counts.cloneNode(true)] : []));
    }
    if (state.footer.parentElement !== card) card.append(state.footer);
    if (state.single && (!single || state.single.header !== header)) clearSingle(card, state);
    const nativeTitle = single ? undefined : [...header.querySelectorAll('[class*="_title"]')].find(source =>
      !source.hasAttribute('data-ccd-changes-title') && (source.getAttribute('class') ?? '').split(/\s+/u).some(token => /_title(?:_|$)/u.test(token)));
    const summaryTitle = nativeTitle ? changedFilesTitle(nativeTitle.textContent ?? '') : undefined;
    if (state.multi && (state.multi.source !== nativeTitle || !summaryTitle)) clearMulti(state);
    if (nativeTitle && summaryTitle) {
      if (!state.multi) {
        const label = document.createElement('span');
        label.setAttribute('data-ccd-changes-title', '');
        nativeTitle.setAttribute('data-ccd-changes-title-source', '');
        nativeTitle.parentElement?.insertBefore(label, nativeTitle);
        state.multi = { source: nativeTitle, label };
      }
      if (state.multi.label.textContent !== summaryTitle) state.multi.label.textContent = summaryTitle;
    }
    if (single) {
      if (!state.single) {
        const heading = document.createElement('div');
        heading.setAttribute('data-ccd-changes-heading', '');
        const name = document.createElement('span');
        name.setAttribute('data-ccd-changes-single-name', '');
        const totals = document.createElement('span');
        totals.setAttribute('data-ccd-changes-total', '');
        card.insertBefore(heading, card.firstChild);
        header.append(name, totals);
        card.setAttribute('data-ccd-changes-single', '');
        state.single = { header, heading, name, totals, counts: '' };
      }
      const view = state.single;
      const title = '已编辑 1 个文件';
      if (view.heading.textContent !== title) view.heading.textContent = title;
      const descriptionId = header.getAttribute('aria-describedby');
      const path = descriptionId ? document.getElementById(descriptionId)?.textContent?.trim() : null;
      const name = path?.split(/[\\/]/u).at(-1) || header.querySelector('[class*="_title"]')?.textContent || '';
      if (view.name.textContent !== name) view.name.textContent = name;
      if (view.counts !== signature) {
        view.counts = signature;
        view.totals.replaceChildren(...(counts ? [counts.cloneNode(true)] : []));
      }
    }
    const rows = new Set(single ? [] : list!.querySelectorAll('button[class*="_row"]'));
    for (const [row, icon] of state.icons) if (!rows.has(row)) {
      icon.view.remove();
      state.icons.delete(row);
    }
    const source = header.querySelector('[class*="_tile"]');
    for (const row of rows) {
      const previous = state.icons.get(row);
      if (previous && previous.source === source?.outerHTML && previous.view.parentElement === row) continue;
      previous?.view.remove();
      state.icons.delete(row);
      if (!source) continue;
      const view = source.cloneNode(true) as Element;
      view.setAttribute('data-ccd-changes-icon', '');
      view.setAttribute('aria-hidden', 'true');
      row.insertBefore(view, row.firstChild);
      state.icons.set(row, { source: source.outerHTML, view });
    }
  };
  const collect = (node: Node) => {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    if (!element) return;
    const card = element.closest(CARD);
    if (card) dirty.add(card);
    for (const child of element.querySelectorAll(CARD)) dirty.add(child);
  };
  const flush = () => {
    pending = false;
    if (released) return;
    try {
      for (const card of states.keys()) if (!card.isConnected || !card.matches(CARD)) dirty.add(card);
      const cards = [...dirty];
      dirty.clear();
      for (const card of cards) sync(card);
    } catch (error) { report(error); }
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target === document.documentElement) {
        for (const card of states.keys()) dirty.add(card);
      } else {
        collect(record.target);
        for (const node of record.addedNodes) collect(node);
      }
    }
    for (const card of states.keys()) if (!card.isConnected) dirty.add(card);
    if (!pending && dirty.size) { pending = true; queueMicrotask(flush); }
  });
  observer.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['data-single', 'disabled', 'lang'],
  });
  collect(document.body);
  flush();
  return () => {
    released = true;
    observer.disconnect();
    dirty.clear();
    for (const [card, state] of states) clear(card, state);
  };
}
