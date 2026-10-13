/** Reference browser menus, with native webview capture and honest fallbacks. */
export interface BrowserPopupLayout {
  readonly width: number;
  readonly align: 'start' | 'end';
}
interface BrowserMenuActions {
  popup(anchor: HTMLElement, content: HTMLElement, layout: BrowserPopupLayout): void;
  dismiss(): void;
  notice(anchor: HTMLElement, text: string): void;
  address(): void;
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
  open(anchor: HTMLElement): void;
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
  const section = (parent: HTMLElement, label: string) => {
    const group = document.createElement('section');
    group.setAttribute('role', 'group'); group.setAttribute('aria-label', label);
    const heading = document.createElement('div');
    heading.setAttribute('data-ccd-browser-menu-heading', ''); heading.textContent = label;
    group.append(heading); parent.append(group); return group;
  };
  const separator = (parent: HTMLElement) => {
    const line = document.createElement('hr'); line.setAttribute('role', 'separator'); parent.append(line);
  };
  const unavailable = (parent: HTMLElement, label: string, attribute: string, anchor: HTMLElement, message: string) => {
    const button = row(parent, label, () => actions.notice(anchor, message), attribute);
    button.setAttribute('aria-disabled', 'true');
    return button;
  };
  const open = (anchor: HTMLElement) => {
    const content = menu('sources');
    const servers = section(content, 'Servers');
    const server = document.createElement('div'); server.setAttribute('data-ccd-browser-server', ''); servers.append(server);
    const name = row(server, 'dev', actions.address, 'data-ccd-browser-server-address');
    name.title = 'Enter server address';
    unavailable(server, 'Run', 'data-ccd-browser-run', anchor, 'DSH 尚未开放开发服务器的启动接口。请在终端启动项目，再在标题栏输入 HTTP/HTTPS 服务地址。');
    separator(content);
    const files = section(content, 'Files');
    unavailable(files, 'Open file', 'data-ccd-browser-open-file', anchor, 'DSH 浏览器只接受 HTTP/HTTPS 地址，暂不支持直接打开本地文件；本地文件可通过 Files 面板查看。');
    separator(content);
    const settings = section(content, 'Settings');
    unavailable(settings, 'Keep cookies', 'data-ccd-browser-cookies', anchor, 'DSH 在本次应用运行期间按工作区保留 Cookie，尚未开放跨应用重启保留的开关。');
    unavailable(settings, 'Disable auto verify', 'data-ccd-browser-verify', anchor, 'DSH 未提供 Claude 的浏览器自动验证设置。');
    unavailable(settings, 'Edit configuration in VS Code', 'data-ccd-browser-config', anchor, 'DSH 没有对应的 Claude 浏览器配置文件，暂时无法通过此项在 VS Code 编辑配置。');
    actions.popup(anchor, content, { width: 204, align: 'start' });
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
  return { open, more, release() { disposed = true; } };
}
