import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';
import type { PermissionPlanPort } from './permission-plan-port.ts';
import { recordsInTranscript } from './mutation-scope.ts';

/** Names the preset a tagged row switches to; `theme/menus.css` keys the two-line cell off it. */
export const PERMISSION_MODE_ATTRIBUTE = 'data-ccd-permission-mode';

/** Tags the card those rows sit in, so the stylesheet can reach the card itself. */
export const PERMISSION_MENU_ATTRIBUTE = 'data-ccd-permission-menu';

/** One preset as the card draws it. */
export interface PermissionPresetCopy {
  /** DSH's machine value for the preset (`read-only`, `auto`, …): the row's identity, never shown. */
  readonly value: string;
  /** The name DSH renders, which is what a row is recognised by. */
  readonly name: string;
  /** Reference label drawn in the menu and the Composer chip. */
  readonly label: string;
  readonly aliases?: readonly string[];
  /** The preset's trailing badge: the word DSH prints, and the word to print instead. */
  readonly badge?: { readonly host: string; readonly text: string };
  /** The row's second line, saying what the mode does. */
  readonly description: string;
}

/** The card's copy in one language. */
export interface PermissionCopy {
  /** The group's name, above the rows — the one thing the reference writes that the host does not. */
  readonly heading: string;
  readonly presets: readonly PermissionPresetCopy[];
}

/** Reference labels over DSH identities; descriptions preserve sandbox semantics. */
const ZH: PermissionCopy = {
  heading: '模式',
  presets: [
    { value: 'read-only', name: '仅可查看', label: '手动', description: '只读访问，修改文件需另行批准' },
    { value: 'workspace-write', name: '工作区内修改', label: '接受编辑', description: '自动接受工作区内的文件编辑' },
    { value: 'danger-full-access', name: '完全权限', label: '跳过权限确认', description: '接受所有权限' },
    {
      value: 'auto', name: 'Auto review', label: '自动', aliases: ['自动审查'],
      badge: { host: 'EXP', text: '实验' },
      description: '由模型审查并批准工具调用',
    },
  ],
};

/** English reference labels over the same host identities. */
const EN: PermissionCopy = {
  heading: 'Mode',
  presets: [
    { value: 'read-only', name: 'Read Only', label: 'Manual', description: 'Read-only access; edits require approval' },
    { value: 'workspace-write', name: 'Workspace Write', label: 'Accept edits', description: 'Automatically accept workspace file edits' },
    { value: 'danger-full-access', name: 'Full access', label: 'Bypass permissions', description: 'Accept all permissions' },
    {
      value: 'auto', name: 'Auto review', label: 'Auto',
      badge: { host: 'EXP', text: 'EXP' },
      description: 'Let the model review and approve tool calls',
    },
  ],
};

/**
 * The card's copy for the document on screen.
 *
 * DSH localises its own strings through `ctx.locale`; a third-party plugin may
 * not borrow another package's namespace, so the second line follows the
 * document language instead — the same rule `compat/header-labels.ts` follows.
 *
 * @param document - renderer document whose language DSH sets from the locale.
 * @returns Chinese copy for a Chinese document, English otherwise.
 */
export function permissionCopy(document: Document): PermissionCopy {
  const language = (document.documentElement.lang || globalThis.navigator?.language || '').toLowerCase();
  return language.startsWith('zh') ? ZH : EN;
}

/** Short summaries of DSH's four built-in Agent presets. */
export function agentPresetCopy(document: Document): PermissionCopy {
  const zh = permissionCopy(document) === ZH;
  const names = zh
    ? ['标准模式', 'PTC 模式', '极简模式', '创造模式']
    : ['Standard', 'PTC', 'Minimal', 'Creator'];
  const descriptions = zh
    ? ['处理代码、文件和资料', '批量调用工具，筛选和汇总结果', '使用终端和图片读取工具', '编写插件、扩展界面和创建模式']
    : ['Work with code, files and documents', 'Run tools in batches, filter and summarize results', 'Use terminal and image-reading tools', 'Build plugins, extend the UI and create presets'];
  return {
    heading: zh ? 'Agent 预设' : 'Agent presets',
    presets: ['standard', 'ptc', 'minimal', 'cordis'].map((value, index) => ({
      value, name: names[index]!, label: names[index]!, description: descriptions[index]!,
    })),
  };
}

export function mountAgentPresetMenu(document: Document, report: (error: unknown) => void): Disposer {
  return mountChoiceMenu(document, report, agentPresetCopy(document), true);
}

/** One text node this module rewrote, and both ends of the rewrite. */
interface Drawn {
  readonly node: Text;
  readonly original: string;
  readonly drawn: string;
}

/** Keep native permission actions, with the host's independent /plan command. */
export function mountPermissionMenu(
  document: Document, report: (error: unknown) => void, plan?: PermissionPlanPort,
): Disposer {
  const copy = permissionCopy(document);
  const order = ['auto', 'read-only', 'workspace-write', 'plan', 'danger-full-access'];
  const zh = copy === ZH;
  const presets = [...copy.presets, ...(plan === undefined ? [] : [{
    value: 'plan', name: zh ? '计划' : 'Plan', label: zh ? '计划' : 'Plan',
    description: zh ? '在进行更改前制定计划' : 'Make a plan before making changes',
  }])].sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value));
  return mountChoiceMenu(document, report, { ...copy, presets }, false, plan);
}

/** Shared two-line rows, heading, numeric selection and reversible DOM writes. */
function mountChoiceMenu(
  document: Document, report: (error: unknown) => void, copy: PermissionCopy, agent = false, plan?: PermissionPlanPort,
): Disposer {
  const host = hostSelectors(document);
  const modeAttribute = agent ? 'data-ccd-agent-mode' : PERMISSION_MODE_ATTRIBUTE;
  const menuAttribute = agent ? 'data-ccd-agent-menu' : PERMISSION_MENU_ATTRIBUTE;
  const descriptionAttribute = agent ? 'data-ccd-agent-desc' : 'data-ccd-permission-desc';
  const headingAttribute = agent ? 'data-ccd-agent-heading' : 'data-ccd-permission-heading';
  const shortcutAttribute = agent ? 'data-ccd-agent-shortcut' : 'data-ccd-permission-shortcut';
  const drawn: Drawn[] = [];
  const added: HTMLElement[] = [];
  const marked: HTMLElement[] = [];
  let trigger: HTMLElement | null = null;
  let attached: HTMLElement | null = null;
  let scheduled = 0;
  let disposed = false;
  let busy = false;
  let forwarding = false;
  const orders = new Map<HTMLElement, Element[]>();
  const recognised = new WeakMap<Element, PermissionPresetCopy>();
  const sessionId = () => trigger?.closest('[data-conversation-session]')
    ?.getAttribute('data-conversation-session') ?? null;
  const planState = () => {
    const id = sessionId();
    return id === null ? null : plan?.read(id) ?? null;
  };

  /** Drop the records of a card the host has already unmounted. */
  const prune = () => {
    for (const viewport of orders.keys()) if (!viewport.isConnected) orders.delete(viewport);
    for (let index = drawn.length - 1; index >= 0; index -= 1) {
      if (!drawn[index]!.node.isConnected) drawn.splice(index, 1);
    }
    for (let index = added.length - 1; index >= 0; index -= 1) {
      if (!added[index]!.isConnected) added.splice(index, 1);
    }
    for (let index = marked.length - 1; index >= 0; index -= 1) {
      if (!marked[index]!.isConnected) marked.splice(index, 1);
    }
  };

  /** Put every node back the way the host left it. */
  const restore = () => {
    for (const record of drawn) {
      /* Only a node still carrying what was written is restored: the host may
         have re-rendered it, and its text then belongs to React again. */
      if (record.node.isConnected && record.node.data === record.drawn) {
        record.node.data = record.original;
      }
    }
    drawn.length = 0;
    trigger?.removeAttribute('data-ccd-plan-label');
    for (const [viewport, children] of orders) {
      for (const child of children) if (child.parentElement === viewport) viewport.append(child);
    }
    orders.clear();
    for (const node of added) node.remove();
    added.length = 0;
    for (const node of marked) {
      node.removeAttribute(modeAttribute);
      node.removeAttribute(menuAttribute);
      node.removeAttribute('data-ccd-plan-active');
    }
    marked.length = 0;
  };

  /**
   * One run of text, replaced where it says exactly `from`.
   *
   * The comparison is against a node's own trimmed text rather than against the
   * label's, because a label can hold more than the name: the option row wraps
   * its name and its badge in one span, and the trigger keeps its badge beside
   * the label instead. Replacing the run rather than assigning over the whole
   * node is also what makes the pass idempotent — a node that now carries the
   * new wording no longer matches, so a second pass writes nothing.
   */
  const replace = (root: Element, from: string, to: string) => {
    if (from === to) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let found = walker.nextNode(); found !== null; found = walker.nextNode()) {
      const node = found as Text;
      if (node.data.trim() !== from) continue;
      const original = node.data;
      node.data = original.replace(from, to);
      drawn.push({ node, original, drawn: node.data });
    }
  };

  /**
   * The name a control draws.
   *
   * Two shapes reach here and both land on the name alone: a plain label is its
   * own name, and the one preset DSH badges wraps its name in a span beside the
   * badge (`PermissionSelect`'s `optionLabel`, whose whole point is to keep the
   * two apart for the accessible label). The wrapper is read by its class rather
   * than by dropping the badge's text out of the label, because the badge is a
   * word this module rewrites: a later pass would be subtracting the *new*
   * wording from a name it no longer has anything to do with.
   */
  const nameOf = (label: Element): string =>
    (agent ? label.querySelector(':scope > span > :first-child')?.textContent ?? ''
      : label.querySelector(host.permissionSelectOptionLabelText)?.textContent ?? label.textContent ?? '').trim();

  /** The preset a control is showing, by the name it draws. */
  const presetOf = (label: Element): PermissionPresetCopy | undefined => {
    const name = nameOf(label);
    const previous = recognised.get(label);
    const preset = copy.presets.find(preset => preset.name === name || preset.aliases?.includes(name))
      ?? (previous?.label === name ? previous : undefined);
    if (preset) recognised.set(label, preset);
    return preset;
  };

  /** Write one control's own words: its name, and the badge beside it. */
  const drawName = (label: Element, badge: Element | null, preset: PermissionPresetCopy) => {
    replace(label, preset.name, preset.label);
    for (const alias of preset.aliases ?? []) replace(label, alias, preset.label);
    if (badge !== null && preset.badge !== undefined) {
      replace(badge, preset.badge.host, preset.badge.text);
    }
  };

  /** Tag the card these rows sit in and name the group above them. */
  const drawCard = (row: HTMLElement) => {
    const card = row.closest<HTMLElement>(host.menu);
    if (card === null) return;
    card.setAttribute(menuAttribute, '');
    if (!marked.includes(card)) marked.push(card);
    const viewport = card.querySelector<HTMLElement>(host.menuViewport);
    if (viewport === null) return;
    if (viewport.querySelector(`:scope > [${headingAttribute}]`) !== null) return;
    /* A `role="presentation"` div is the host's own heading row — `Menu` renders
       a `{ type: 'label' }` entry exactly this way — and it stays out of the
       keyboard's walk, which collects buttons. */
    const heading = document.createElement('div');
    heading.setAttribute(headingAttribute, '');
    heading.setAttribute('role', 'presentation');
    heading.textContent = copy.heading;
    viewport.prepend(heading);
    added.push(heading);
  };

  /** Write one row: the host's words where the reference keeps them, and the second line under them. */
  const drawRow = (row: HTMLElement) => {
    const label = row.querySelector<HTMLElement>(host.menuItemLabel);
    if (label === null) return;
    const badge = row.querySelector<HTMLElement>(host.permissionSelectBadge);
    const preset = presetOf(label);
    if (preset === undefined) return;
    drawName(label, badge, preset);
    row.setAttribute(modeAttribute, preset.value);
    if (!marked.includes(row)) marked.push(row);
    if (row.querySelector(`:scope > [${descriptionAttribute}]`) === null) {
      const description = document.createElement('span');
      description.setAttribute(descriptionAttribute, '');
      description.textContent = preset.description;
      label.after(description);
      added.push(description);
    }
    if (row.querySelector(`:scope > [${shortcutAttribute}]`) === null) {
      const shortcut = document.createElement('span');
      shortcut.setAttribute(shortcutAttribute, '');
      shortcut.setAttribute('aria-hidden', 'true');
      shortcut.textContent = String(copy.presets.indexOf(preset) + 1);
      row.append(shortcut);
      added.push(shortcut);
    }
    drawCard(row);
  };

  /**
   * Write the status bar's chip.
   *
   * The chip draws the current mode's name, so it takes the same wording the
   * card's row does: two names for one mode, a chip's width apart, is the one
   * thing in this change that would read as a bug.
   */
  const drawTrigger = (element: HTMLElement) => {
    const label = element.querySelector<HTMLElement>(host.permissionSelectLabel);
    if (label === null) return;
    const badge = element.querySelector<HTMLElement>(host.permissionSelectBadge);
    const preset = presetOf(label);
    if (preset === undefined) return;
    drawName(label, badge, preset);
  };

  const sync = () => {
    scheduled = 0;
    prune();
    if (trigger !== null) {
      drawTrigger(trigger);
      const label = planState()?.active ? (copy.presets.find(preset => preset.value === 'plan')?.label ?? '') : '';
      if (label) trigger.setAttribute('data-ccd-plan-label', label);
      else trigger.removeAttribute('data-ccd-plan-label');
    }
    /* The rows exist only while the card is open, and `[role="menu"]` is absent
       from the tree at every other moment — so one query keeps the whole row
       scan off the streaming transcript's mutation traffic. */
    if (document.querySelector(host.menu) === null) return;
    for (const row of document.querySelectorAll<HTMLElement>(host.menuItem)) drawRow(row);
    if (agent) return;
    for (const card of document.querySelectorAll<HTMLElement>(`[${menuAttribute}]`)) {
      const viewport = card.querySelector<HTMLElement>(host.menuViewport);
      if (viewport === null) continue;
      if (!orders.has(viewport)) orders.set(viewport, [...viewport.children]);
      const state = planState();
      let row = viewport.querySelector<HTMLButtonElement>('[data-ccd-permission-mode="plan"]');
      if (state !== null && row === null) {
        const sample = viewport.querySelector<HTMLElement>(host.menuItem);
        const sampleLabel = sample?.querySelector<HTMLElement>(host.menuItemLabel);
        if (sample && sampleLabel) {
          row = document.createElement('button');
          row.type = 'button';
          row.className = sample.className;
          row.setAttribute('role', 'menuitem');
          const label = document.createElement('span');
          label.className = sampleLabel.className;
          label.textContent = copy.presets.find(preset => preset.value === 'plan')!.label;
          row.append(label);
          viewport.append(row);
          added.push(row);
          drawRow(row);
        }
      }
      if (row) { row.hidden = state === null; row.setAttribute('aria-pressed', String(state?.active ?? false)); }
      card.toggleAttribute('data-ccd-plan-active', state?.active ?? false);
      const rows = [...viewport.querySelectorAll<HTMLElement>(`[${modeAttribute}]`)];
      const sorted = [...rows].sort((a, b) => copy.presets.findIndex(p => p.value === a.getAttribute(modeAttribute))
        - copy.presets.findIndex(p => p.value === b.getAttribute(modeAttribute)));
      if (rows.some((item, index) => item !== sorted[index])) for (const item of sorted) viewport.append(item);
    }
  };

  /**
   * Observer callbacks are batched into one microtask, and the writes have to
   * land in the commit that renders the card even while the window is occluded
   * and animation frames are throttled.
   */
  const schedule = () => {
    if (scheduled !== 0) return;
    scheduled = 1;
    try {
      sync();
    } finally {
      scheduled = 0;
    }
  };

  // Only an open permission card owns bare digits. Delegate selection to the
  // real button so locked rows and the host's confirmation dialogs still apply.
  const onKey = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.isComposing
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const index = /^[1-9]$/u.test(event.key) ? Number(event.key) - 1 : -1;
    const preset = copy.presets[index];
    if (preset === undefined) return;
    const card = document.querySelector<HTMLElement>(`[${menuAttribute}]`);
    if (card === null) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    const row = card.querySelector<HTMLButtonElement>(`[${modeAttribute}="${preset.value}"]`);
    if (row === null || row.hidden || row.disabled || row.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    event.stopPropagation();
    row.click();
  };

  // A native permission selection leaves plan mode before forwarding its click.
  const onClick = (event: MouseEvent) => {
    if (agent || !plan || forwarding) return;
    const row = (event.target as Element | null)?.closest<HTMLButtonElement>(`[${modeAttribute}]`);
    const id = sessionId();
    if (!row || !id || row.disabled || row.getAttribute('aria-disabled') === 'true') return;
    if (busy) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const entering = row.getAttribute(modeAttribute) === 'plan';
    if (!entering && !planState()?.active) return;
    event.preventDefault();
    event.stopPropagation();
    busy = true;
    const selectedTrigger = trigger;
    void plan.set(id, entering).then(() => {
      if (disposed || sessionId() !== id || trigger !== selectedTrigger) return;
      if (entering) selectedTrigger?.click();
      else if (row.isConnected) {
        forwarding = true;
        try { row.click(); } finally { forwarding = false; }
      }
    }).catch(error => {
      report(error);
      if (!disposed && row.isConnected) {
        let status = row.parentElement?.querySelector<HTMLElement>('[data-ccd-plan-error]');
        if (!status) {
          status = document.createElement('div');
          status.setAttribute('data-ccd-plan-error', '');
          status.setAttribute('role', 'alert');
          row.parentElement?.append(status);
          added.push(status);
        }
        status.textContent = error instanceof Error ? error.message : String(error);
      }
    }).finally(() => { busy = false; });
  };
  let unsubscribe: Disposer | undefined;
  let tree: MutationObserver | undefined;
  let contents: MutationObserver | undefined;
  try {
    /* The card is portalled into `body` and the chip is rebuilt with the
       Composer, so both arrive — and leave — as tree changes. The chip's name is
       the one write that is a text change rather than a mount, so the chip
       carries an observer of its own; it is re-attached whenever the host
       replaces the control. */
    tree = new MutationObserver(records => {
      if (recordsInTranscript(records)) return;
      const found = agent ? null : document.querySelector<HTMLElement>(host.permissionSelectTrigger);
      if (found !== attached) {
        contents?.disconnect();
        attached = found;
        trigger = found;
        if (found !== null) {
          contents = new MutationObserver(schedule);
          contents.observe(found, { childList: true, subtree: true, characterData: true });
        }
      }
      schedule();
    });
    tree.observe(document.body, { childList: true, subtree: true });
    const initial = agent ? null : document.querySelector<HTMLElement>(host.permissionSelectTrigger);
    if (initial !== null) {
      attached = initial;
      trigger = initial;
      contents = new MutationObserver(schedule);
      contents.observe(initial, { childList: true, subtree: true, characterData: true });
    }
    sync();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onClick, true);
    unsubscribe = plan?.subscribe(schedule);
  } catch (error) {
    unsubscribe?.();
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onClick, true);
    tree?.disconnect();
    contents?.disconnect();
    restore();
    report(error);
    return () => {};
  }

  return () => {
    disposed = true;
    scheduled = 0;
    unsubscribe?.();
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    tree?.disconnect();
    contents?.disconnect();
    restore();
  };
}
