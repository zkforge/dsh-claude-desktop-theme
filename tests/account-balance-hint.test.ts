import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountAccountBalanceHint } from '../src/client/compat/account-balance-hint.ts';

function fixture() {
  const view = Object.assign(new EventTarget(), { innerWidth: 800, innerHeight: 600 });
  class Element extends EventTarget {
    ownerDocument = document;
    children: Element[] = [];
    attributes = new Map<string, string>();
    style: Record<string, string> = {};
    className = '';
    textContent = '';
    id = '';
    hidden = false;
    popover = '';
    open = false;
    removed = false;
    innerHTML = '';
    dataset: Record<string, string> = {};
    classList = { add() {} };
    rect = { left: 20, right: 260, top: 480, bottom: 510, width: 240, height: 30 };
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    removeAttribute(name: string) { this.attributes.delete(name); }
    append(...nodes: (Element | string)[]) { this.children.push(...nodes.filter(node => typeof node !== 'string')); }
    replaceChildren() { this.children = []; }
    getBoundingClientRect() { return this.rect; }
    showPopover() { this.open = true; }
    hidePopover() { this.open = false; }
    remove() { this.removed = true; }
  }
  const document = Object.assign(new EventTarget(), {
    defaultView: view,
    createElement: () => {
      const element = new Element();
      element.rect = { left: 0, right: 276, top: 0, bottom: 160, width: 276, height: 160 };
      return element;
    },
    createElementNS: () => new Element(),
  });
  const menu = new Element(), row = new Element();
  const hint = mountAccountBalanceHint(menu as unknown as HTMLElement, row as unknown as HTMLElement, true);
  const panel = menu.children[0]!;
  return { hint, panel, row, view, document };
}

test('balance hint keeps zero grants visible, opens after a delay and stays inside the viewport', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { hint, panel, row } = fixture();
  t.after(hint.dispose);
  const now = Date.parse('2026-10-20T10:00:00+08:00');
  hint.update({ balance: { total: '10.00', toppedUp: '10.00', granted: '0.00' },
    today: '1.20', rate: '2.50', rateDays: 3, days: 4 }, '', now);
  assert.equal(panel.children[1]!.textContent, '总余额 ¥10.00');
  const usage = panel.children[2]!;
  assert.equal(usage.hidden, false);
  assert.equal(usage.children[1]!.textContent, '¥1.20');
  assert.equal(usage.children[2]!.textContent, '近 3 天日均');
  assert.equal(usage.children[3]!.textContent, '¥2.50');
  assert.equal(usage.children[5]!.textContent, '约 4 天');
  const rates = panel.children[3]!;
  assert.equal(rates.children[1]!.textContent, '¥10.00');
  assert.equal(rates.children[3]!.textContent, '¥0.00');
  const period = panel.children[4]!;
  assert.equal(period.hidden, false);
  assert.equal(period.children[0]!.dataset['peak'], 'true');
  assert.equal(period.children[1]!.textContent, '距谷时还有 2 小时');
  row.dispatchEvent(new Event('pointerenter'));
  t.mock.timers.tick(499);
  assert.equal(panel.open, false);
  t.mock.timers.tick(1);
  assert.equal(panel.open, true);
  assert.equal(panel.style.left, '268px');
  assert.equal(panel.style.top, '350px', 'bottom rows grow the hint upwards');
  assert.equal(row.attributes.get('aria-describedby'), panel.id);
  row.dispatchEvent(new Event('pointerleave'));
  t.mock.timers.tick(100);
  panel.dispatchEvent(new Event('pointerenter'));
  t.mock.timers.tick(100);
  assert.equal(panel.open, true, 'crossing the gap into the hint keeps it open');
  panel.dispatchEvent(new Event('pointerleave'));
  t.mock.timers.tick(120);
  assert.equal(panel.hidden, true);
  assert.equal(row.attributes.has('aria-describedby'), false);
});

test('keyboard focus, Escape, failed refreshes and cleanup do not leave a stale hint', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { hint, panel, row, view } = fixture();
  t.after(hint.dispose);
  hint.update({ balance: { total: '12', toppedUp: '10', granted: '2' },
    today: '0.00', rate: null, rateDays: 0, days: null }, '', Date.now());
  row.rect = { left: 530, right: 770, top: 100, bottom: 130, width: 240, height: 30 };
  row.dispatchEvent(new Event('focus'));
  t.mock.timers.tick(500);
  assert.equal(panel.style.left, '246px', 'falls back to the left near the right edge');
  assert.equal(panel.style.top, '100px');
  hint.update(undefined, '查询失败 · 点击重试', Date.now());
  assert.equal(panel.children[1]!.textContent, '查询失败 · 点击重试');
  assert.equal(panel.children[2]!.hidden, true, 'failed queries never show old spend');
  assert.equal(panel.children[3]!.hidden, true, 'failed queries never show old amounts');
  const escape = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
  view.dispatchEvent(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(panel.open, false);
  row.dispatchEvent(new Event('focus'));
  hint.dispose();
  t.mock.timers.tick(500);
  assert.equal(panel.open, false);
  assert.equal(panel.removed, true);
  assert.equal(row.attributes.has('aria-describedby'), false);
});
