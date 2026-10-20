import type { Disposer } from '../contracts/ports.ts';

export interface CommandSegment {
  readonly text: string;
  readonly tone: 'command' | 'argument' | 'plain';
}

interface ReadPreviewState {
  readonly body: HTMLElement;
  readonly attributes: (string | null)[];
  requested: HTMLButtonElement | null;
}

interface CommandCopyState {
  readonly button: HTMLButtonElement;
  readonly header: Element;
  readonly nativeButtons: Set<Element>;
  pending: boolean;
  disposed: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export async function writeCommandClipboard(document: Document, text: string): Promise<void> {
  try {
    const clipboard = document.defaultView?.navigator.clipboard;
    if (clipboard?.writeText) { await clipboard.writeText(text); return; }
  } catch { /* Embedded renderers may deny the async API; try the local fallback. */ }
  const previous = document.activeElement as HTMLElement | null;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand?.('copy')) throw new Error('Clipboard copy failed');
  } finally {
    field.remove();
    previous?.focus({ preventScroll: true });
  }
}

/** Presentation tokens only: preserve every character, including shell quotes. */
export function commandSegments(command: string): CommandSegment[] {
  const words = command.match(/\s+|&&|\|\||[;|&<>]|(?:"(?:\\[\s\S]|[^"\\])*"|'[^']*'|\\[\s\S]|[^\s;|&<>"'\\])+/gu) ?? [];
  // Incomplete quoting is legal while streaming; fall back without losing text.
  if (words.join('') !== command) return [{ text: command, tone: 'plain' }];
  let first = true;
  return words.map(text => {
    if (/^\s+$/u.test(text)) {
      if (text.includes('\n')) first = true;
      return { text, tone: 'plain' };
    }
    if (/^(?:&&|\|\||[;|&<>])$/u.test(text)) {
      if (!/[<>]/u.test(text)) first = true;
      return { text, tone: 'plain' };
    }
    const tone = first ? 'command' : 'argument';
    first = false;
    return { text, tone };
  });
}

/** Add a highlighted sibling; never rewrite React's command text or handlers. */
export function mountToolCallDetails(document: Document, report: (error: unknown) => void,
  copyText: (text: string) => Promise<void> = text => writeCommandClipboard(document, text)): Disposer {
  const commands = new Map<HTMLElement, { view: HTMLElement; text: string | null }>();
  const skills = new Map<HTMLElement, { view: HTMLElement; text: string | null }>();
  const copies = new Map<Element, CommandCopyState>();
  const releaseCopy = (state: CommandCopyState) => {
    state.disposed = true;
    clearTimeout(state.timer);
    state.button.remove();
    for (const button of state.nativeButtons) button.removeAttribute('data-ccd-native-copy');
  };
  const reads = new Map<Element, ReadPreviewState>();
  const scrollAttributes = ['tabindex', 'role', 'aria-label'];
  const restoreRead = (read: Element, state: ReadPreviewState) => {
    read.removeAttribute('data-ccd-read-scroll');
    scrollAttributes.forEach((name, index) => {
      const value = state.attributes[index];
      if (value == null) state.body.removeAttribute(name);
      else state.body.setAttribute(name, value);
    });
    // Restore only the local preview expansion we requested, never file IO.
    if (state.requested?.isConnected && state.requested.getAttribute('aria-expanded') === 'true') state.requested.click();
  };
  const dirty = new Set<Element>();
  let pending = false;
  let released = false;
  const collect = (node: Node) => {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    if (!element) return;
    for (const selector of ['[data-terminal]', '[data-read]', '[data-tool="skill"]', '[data-search="paths"]']) {
      const block = element.closest(selector);
      if (block) dirty.add(block);
      for (const child of element.querySelectorAll(selector)) dirty.add(child);
    }
  };
  const flush = () => {
    pending = false;
    if (released) return;
    try {
      for (const [terminal, state] of copies) {
        if (terminal.isConnected && terminal.closest('[data-ccd-tool-group-member]') && terminal.children[0] === state.header) continue;
        releaseCopy(state);
        copies.delete(terminal);
      }
      for (const [source, state] of commands) {
        if (source.isConnected && source.closest('[data-ccd-tool-group-member]')) continue;
        state.view.remove();
        source.removeAttribute('data-ccd-command-source');
        commands.delete(source);
      }
      for (const [source, state] of skills) {
        if (source.isConnected && source.closest('[data-ccd-tool-group-member]')) continue;
        state.view.remove();
        source.removeAttribute('data-ccd-skill-source');
        skills.delete(source);
      }
      for (const [read, state] of reads) {
        if (read.isConnected && read.closest('[data-ccd-tool-group-member]') && read.children[1] === state.body) continue;
        restoreRead(read, state);
        reads.delete(read);
      }
      for (const terminal of dirty) {
        if (!terminal.isConnected || !terminal.closest('[data-ccd-tool-group-member]')) continue;
        const paths = terminal.getAttribute('data-search') === 'paths';
        if (terminal.getAttribute('data-tool') === 'skill') {
          for (const source of terminal.querySelectorAll<HTMLElement>('pre')) {
            const text = source.textContent ?? '';
            let state = skills.get(source);
            if (!state) {
              const view = document.createElement('div');
              view.setAttribute('data-ccd-skill-content', '');
              view.setAttribute('tabindex', '0');
              view.setAttribute('role', 'region');
              view.setAttribute('aria-label', 'Skill contents');
              state = { view, text: null };
              skills.set(source, state);
            }
            if (state.text !== text) {
              state.view.replaceChildren(...text.split('\n').map((line, index) => {
                const row = document.createElement('div');
                const number = document.createElement('span');
                number.setAttribute('aria-hidden', 'true');
                number.textContent = String(index + 1);
                const content = document.createElement('span');
                content.textContent = line;
                row.append(number, content);
                return row;
              }));
              state.text = text;
            }
            if (source.nextElementSibling !== state.view) source.after(state.view);
            if (!source.hasAttribute('data-ccd-skill-source')) source.setAttribute('data-ccd-skill-source', '');
          }
          continue;
        }
        if (terminal.hasAttribute('data-read') || paths) {
          const body = terminal.children[1] as HTMLElement | undefined;
          if (!body) continue;
          let state = reads.get(terminal);
          if (!state) {
            state = { body, attributes: scrollAttributes.map(name => body.getAttribute(name)), requested: null };
            reads.set(terminal, state);
            body.setAttribute('tabindex', '0');
            if (!body.hasAttribute('role')) body.setAttribute('role', 'region');
            if (!body.hasAttribute('aria-label')) body.setAttribute('aria-label', paths ? 'File paths' : 'File contents');
          }
          const expand = [...body.children].find(child => child.tagName === 'BUTTON'
            && child.hasAttribute('aria-expanded')) as HTMLButtonElement | undefined;
          if (expand?.getAttribute('aria-expanded') === 'false') {
            // ReadBlock initially renders head/tail excerpts. Its native toggle
            // reveals all returned lines, without issuing a second tool call.
            if (!state.requested) { state.requested = expand; expand.click(); }
          }
          if (!expand || expand.getAttribute('aria-expanded') === 'true') {
            if (!terminal.hasAttribute('data-ccd-read-scroll')) terminal.setAttribute('data-ccd-read-scroll', '');
          }
          if (!paths) continue;
        }
        const header = terminal.children[0];
        const pathRows = () => [...(terminal.children[1]?.children ?? [])].filter(child => child.tagName === 'DIV');
        const copyLabel = paths ? 'Copy paths' : 'Copy command';
        if (header && (paths ? pathRows().length : terminal.querySelectorAll('[data-command-text]').length)) {
          let copy = copies.get(terminal);
          if (!copy) {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute(paths ? 'data-ccd-paths-copy' : 'data-ccd-command-copy', '');
            button.setAttribute('aria-label', copyLabel);
            copy = { button, header, nativeButtons: new Set(), pending: false, disposed: false };
            const state = copy;
            button.addEventListener('click', async event => {
              event.stopPropagation();
              if (state.pending || state.disposed) return;
              state.pending = true;
              clearTimeout(state.timer);
              button.setAttribute('data-ccd-copy-state', 'idle');
              try {
                const sources = paths ? pathRows() : [...terminal.querySelectorAll('[data-command-text]')];
                const text = sources.map(source => source.textContent ?? '').join('\n');
                await copyText(text);
                if (state.disposed) return;
                button.setAttribute('data-ccd-copy-state', 'copied');
                button.setAttribute('aria-label', 'Copied');
                state.timer = setTimeout(() => {
                  button.setAttribute('data-ccd-copy-state', 'idle');
                  button.setAttribute('aria-label', copyLabel);
                }, 1000);
              } catch (error) {
                if (!state.disposed) { button.setAttribute('aria-label', 'Copy failed'); report(error); }
              } finally { state.pending = false; }
            });
            copies.set(terminal, copy);
          }
          for (const child of header.children) {
            if (child.tagName !== 'BUTTON' || child === copy.button) continue;
            copy.nativeButtons.add(child);
            if (!child.hasAttribute('data-ccd-native-copy')) child.setAttribute('data-ccd-native-copy', '');
          }
          if (copy.button.parentElement !== header) header.append(copy.button);
        }
        if (paths) continue;
        for (const source of terminal.querySelectorAll<HTMLElement>('[data-command-text]')) {
          const text = source.textContent ?? '';
          let state = commands.get(source);
          if (!state) {
            const view = document.createElement('span');
            view.setAttribute('data-ccd-command-highlight', '');
            state = { view, text: null };
            commands.set(source, state);
            source.setAttribute('data-ccd-command-source', '');
          }
          if (state.text !== text) {
            state.view.replaceChildren(...commandSegments(text).map(segment => {
              const span = document.createElement('span');
              span.setAttribute('data-ccd-command-tone', segment.tone);
              span.textContent = segment.text;
              return span;
            }));
            state.text = text;
          }
          if (source.nextElementSibling !== state.view) source.after(state.view);
        }
      }
      dirty.clear();
    } catch (error) { report(error); }
  };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      collect(record.target);
      for (const node of record.addedNodes) collect(node);
    }
    if (!pending) {
      pending = true;
      queueMicrotask(flush);
    }
  });
  observer.observe(document.body, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ['data-ccd-tool-group-member', 'aria-expanded'],
  });
  collect(document.body);
  flush();
  return () => {
    released = true;
    observer.disconnect();
    dirty.clear();
    for (const [source, state] of commands) {
      state.view.remove();
      source.removeAttribute('data-ccd-command-source');
    }
    commands.clear();
    for (const state of copies.values()) releaseCopy(state);
    copies.clear();
    for (const [source, state] of skills) {
      state.view.remove();
      source.removeAttribute('data-ccd-skill-source');
    }
    skills.clear();
    for (const [read, state] of reads) restoreRead(read, state);
    reads.clear();
  };
}
