import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

interface TextHighlight {
  add(range: Range): void;
  clear(): void;
}
interface HighlightPort {
  CSS?: { highlights?: Map<string, TextHighlight> };
  Highlight?: new (...ranges: Range[]) => TextHighlight;
}
interface Batch {
  readonly root: Element;
  readonly name: string;
  readonly highlight: TextHighlight;
  readonly born: number;
  readonly start: number;
  readonly end: number;
  readonly rule: CSSStyleRule;
}

let instance = 0;

/** Only append-only visible text gets an entrance; reparsing is already visible. */
export function streamingAppendStart(previous: string, text: string): number | null {
  if (text.length <= previous.length || !text.startsWith(previous)) return null;
  const start = previous.length;
  // A renderer can receive an astral character in two UTF-16 chunks.
  return start > 0 && /[\uD800-\uDBFF]/u.test(text[start - 1]!) && /[\uDC00-\uDFFF]/u.test(text[start]!) ? start - 1 : start;
}

/** Fade new reply text through native Ranges: never wrap, clone or delay Markdown. */
export function mountConversationStream(document: Document, report: (error: unknown) => void): Disposer {
  const view = document.defaultView;
  const port = view as unknown as HighlightPort | null;
  const registry = port?.CSS?.highlights;
  const Highlight = port?.Highlight;
  if (!view || !registry || !Highlight) return () => {};
  const host = hostSelectors(document);
  const media = view.matchMedia('(prefers-reduced-motion: reduce)');
  const prefix = `ccd-stream-${++instance}-`;
  const style = document.createElement('style');
  style.setAttribute('data-ccd-stream-style', '');
  document.head.append(style);
  const sheet = style.sheet;
  if (!sheet) { style.remove(); return () => {}; }
  const previous = new Map<Element, string>();
  const dirty = new Set<Element>();
  const batches: Batch[] = [];
  let serial = 0;
  let frame = 0;
  let pending = false;
  let released = false;

  const live = (root: Element) => {
    const marker = root.closest('[data-streaming]') ?? root.querySelector('[data-streaming]');
    return root.isConnected && !!root.closest('[data-chat-flow-kind="assistant-step"]')
      && !!root.closest(host.assistantMarkdown) && !root.closest('[data-variant="think"], [data-chat-flow-kind="tool-call"]')
      && !!marker && marker.getAttribute('data-streaming') !== 'false';
  };
  const read = (root: Element) => {
    const nodes: { node: Text; start: number; end: number }[] = [];
    const walker = document.createTreeWalker(root, 4 /* SHOW_TEXT */);
    let text = '';
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest(`pre, code, a, button, svg, script, style, [data-code-wrap], [data-code-block-banner], [aria-hidden="true"], [data-markdown-variant="compact"], ${host.markdownFileMention}`)) continue;
      const start = text.length;
      text += node.textContent ?? '';
      nodes.push({ node: node as Text, start, end: text.length });
    }
    return { text, nodes };
  };
  const remove = (batch: Batch) => {
    if (registry.get(batch.name) === batch.highlight) registry.delete(batch.name);
    const index = [...sheet.cssRules].indexOf(batch.rule);
    if (index >= 0) sheet.deleteRule(index);
  };
  const bind = (highlight: TextHighlight, nodes: ReturnType<typeof read>['nodes'], start: number, end: number) => {
    highlight.clear();
    for (const part of nodes) {
      if (part.start >= end) break;
      if (part.end <= start || part.end === part.start) continue;
      const range = document.createRange();
      range.setStart(part.node, Math.max(0, start - part.start));
      range.setEnd(part.node, Math.min(end, part.end) - part.start);
      highlight.add(range);
    }
  };
  const paint = () => {
    frame = 0;
    if (released) return;
    const now = view.performance.now();
    for (const root of previous.keys()) if (!live(root)) previous.delete(root);
    for (let index = batches.length - 1; index >= 0; index--) {
      const batch = batches[index]!;
      if (media.matches || !live(batch.root) || now - batch.born >= 700) {
        remove(batch);
        batches.splice(index, 1);
      }
    }
    // CSSOM changes generate no DOM mutations. Each batch fades independently
    // without waking the host's observers or restarting older words.
    for (const batch of batches) {
      const opacity = Math.round(100 - 55 * (1 - (now - batch.born) / 700) ** 2);
      batch.rule.style.color = `color-mix(in srgb,var(--ccd-text) ${opacity}%,transparent)`;
    }
    if (batches.length) frame = view.requestAnimationFrame(paint);
  };
  const schedulePaint = () => { if (!frame) frame = view.requestAnimationFrame(paint); };
  const flush = () => {
    pending = false;
    if (released) return;
    try {
      for (const root of dirty) {
        if (!live(root)) { previous.delete(root); continue; }
        const { text, nodes } = read(root);
        const old = previous.get(root) ?? '';
        const start = streamingAppendStart(old, text);
        previous.set(root, text);
        // React can replace a Text node or set nodeValue, which collapses live
        // Range endpoints. Rebind existing cohorts without restarting the fade.
        for (let index = batches.length - 1; index >= 0; index--) {
          const batch = batches[index]!;
          if (batch.root !== root) continue;
          if (text.startsWith(old)) bind(batch.highlight, nodes, batch.start, batch.end);
          else { remove(batch); batches.splice(index, 1); }
        }
        if (start === null || media.matches) continue;
        const name = `${prefix}${++serial}`;
        const highlight = new Highlight();
        bind(highlight, nodes, start, text.length);
        const index = sheet.insertRule(`html[data-dsh-ccd-style="true"]::highlight(${name}){color:color-mix(in srgb,var(--ccd-text) 45%,transparent);}`);
        const rule = sheet.cssRules[index] as CSSStyleRule;
        registry.set(name, highlight);
        batches.push({ root, name, highlight, rule, born: view.performance.now(), start, end: text.length });
        // Bound work even if a provider emits unusually tiny chunks.
        while (batches.length > 32) remove(batches.shift()!);
      }
      dirty.clear();
      schedulePaint();
    } catch (error) { dirty.clear(); report(error); }
  };
  const collect = (node: Node, descendants = true) => {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    if (!element) return;
    const root = element.closest(host.markdownBody);
    if (root) { dirty.add(root); return; }
    if (descendants) for (const child of element.querySelectorAll(host.markdownBody)) dirty.add(child);
  };
  // Seed the rendered conversation, including a reply already in progress.
  // Mounting or reloading the theme never replays the existing text.
  for (const root of document.querySelectorAll(host.markdownBody)) {
    if (live(root)) previous.set(root, read(root).text);
  }
  const observer = new MutationObserver(records => {
    if (released) return;
    for (const record of records) {
      collect(record.target, record.type === 'attributes');
      for (const node of record.addedNodes) collect(node);
    }
    if (!pending && (dirty.size || batches.length)) {
      pending = true;
      queueMicrotask(flush);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['data-streaming'] });
  const motionChanged = () => {
    // Seed again before reenabling, so text received in reduced motion is old.
    for (const root of previous.keys()) if (live(root)) previous.set(root, read(root).text);
    schedulePaint();
  };
  media.addEventListener('change', motionChanged);
  return () => {
    released = true;
    observer.disconnect();
    media.removeEventListener('change', motionChanged);
    view.cancelAnimationFrame(frame);
    batches.forEach(remove);
    batches.length = 0;
    previous.clear();
    dirty.clear();
    style.remove();
  };
}
