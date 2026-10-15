import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import {
  commitColour, commitFont, setOperation, unsetOperation,
} from '../src/client/features/settings/edits.ts';
import { registerSettingsPage } from '../src/client/features/settings/register.ts';
import { SETTINGS_NAMESPACE } from '../src/client/features/settings/locales.ts';

/*
 * The page writes as you go, so every control settles into one operation or one
 * refusal. These cases pin that boundary; the page itself only renders it.
 */

test('an unchanged value writes nothing', () => {
  assert.deepEqual(commitColour(['appearance', 'canvas'], '#303030', '#303030'), { text: '#303030' });
  assert.deepEqual(commitFont(['fonts', 'code'], 'Menlo', 'Menlo'), { text: 'Menlo' });
});

test('a settled colour is normalized and submitted as one write', () => {
  assert.deepEqual(commitColour(['appearance', 'canvas'], ' #ABC ', ''), {
    op: { op: 'set', path: ['appearance', 'canvas'], value: '#aabbcc' },
    text: '#aabbcc',
  });
});

test('an unusable value is refused with the field it belongs to', () => {
  assert.deepEqual(commitColour(['appearance', 'canvas'], 'red', ''), { error: 'error.colour', text: 'red' });
  assert.deepEqual(commitFont(['fonts', 'code'], 'Inter, sans-serif', ''), { error: 'error.font', text: 'Inter, sans-serif' });
});

test('an emptied field clears the override, an empty default writes nothing', () => {
  assert.deepEqual(commitColour(['appearance', 'canvas'], '   ', '#303030'), {
    op: { op: 'unset', path: ['appearance', 'canvas'] }, text: '',
  });
  assert.deepEqual(commitColour(['appearance', 'canvas'], '', ''), { text: '' });
  assert.deepEqual(commitFont(['fonts', 'uiCjk'], '  ', 'PingFang SC'), {
    op: { op: 'unset', path: ['fonts', 'uiCjk'] }, text: '',
  });
});

test('operations carry the nested path the transport expects', () => {
  assert.deepEqual(setOperation(['features', 'sidebar'], false), {
    op: 'set', path: ['features', 'sidebar'], value: false,
  });
  assert.deepEqual(unsetOperation(['fonts', 'code']), { op: 'unset', path: ['fonts', 'code'] });
});

interface FakeChild {
  readonly locale: { bind(ns: string): (key: string) => string; register(ns: string, dicts: Record<string, unknown>): () => void };
  effect(callback: () => unknown, label?: string): () => void;
  readonly slots: {
    inject(name: string, register: () => () => void): () => void;
    register(options: { name: string; id: string; order: number; label: () => string; locale?: string }, component: unknown): () => void;
  };
}

function fakeContext() {
  const events: string[] = [];
  const registrations: Array<{ name: string; id: string; order: number; label: () => string; locale?: string }> = [];
  const dictionaries: string[] = [];
  const injected: string[] = [];
  const child: FakeChild = {
    locale: {
      bind: () => key => key === 'nav' ? 'Claude 主题' : key,
      register(ns, dicts) {
        dictionaries.push(`${ns}:${Object.keys(dicts).sort().join(',')}`);
        events.push('dictionary');
        return () => { events.push('dictionary released'); };
      },
    },
    effect(callback) {
      callback();
      return () => {};
    },
    slots: {
      inject(name, register) {
        events.push(`inject:${name}`);
        return register();
      },
      register(options) {
        registrations.push(options);
        events.push('page registered');
        return () => { events.push('page released'); };
      },
    },
  };
  const ctx = {
    inject(deps: string[], callback: (scope: FakeChild) => unknown) {
      injected.push(deps.join(','));
      callback(child);
      return { dispose: () => { events.push('injection released'); } };
    },
  } as unknown as Context;
  return { ctx, events, registrations, dictionaries, injected };
}

test('the page registers as a localized main settings section', () => {
  const fake = fakeContext();
  registerSettingsPage(fake.ctx, 'ui-skin-ccd-style', () => null);
  assert.deepEqual(fake.injected, ['slots,locale']);
  assert.deepEqual(fake.dictionaries, [`${SETTINGS_NAMESPACE}:en,zh`]);
  assert.equal(fake.registrations[0]?.label(), 'Claude 主题');
  assert.deepEqual(fake.registrations.map(({ label, ...options }) => options), [{
    name: 'settings.section',
    order: 20,
    id: 'ui-skin-ccd-style',
    locale: SETTINGS_NAMESPACE,
  }]);
  assert.deepEqual(fake.events, ['dictionary', 'inject:settings.section', 'page registered']);
});

test('releasing the registration disposes the injected scope', () => {
  const fake = fakeContext();
  const registration = registerSettingsPage(fake.ctx, 'ui-skin-ccd-style', () => null);
  registration.dispose();
  assert.ok(fake.events.includes('injection released'));
});
