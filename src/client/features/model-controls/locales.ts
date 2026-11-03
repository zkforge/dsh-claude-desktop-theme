import { useSyncExternalStore } from 'react';

export const EFFORT_COPY = {
  zh: {
    title: '思考强度', level: '思考强度档位', faster: '更快', smarter: '更深入',
    help: '思考强度越高，回答越深入，但耗时更长，也会更快消耗余额。',
  },
  en: {
    title: 'Effort', level: 'Effort level', faster: 'Faster', smarter: 'Smarter',
    help: 'Higher effort produces more thorough answers, but takes longer and uses more of your balance.',
  },
} as const;

export const MODEL_COPY = {
  zh: {
    session: '本次会话', more: '更多模型', pin: '设为常用模型', unpin: '从常用模型移除', full: '最多 4 个常用模型，请先移除一个',
  },
  en: {
    session: 'this session', more: 'More models', pin: 'Add to main menu', unpin: 'Remove from main menu', full: 'The menu holds 4 models. Remove one first',
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
