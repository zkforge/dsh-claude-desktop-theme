import type { PersonalizationConfig } from '../../shared/config.ts';
import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import { recordsInTranscript } from './mutation-scope.ts';

/** The greeting follows the interface language and never includes an account name. */
export function claudeGreeting(language = ''): string {
  return language.toLowerCase().startsWith('zh') ? '接下来想做什么？' : 'What’s up next?';
}

/** Add a reversible presentation beside the native heading without taking its React nodes. */
export function mountHeroGreeting(document: Document, config: PersonalizationConfig): Disposer {
  if (config.greetingStyle !== 'claude') return () => {};
  const host = hostSelectors(document);
  const added = new Map<HTMLElement, HTMLElement>();
  const titles = new Map<HTMLElement, HTMLElement>();
  const sync = () => {
    for (const [heading, copy] of added) {
      if (heading.isConnected) continue;
      copy.remove();
      heading.removeAttribute('data-ccd-greeting-style');
      added.delete(heading);
      titles.delete(heading);
    }
    const greeting = claudeGreeting(document.documentElement.lang || '');
    for (const heading of document.querySelectorAll<HTMLElement>(host.heroHeadline)) {
      const existing = titles.get(heading);
      if (existing !== undefined) {
        if (existing.textContent !== greeting) existing.textContent = greeting;
        continue;
      }
      const copy = document.createElement('span');
      copy.setAttribute('data-ccd-greeting', '');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');
      icon.setAttribute('aria-hidden', 'true');
      // Trace of the supplied 44-device-pixel mark, in a 24px box at @2x.
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M19.5 11.5L19.5 12L17.5 12L17.5 12.5L16 12.5L16 13L21.5 13L21.5 13.5L22.5 13.5L22.5 14L23 14L23 14.5L22.5 14.5L22.5 15L20 15L20 14.5L18 14.5L18 14L16 14L16 13.5L15.5 13.5L15.5 14.5L16 14.5L16 15L16.5 15L16.5 15.5L17.5 15.5L17.5 16L18 16L18 16.5L18.5 16.5L18.5 17L19 17L19 17.5L19.5 17.5L19.5 18L20 18L20 18.5L20.5 18.5L20.5 19.5L20 19.5L20 19L19 19L19 18.5L18.5 18.5L18.5 18L18 18L18 17.5L17.5 17.5L17.5 17L16.5 17L16.5 16.5L16 16.5L16 16L15.5 16L15.5 16.5L16 16.5L16 17.5L16.5 17.5L16.5 18L17 18L17 19L17.5 19L17.5 19.5L18 19.5L18 21L16.5 21L16.5 20.5L16 20.5L16 19.5L15.5 19.5L15.5 19L15 19L15 18.5L14.5 18.5L14.5 17.5L14 17.5L14 16.5L13.5 16.5L13.5 16L13 16L13 17.5L12.5 17.5L12.5 22.5L12 22.5L12 23L11.5 23L11.5 22.5L11 22.5L11 22L10.5 22L10.5 21.5L11 21.5L11 19L11.5 19L11.5 16.5L12 16.5L12 15.5L11 15.5L11 16L10.5 16L10.5 17L10 17L10 17.5L9.5 17.5L9.5 18.5L9 18.5L9 19L8.5 19L8.5 19.5L8 19.5L8 20L7.5 20L7.5 20.5L7 20.5L7 21L6 21L6 20L6.5 20L6.5 19.5L7 19.5L7 19L7.5 19L7.5 18L8 18L8 17.5L8.5 17.5L8.5 17L9 17L9 16.5L9.5 16.5L9.5 15.5L10 15.5L10 15L10.5 15L10.5 14.5L9.5 14.5L9.5 15L9 15L9 15.5L8 15.5L8 16L7.5 16L7.5 16.5L6.5 16.5L6.5 17L6 17L6 17.5L5 17.5L5 18L3.5 18L3.5 17L4 17L4 16.5L4.5 16.5L4.5 16L5.5 16L5.5 15.5L6 15.5L6 15L7 15L7 14.5L8 14.5L8 14L9 14L9 13.5L9.5 13.5L9.5 13L8 13L8 12.5L1.5 12.5L1.5 12L1 12L1 11.5L8 11.5L8 12L9.5 12L9.5 11L8.5 11L8.5 10.5L8 10.5L8 10L7 10L7 9.5L6.5 9.5L6.5 9L5.5 9L5.5 8.5L5 8.5L5 8L4 8L4 7.5L3.5 7.5L3.5 7L3 7L3 5.5L3.5 5.5L3.5 5L4 5L4 5.5L5 5.5L5 6L5.5 6L5.5 6.5L6 6.5L6 7L7 7L7 7.5L7.5 7.5L7.5 8L8 8L8 8.5L8.5 8.5L8.5 9L9.5 9L9.5 8.5L9 8.5L9 7.5L8.5 7.5L8.5 6.5L8 6.5L8 5.5L7.5 5.5L7.5 4.5L7 4.5L7 4L6.5 4L6.5 3L6 3L6 2L6.5 2L6.5 1.5L7 1.5L7 1L8 1L8 1.5L8.5 1.5L8.5 2L9 2L9 3.5L9.5 3.5L9.5 4.5L10 4.5L10 5.5L10.5 5.5L10.5 6.5L11 6.5L11 7.5L11.5 7.5L11.5 8.5L12 8.5L12 9.5L12.5 9.5L12.5 4.5L13 4.5L13 2L13.5 2L13.5 1.5L14.5 1.5L14.5 2L15 2L15 2.5L14.5 2.5L14.5 5L14 5L14 7.5L13.5 7.5L13.5 8.5L14.5 8.5L14.5 8L15 8L15 7L15.5 7L15.5 6.5L16 6.5L16 6L16.5 6L16.5 5.5L17 5.5L17 4.5L17.5 4.5L17.5 4L18 4L18 3.5L19.5 3.5L19.5 4L20 4L20 5L19.5 5L19.5 6L19 6L19 6.5L18.5 6.5L18.5 7.5L18 7.5L18 8L17.5 8L17.5 8.5L17 8.5L17 9.5L16.5 9.5L16.5 10L16 10L16 11L16.5 11L16.5 10.5L18.5 10.5L18.5 10L21.5 10L21.5 9.5L22 9.5L22 10L23 10L23 10.5L22.5 10.5L22.5 11L22 11L22 11.5Z');
      icon.append(path);
      const title = document.createElement('span');
      title.textContent = greeting;
      copy.append(icon, title);
      heading.setAttribute('data-ccd-greeting-style', 'claude');
      heading.append(copy);
      added.set(heading, copy);
      titles.set(heading, title);
    }
  };
  const observer = new MutationObserver(records => { if (!recordsInTranscript(records)) sync(); });
  observer.observe(document.body, {
    childList: true, subtree: true,
    attributes: true, attributeFilter: ['lang'],
  });
  sync();
  return () => {
    observer.disconnect();
    for (const [heading, copy] of added) {
      copy.remove();
      heading.removeAttribute('data-ccd-greeting-style');
    }
    added.clear();
    titles.clear();
  };
}
