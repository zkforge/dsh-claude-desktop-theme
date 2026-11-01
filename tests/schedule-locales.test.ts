import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scheduleCopy } from '../src/client/compat/schedule-locales.ts';
import { scheduleTimeLabel } from '../src/client/compat/schedule-detail.ts';

test('schedule copy covers templates and drafts in both interface languages', () => {
  const copy = (lang: string) => scheduleCopy({ documentElement: { lang } } as Document);
  const chinese = copy('zh-CN'), english = copy('en-US');
  assert.equal(chinese.title, '定时任务');
  assert.equal(english.title, 'Scheduled tasks');
  assert.equal(english.suggestions.length, chinese.suggestions.length);
  assert.match(english.defaultPrompt, /^Help me set up a scheduled task/);
  for (const template of english.suggestions) {
    assert.equal(/[\u3400-\u9fff]/u.test(Object.values(template).join('')), false);
    assert.match(template.prompt, /time zone before creating the scheduled task/);
  }
  assert.equal(copy('zh-TW'), chinese);
  assert.equal(copy('de'), english);
  assert.match(english.deleteDescription('用户任务'), /用户任务/);
});

test('schedule time labels follow language while preserving local time and invalid-date handling', () => {
  const now = new Date(2026, 10, 1, 12);
  const time = (day: number, lang: 'zh' | 'en') => scheduleTimeLabel(new Date(2026, 10, day, 9, 5).toISOString(), now, lang);
  assert.equal(time(1, 'en'), 'Today 9:05');
  assert.equal(time(2, 'en'), 'Tomorrow 9:05');
  assert.equal(time(0, 'en'), 'Yesterday 9:05');
  assert.equal(time(4, 'en'), 'Nov 4 9:05');
  assert.equal(time(1, 'zh'), '今天 9:05');
  assert.equal(scheduleTimeLabel('invalid', now, 'en'), '');
});
