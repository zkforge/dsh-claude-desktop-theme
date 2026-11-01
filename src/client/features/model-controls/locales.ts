import { useSyncExternalStore } from 'react';

export const EFFORT_COPY = {
  zh: {
    title: '努力程度', level: '努力程度档位', about: '关于努力程度', faster: '更快', smarter: '更深入', default: '默认',
    help: '思考强度越高，回答越深入，但耗时更长，也会更快消耗余额。',
  },
  en: {
    title: 'Effort', level: 'Effort level', about: 'About effort levels', faster: 'Faster', smarter: 'Smarter', default: 'Default',
    help: 'Higher effort produces more thorough answers, but takes longer and uses more of your balance.',
  },
} as const;

/** Translate standard tier names only; provider-specific names and ids stay intact. */
export function effortLabel(name: string, language: 'zh' | 'en'): string {
  if (language === 'en') return name;
  const labels: Record<string, string> = {
    none: '无', off: '关闭', minimal: '最低', low: '低', medium: '中等', high: '高', xhigh: '极高', ultra: '超高', max: '最高', default: '默认', auto: '自动',
  };
  return labels[name.toLowerCase()] ?? name;
}

function subscribe(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  return () => observer.disconnect();
}

/** The trigger and an already-open panel update without resetting slider state. */
export function useEffortLanguage(): 'zh' | 'en' {
  return useSyncExternalStore(subscribe,
    () => document.documentElement.lang.toLowerCase().startsWith('zh') ? 'zh' : 'en', () => 'en');
}
