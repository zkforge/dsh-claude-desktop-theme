/** Browser capture menu backed by the native webview. */
export interface BrowserPopupLayout {
  readonly width: number;
  readonly align: 'start' | 'end';
}
interface BrowserMenuActions {
  popup(anchor: HTMLElement, content: HTMLElement, layout: BrowserPopupLayout): void;
  dismiss(): void;
  notice(anchor: HTMLElement, text: string): void;
}
interface CapturedImage {
  isEmpty?(): boolean;
  toDataURL(): string;
}
interface CaptureView extends HTMLElement {
  capturePage?(): Promise<CapturedImage>;
  getURL?(): string;
  isLoading?(): boolean;
}
export interface BrowserMenus {
  more(anchor: HTMLElement): void;
  release(): void;
}

export function mountBrowserMenus(node: HTMLElement, actions: BrowserMenuActions): BrowserMenus {
  const document = node.ownerDocument;
  let disposed = false;
  let capturing = false;
  const frame = () => node.querySelector<CaptureView>('webview');
  const canCapture = () => {
    const view = frame();
    try {
      return !capturing && typeof view?.capturePage === 'function' && !view.isLoading?.()
        && /^https?:\/\//iu.test(view.getURL?.() ?? '');
    } catch { return false; /* A guest exists before its dom-ready event. */ }
  };
  const menu = (kind: string) => {
    const content = document.createElement('div');
    content.setAttribute('data-ccd-browser-menu', kind);
    content.setAttribute('role', 'menu');
    content.addEventListener('keydown', event => {
      const items = [...content.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const target = event.key === 'ArrowDown' ? (index + 1) % items.length : event.key === 'ArrowUp' ? (index - 1 + items.length) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
      if (target < 0) return;
      event.preventDefault(); items[target]?.focus();
    });
    return content;
  };
  const row = (parent: HTMLElement, label: string, action: () => void, attribute: string) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = label;
    button.setAttribute('role', 'menuitem'); button.setAttribute(attribute, '');
    button.addEventListener('click', () => { actions.dismiss(); action(); });
    parent.append(button);
    return button;
  };
  const capture = async (anchor: HTMLElement) => {
    const view = frame();
    if (!canCapture() || !view?.capturePage) return;
    capturing = true;
    try {
      const image = await view.capturePage();
      if (disposed || !node.isConnected || frame() !== view) return;
      if (image.isEmpty?.()) throw new Error('empty capture');
      const url = image.toDataURL();
      if (!url.startsWith('data:image/png;base64,')) throw new Error('invalid capture');
      const download = document.createElement('a'); download.href = url; download.download = 'browser-screenshot.png';
      download.hidden = true; document.body.append(download); download.click(); download.remove();
    } catch {
      if (!disposed && node.isConnected) actions.notice(anchor, '当前网页截图失败，请等待页面加载完成后重试。');
    } finally { capturing = false; }
  };
  const more = (anchor: HTMLElement) => {
    const content = menu('capture');
    const save = row(content, 'Save screenshot', () => { void capture(anchor); }, 'data-ccd-browser-save-screenshot');
    save.disabled = !canCapture();
    actions.popup(anchor, content, { width: 130, align: 'end' });
  };
  return { more, release() { disposed = true; } };
}
