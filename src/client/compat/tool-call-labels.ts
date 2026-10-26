import type { Disposer } from '../contracts/ports.ts';

const LABELS = new Map([
  ['思考', 'Thought'], ['查找文件', 'Find files'], ['搜索内容', 'Search content'], ['搜索文件内容', 'Search content'],
  ['搜索', 'Search'], ['读取', 'Read'], ['读取文件', 'Read file'], ['读取图片', 'Read image'],
  ['写入', 'Write'], ['编辑', 'Edit'], ['加载技能', 'Skill'], ['运行命令', 'Run command'],
  ['执行命令', 'Run command'], ['运行代码', 'Run code'], ['调用工具', 'Use tool'],
  ['读取任务输出', 'Read job output'],
  ['网页搜索', 'Search the web'], ['读取网页', 'Read webpage'], ['获取网页', 'Fetch webpage'],
]);

/** Exact UI labels only: never translate model descriptions, paths or output. */
export function englishToolLabel(text: string, running = false): string | undefined {
  if (text === '思考' && running) return 'Thinking';
  return LABELS.get(text);
}

/** Keep React's title nodes intact and add English presentation siblings. */
export function mountToolCallLabels(document: Document, report: (error: unknown) => void): Disposer {
  const labels = new Map<Element, HTMLElement>();
  const scopes = new Set<Element>();
  const SCOPE = '[data-chat-flow-kind="tool-call"], [data-variant="think"]';
  let pending = false;
  let released = false;
  const clear = (source: Element, label: HTMLElement) => {
    source.removeAttribute('data-ccd-english-source');
    label.remove();
    labels.delete(source);
  };
  const collect = (node: Node) => {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    if (!element) return;
    const scope = element.closest(SCOPE);
    if (scope) scopes.add(scope);
    for (const child of element.querySelectorAll(SCOPE)) scopes.add(child);
  };
  const sync = () => {
    pending = false;
    if (released) return;
    try {
      for (const [source, label] of labels) if (!source.isConnected || !source.closest(SCOPE)) clear(source, label);
      const dirty = [...scopes];
      scopes.clear();
      for (const scope of dirty) for (const source of scope.querySelectorAll('[class*="_title"]')) {
        if (!source.isConnected || source.hasAttribute('data-ccd-english-label')) continue;
        if (!(source.getAttribute('class') ?? '').split(/\s+/u).some(token => /_title(?:_|$)/u.test(token))) continue;
        if (!source.closest('[data-disclosure-row]') && !source.closest('[data-tool="skill"]')) continue;
        // TextShimmer paints its aria-hidden copy from a pseudo-element. Its
        // textContent is empty; translate the attribute so both layers match.
        const text = source.hasAttribute('data-ccd-file-title-source') ? undefined
          : englishToolLabel(source.getAttribute('data-shimmer-text') ?? source.textContent?.trim() ?? '',
            source.closest('[data-variant="think"]')?.getAttribute('data-state') === 'running');
        let label = labels.get(source);
        if (!text) { if (label) clear(source, label); continue; }
        if (!label) {
          label = document.createElement('span');
          label.setAttribute('data-ccd-english-label', '');
          const className = source.getAttribute('class');
          if (className) label.setAttribute('class', className);
          source.setAttribute('data-ccd-english-source', '');
          labels.set(source, label);
        }
        if (label.textContent !== text) label.textContent = text;
        if (label.nextElementSibling !== source) source.parentElement?.insertBefore(label, source);
      }
    } catch (error) { report(error); }
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      collect(record.target);
      for (const node of record.addedNodes) collect(node);
    }
    const removed = [...labels.keys()].some(source => !source.isConnected);
    if (!pending && (scopes.size || removed)) { pending = true; queueMicrotask(sync); }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['data-state', 'data-ccd-file-title-source', 'data-shimmer-text', 'class'] });
  collect(document.body);
  sync();
  return () => {
    released = true;
    observer.disconnect();
    scopes.clear();
    for (const [source, label] of labels) clear(source, label);
  };
}
