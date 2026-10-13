import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountAccountTheme } from '../src/client/compat/account-theme.ts';
import type { ThemePreference, ThemePreferencePort } from '../src/client/contracts/ports.ts';

function fixture(language = 'zh-CN') {
  class Element {
    readonly attributes = new Map<string, string>();
    readonly listeners = new Map<string, (event: Event) => void>();
    children: Element[] = [];
    parentElement: Element | null = null;
    get nextElementSibling(): Element | null {
      const siblings = this.parentElement?.children;
      return siblings?.[siblings.indexOf(this) + 1] ?? null;
    }
    textContent = '';
    ownerDocument = document;
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    getAttribute(key: string) { return this.attributes.get(key) ?? null; }
    append(...nodes: Element[]) {
      nodes.forEach(node => { node.parentElement = this; this.children.push(node); });
    }
    addEventListener(key: string, listener: (event: Event) => void) { this.listeners.set(key, listener); }
    insertBefore(node: Element, anchor: Element) {
      node.parentElement = this;
      this.children.splice(this.children.indexOf(anchor), 0, node);
    }
    remove() {
      const siblings = this.parentElement?.children;
      if (siblings) siblings.splice(siblings.indexOf(this), 1);
      this.parentElement = null;
    }
    focus() { document.activeElement = this; }
    click() { this.listeners.get('click')?.(new Event('click')); }
    querySelector() { return more; }
  }
  const document = {
    documentElement: { lang: language },
    activeElement: null as Element | null,
    createElement: () => new Element(),
  };
  const menu = new Element();
  const settings = new Element();
  const moreWrapper = new Element();
  const anchor = new Element();
  const more = new Element();
  moreWrapper.append(more);
  menu.append(settings, moreWrapper, anchor);
  let preference: ThemePreference = 'system';
  const writes: ThemePreference[] = [];
  const subscribers = new Set<() => void>();
  const theme: ThemePreferencePort = {
    preference: () => preference,
    set(next) { writes.push(next); preference = next; subscribers.forEach(listener => listener()); },
    subscribe(listener) { subscribers.add(listener); return () => { subscribers.delete(listener); }; },
  };
  return { menu, settings, moreWrapper, anchor, theme, writes, subscribers, document };
}

test('account theme follows settings changes, writes the shared preference, and releases its row', () => {
  const f = fixture();
  const dispose = mountAccountTheme(f.menu as unknown as HTMLElement, f.theme);
  const row = f.menu.children[2];
  assert.ok(row);
  assert.deepEqual(f.menu.children, [f.settings, f.moreWrapper, row, f.anchor]);
  const group = row.children[1];
  assert.ok(group);
  const [system, light, dark] = group.children;
  assert.ok(system && light && dark);
  assert.equal(system.getAttribute('aria-checked'), 'true');
  assert.equal(dark.getAttribute('aria-checked'), 'false');
  assert.equal(system.getAttribute('aria-label'), '跟随系统');
  f.theme.set('dark'); // An external settings-page change.
  assert.equal(system.getAttribute('aria-checked'), 'false');
  assert.equal(dark.getAttribute('aria-checked'), 'true');
  light.click();
  assert.equal(f.theme.preference(), 'light');
  assert.deepEqual(f.writes, ['dark', 'light']);
  assert.equal(light.getAttribute('aria-checked'), 'true');
  assert.equal(dark.getAttribute('aria-checked'), 'false');
  dispose();
  assert.equal(f.subscribers.size, 0);
  assert.deepEqual(f.menu.children, [f.settings, f.moreWrapper, f.anchor]);
});

test('left and right wrap within the theme row and select the focused option', () => {
  const f = fixture('en');
  const dispose = mountAccountTheme(f.menu as unknown as HTMLElement, f.theme);
  const group = f.menu.children[2]?.children[1];
  assert.ok(group);
  group.children[0]?.focus();
  const key = (name: string) => {
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperty(event, 'key', { value: name });
    group.listeners.get('keydown')?.(event);
    assert.equal(event.defaultPrevented, true);
  };
  key('ArrowLeft');
  assert.equal(f.theme.preference(), 'dark');
  assert.equal(f.document.activeElement, group.children[2]);
  key('ArrowRight');
  assert.equal(f.theme.preference(), 'system');
  assert.equal(f.document.activeElement, group.children[0]);
  assert.equal(group.children[0]?.getAttribute('aria-label'), 'System');
  dispose();
});

test('without the native theme service no theme row is added', () => {
  const f = fixture();
  mountAccountTheme(f.menu as unknown as HTMLElement, null)();
  assert.deepEqual(f.menu.children, [f.settings, f.moreWrapper, f.anchor]);
});
