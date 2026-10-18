import type { Disposer } from '../contracts/ports.ts';
import { headerLabels } from './header-labels.ts';
import { hostSelectors } from './host-dom.ts';

/** Attribute this module writes onto the host anchor; removed again on release. */
const MODE_ATTRIBUTE = 'data-ccd-open-mode';

/** What one anchor looked like before this module annotated it. */
interface Annotation {
  readonly chevron: HTMLElement;
  readonly main: HTMLElement | null;
  readonly title: string | null;
  readonly label: string | null;
  readonly hidden: string | null;
  readonly tabindex: string | null;
}

/**
 * Annotate ui-open-in-app/OpenTargetButton for a full-box application-menu
 * trigger. Its main half launches directly; the chevron opens the menu and
 * exists only when applications are available. Publish menu availability and
 * update accessible names to match the enlarged trigger.
 * @returns disposer that restores attributes and markers.
 */
export function mountOpenTargetMode(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  /** Anchors carrying the mode marker, including the ones with no annotation. */
  const marked = new Set<HTMLElement>();
  const annotations = new Map<HTMLElement, Annotation>();

  const restore = (entry: Annotation) => {
    if (entry.title === null) entry.chevron.removeAttribute('title');
    else entry.chevron.setAttribute('title', entry.title);
    if (entry.label === null) entry.chevron.removeAttribute('aria-label');
    else entry.chevron.setAttribute('aria-label', entry.label);
    if (entry.main === null) return;
    if (entry.hidden === null) entry.main.removeAttribute('aria-hidden');
    else entry.main.setAttribute('aria-hidden', entry.hidden);
    if (entry.tabindex === null) entry.main.removeAttribute('tabindex');
    else entry.main.setAttribute('tabindex', entry.tabindex);
  };

  const release = () => {
    for (const anchor of marked) anchor.removeAttribute(MODE_ATTRIBUTE);
    marked.clear();
    for (const entry of annotations.values()) restore(entry);
    annotations.clear();
  };

  const sync = () => {
    const copy = headerLabels(document);
    const live = new Set<HTMLElement>();
    for (const anchor of document.querySelectorAll<HTMLElement>(
      `${host.conversationHeader} ${host.openTargetAnchor}`,
    )) {
      live.add(anchor);
      const chevron = anchor.querySelector<HTMLElement>(host.openTargetChevron);
      const main = anchor.querySelector<HTMLElement>(host.openTargetMain);
      let previous = annotations.get(anchor);
      if (previous !== undefined && (previous.chevron !== chevron || previous.main !== main)) {
        restore(previous);
        annotations.delete(anchor);
        previous = undefined;
      }
      marked.add(anchor);
      if (chevron === null) {
        /* No menu: the split would direct-open, which is not what this glyph says. */
        if (anchor.getAttribute(MODE_ATTRIBUTE) !== 'direct') anchor.setAttribute(MODE_ATTRIBUTE, 'direct');
        if (previous !== undefined) {
          annotations.delete(anchor);
          restore(previous);
        }
        continue;
      }
      if (anchor.getAttribute(MODE_ATTRIBUTE) !== 'menu') anchor.setAttribute(MODE_ATTRIBUTE, 'menu');
      if (previous !== undefined) {
        /* React re-renders the anchor when the remembered application or the
           locale changes, and would restore the host's own name over ours. */
        if (chevron.getAttribute('aria-label') !== copy.open) chevron.setAttribute('aria-label', copy.open);
        if (chevron.getAttribute('title') !== copy.open) chevron.setAttribute('title', copy.open);
        continue;
      }
      annotations.set(anchor, {
        chevron,
        main,
        title: chevron.getAttribute('title'),
        label: chevron.getAttribute('aria-label'),
        hidden: main?.getAttribute('aria-hidden') ?? null,
        tabindex: main?.getAttribute('tabindex') ?? null,
      });
      chevron.setAttribute('title', copy.open);
      chevron.setAttribute('aria-label', copy.open);
      /* The covered half cannot act on a pointer click any more; leaving it in
         the tab order would announce a launch the icon no longer performs. */
      main?.setAttribute('aria-hidden', 'true');
      main?.setAttribute('tabindex', '-1');
    }
    /* Session switches rebuild the header; records outlive their anchors. */
    for (const anchor of marked) {
      if (live.has(anchor)) continue;
      anchor.removeAttribute(MODE_ATTRIBUTE);
      const entry = annotations.get(anchor);
      if (entry !== undefined) { restore(entry); annotations.delete(anchor); }
      marked.delete(anchor);
    }
  };

  const observer = new MutationObserver(() => {
    try {
      sync();
    } catch (error) {
      report(error);
    }
  });
  try {
    /* The header is rebuilt on session switches and the anchor's names are
       React props, so names are re-checked rather than written once. `lang`
       lives on the document element, hence that root rather than `body`. */
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['lang', 'aria-label', 'title'],
    });
    sync();
  } catch (error) {
    observer.disconnect();
    release();
    report(error);
    return () => {};
  }
  return () => { observer.disconnect(); release(); };
}
