import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { createNavigationHistory, type NavigationHistoryPort } from './navigation-history.ts';

/** Add only plugin-owned nodes; React's toggle and shortcut nodes stay put. */
export function mountNavigationHistory(document: Document, port: NavigationHistoryPort, report: (error: unknown) => void): Disposer {
  /* A browser host carries no `data-platform` (the desktop preload writes it)
     and its sidebar has no window-control row to hang the arrows on; the web
     page keeps the header to the brand row alone. */
  if (document.documentElement.dataset.platform === undefined) return () => {};
  const group = document.createElement('nav');
  group.setAttribute('data-ccd-navigation-history', '');
  const buttons = ([-1, 1] as const).map(direction => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-ccd-history-direction', direction === -1 ? 'back' : 'forward');
    // Bundled SVG; no user or host HTML is interpolated.
    button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${direction === -1 ? 'M19 12H5m7-7-7 7 7 7' : 'M5 12h14m-7-7 7 7-7 7'}"/></svg>`;
    button.addEventListener('click', () => history.go(direction));
    group.append(button);
    return button;
  });
  const draw = () => {
    const chinese = document.documentElement.lang.toLowerCase().startsWith('zh');
    group.setAttribute('aria-label', chinese ? '导航历史' : 'Navigation history');
    buttons.forEach((button, index) => {
      const label = chinese ? (index === 0 ? '后退' : '前进') : (index === 0 ? 'Back' : 'Forward');
      if (button.getAttribute('aria-label') !== label) {
        button.setAttribute('aria-label', label); button.title = label;
      }
      button.disabled = !history.canGo(index === 0 ? -1 : 1);
    });
  };
  // The history's first change is synchronous, before this binding exists.
  let ready = false;
  const history = createNavigationHistory(port, () => { if (ready) draw(); }, report);
  ready = true;
  const place = () => {
    const host = hostSelectors(document);
    const mac = document.documentElement.dataset.platform === 'darwin';
    const leading = document.querySelector('[data-shell-leading]');
    if (mac && leading) {
      const toggle = leading.querySelector('button');
      // Tooltip's wrapper is a native sibling of the New Session wrapper.
      let seat: Element | null = toggle;
      while (seat?.parentElement && seat.parentElement !== leading
        && seat.parentElement.querySelectorAll('button').length === 1) seat = seat.parentElement;
      if (seat && group.previousElementSibling !== seat) seat.after(group);
    } else if (mac) {
      const strip = document.querySelector(host.sidebarTopStrip);
      if (strip && group.parentElement !== strip) strip.append(group);
      else if (!strip) group.remove();
    } else if (document.documentElement.hasAttribute('data-windows-titlebar')) {
      // The Windows sidebar collapses to zero width. Keep this plugin-owned
      // group in the frame so sidebar clipping cannot hide caption controls.
      const frame = document.querySelector(host.frame);
      if (frame && group.parentElement !== frame) frame.append(group);
      else if (!frame) group.remove();
    } else {
      // Other platforms keep native caption menus intact; use a compact row
      // at the top of the sidebar (a vertical pair in the collapsed rail).
      const root = document.querySelector(host.sidebarRoot);
      if (root && group.parentElement !== root) root.prepend(group);
      else if (!root) group.remove();
    }
    draw();
  };
  const observer = new MutationObserver(records => {
    if (records.some(record => !group.contains(record.target))) place();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-sidebar-collapsed'] });
  const language = new MutationObserver(place);
  language.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'data-platform', 'data-windows-titlebar'] });
  place();
  return () => { history.dispose(); observer.disconnect(); language.disconnect(); group.remove(); };
}
