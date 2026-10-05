import type { Disposer } from '../contracts/ports.ts';
import { hostSelectors } from './host-dom.ts';

/** Names the preset a tagged row switches to; `theme/menus.css` keys the two-line cell off it. */
export const PERMISSION_MODE_ATTRIBUTE = 'data-ccd-permission-mode';

/** Tags the card those rows sit in, so the stylesheet can reach the card itself. */
export const PERMISSION_MENU_ATTRIBUTE = 'data-ccd-permission-menu';

/** The row's second line: this plugin's sentence, on a node the host never renders. */
const DESCRIPTION_ATTRIBUTE = 'data-ccd-permission-desc';

/** The line above the rows, written into the card's row group. */
const HEADING_ATTRIBUTE = 'data-ccd-permission-heading';

/** One preset as the card draws it. */
export interface PermissionPresetCopy {
  /** DSH's machine value for the preset (`read-only`, `auto`, …): the row's identity, never shown. */
  readonly value: string;
  /** The name DSH renders, which is what a row is recognised by. */
  readonly name: string;
  /** The name to draw — the same wording wherever the host's is already the one to use. */
  readonly label: string;
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

/**
 * The card in Simplified Chinese.
 *
 * Three of the four names are DSH's own dictionary's, and they are kept
 * deliberately: the same mode is named on the chip, in the settings page and in
 * the `title` the trigger carries, and a card that renamed one of them would be
 * the odd surface out. `Auto review` is the exception — DSH's Chinese
 * dictionary is the one place it leaves a name in English — and it is restated
 * here together with its badge, so the card reads as one language.
 *
 * The descriptions are this plugin's own, and they say what the mode does in
 * DSH's terms rather than what it is called: the file sandbox's three modes
 * (`read-only` refuses file changes, `workspace-write` allows them under the
 * session workspace, `danger-full-access` drops the restriction) and the
 * experimental per-call review that runs over the last of them.
 */
const ZH: PermissionCopy = {
  heading: '模式',
  presets: [
    { value: 'read-only', name: '仅可查看', label: '仅可查看', description: '文件只读，需要改动时会先征求你的同意' },
    { value: 'workspace-write', name: '工作区内修改', label: '工作区内修改', description: '工作区内的文件可直接改，工作区之外要先问你' },
    { value: 'danger-full-access', name: '完全权限', label: '完全权限', description: '不再限制文件改动，确认步骤更少' },
    {
      value: 'auto', name: 'Auto review', label: '自动审查',
      badge: { host: 'EXP', text: '实验' },
      description: '无沙箱运行，每次工具调用前由模型先审一遍',
    },
  ],
};

/**
 * The card in English — DSH's own four names, which are the ones the rows are
 * recognised by, so `label` restates them and the badge keeps the host's
 * abbreviation.
 */
const EN: PermissionCopy = {
  heading: 'Mode',
  presets: [
    { value: 'read-only', name: 'Read Only', label: 'Read Only', description: 'Files stay read-only; changes ask for your approval' },
    { value: 'workspace-write', name: 'Workspace Write', label: 'Workspace Write', description: 'Edits inside the workspace go through; anything beyond it asks' },
    { value: 'danger-full-access', name: 'Full access', label: 'Full access', description: 'No file restrictions, and fewer confirmations' },
    {
      value: 'auto', name: 'Auto review', label: 'Auto review',
      badge: { host: 'EXP', text: 'EXP' },
      description: 'No sandbox; the model reviews every tool call first',
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

/** One text node this module rewrote, and both ends of the rewrite. */
interface Drawn {
  readonly node: Text;
  readonly original: string;
  readonly drawn: string;
}

/**
 * The permission picker's card, drawn the way the reference draws it.
 *
 * DSH's card is four flat rows of a preset's name — `仅可查看` / `工作区内修改`
 * / `完全权限` / `Auto review` — one 20px line each, and the only thing that
 * tells them apart is the name itself. The reference draws the same four
 * choices as two-line cells: the mode's name over a sentence saying what the
 * mode does, with the one flagged preset carrying a badge beside its name. The
 * names are the host's and stay the host's; what this module adds is the second
 * line, and its home is a node the host never renders — `optionDescription`
 * exists in the permission catalog, but the picker passes it to the trigger's
 * `title` and prints nothing in the row.
 *
 * So this is the one compat module that *writes* copy rather than rewriting
 * what the host rendered, and the copy is this plugin's own: see
 * `permissionCopy` above. It is kept in one table per document language, so a
 * wording change is one edit in one place.
 *
 * Three facts decide how the rows are reached, and each is worth stating:
 *
 * - **A row is recognised by its name.** `Menu` rows carry no identity of their
 *   own — no id, no data attribute, and the preset's own glyph is a thing this
 *   plugin removes (`theme/menus.css` hides the icon seat) — so the name the
 *   host localised is the only handle there is. That is the same fact
 *   `compat/workspace-menu.ts` reads for its own row, and it fails safe: a
 *   deployment that configured its own preset names matches nothing, and its
 *   card keeps the host's single-line rows exactly as they are.
 * - **The card is recognised by its rows.** The picker's trigger carries no
 *   `aria-expanded` (unlike the account trigger and the hero chips), so the
 *   portalled card cannot be tied back to the control that opened it; the card
 *   a recognised row sits in is therefore the card this module tags. A card
 *   none of whose rows is recognised is left whole — its heading with it, since
 *   a heading over four unrecognised rows names nothing.
 * - **Nothing here reorders a row.** The second line is inserted as the label's
 *   next sibling and the heading as the row group's first child, so the
 *   primitive's own keyboard walk — which collects `button`s out of the group,
 *   not its children — steps over both, and every click target, focus order and
 *   accessible name the host built is left where it was. The row keeps its own
 *   name too: the inserted line widens what a screen reader reads out of the
 *   row, which is the point of the sentence.
 *
 * The host mounts the card afresh on every open, so every pass is idempotent
 * and every write is undone on release: a disabled plugin leaves DSH's own card
 * on screen.
 *
 * @param document - renderer document carrying the status bar and the portal.
 * @param report - sink for observer failures; the native card stays untouched.
 * @returns disposer that disconnects the observers and takes every write back.
 */
export function mountPermissionMenu(document: Document, report: (error: unknown) => void): Disposer {
  const host = hostSelectors(document);
  const copy = permissionCopy(document);
  const drawn: Drawn[] = [];
  const added: HTMLElement[] = [];
  const marked: HTMLElement[] = [];
  let trigger: HTMLElement | null = null;
  let attached: HTMLElement | null = null;
  let scheduled = 0;

  /** Drop the records of a card the host has already unmounted. */
  const prune = () => {
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
    for (const node of added) node.remove();
    added.length = 0;
    for (const node of marked) {
      node.removeAttribute(PERMISSION_MODE_ATTRIBUTE);
      node.removeAttribute(PERMISSION_MENU_ATTRIBUTE);
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
    (label.querySelector(host.permissionSelectOptionLabelText)?.textContent ?? label.textContent ?? '').trim();

  /** The preset a control is showing, by the name it draws. */
  const presetOf = (label: Element): PermissionPresetCopy | undefined => {
    const name = nameOf(label);
    return copy.presets.find(preset => preset.name === name || preset.label === name);
  };

  /** Write one control's own words: its name, and the badge beside it. */
  const drawName = (label: Element, badge: Element | null, preset: PermissionPresetCopy) => {
    replace(label, preset.name, preset.label);
    if (badge !== null && preset.badge !== undefined) {
      replace(badge, preset.badge.host, preset.badge.text);
    }
  };

  /** Tag the card these rows sit in and name the group above them. */
  const drawCard = (row: HTMLElement) => {
    const card = row.closest<HTMLElement>(host.menu);
    if (card === null) return;
    card.setAttribute(PERMISSION_MENU_ATTRIBUTE, '');
    if (!marked.includes(card)) marked.push(card);
    const viewport = card.querySelector<HTMLElement>(host.menuViewport);
    if (viewport === null) return;
    if (viewport.querySelector(`:scope > [${HEADING_ATTRIBUTE}]`) !== null) return;
    /* A `role="presentation"` div is the host's own heading row — `Menu` renders
       a `{ type: 'label' }` entry exactly this way — and it stays out of the
       keyboard's walk, which collects buttons. */
    const heading = document.createElement('div');
    heading.setAttribute(HEADING_ATTRIBUTE, '');
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
    row.setAttribute(PERMISSION_MODE_ATTRIBUTE, preset.value);
    if (!marked.includes(row)) marked.push(row);
    if (row.querySelector(`:scope > [${DESCRIPTION_ATTRIBUTE}]`) === null) {
      const description = document.createElement('span');
      description.setAttribute(DESCRIPTION_ATTRIBUTE, '');
      description.textContent = preset.description;
      label.after(description);
      added.push(description);
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
    if (trigger !== null) drawTrigger(trigger);
    /* The rows exist only while the card is open, and `[role="menu"]` is absent
       from the tree at every other moment — so one query keeps the whole row
       scan off the streaming transcript's mutation traffic. */
    if (document.querySelector(host.menu) === null) return;
    for (const row of document.querySelectorAll<HTMLElement>(host.menuItem)) drawRow(row);
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

  let tree: MutationObserver | undefined;
  let contents: MutationObserver | undefined;
  try {
    /* The card is portalled into `body` and the chip is rebuilt with the
       Composer, so both arrive — and leave — as tree changes. The chip's name is
       the one write that is a text change rather than a mount, so the chip
       carries an observer of its own; it is re-attached whenever the host
       replaces the control. */
    tree = new MutationObserver(() => {
      const found = document.querySelector<HTMLElement>(host.permissionSelectTrigger);
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
    const initial = document.querySelector<HTMLElement>(host.permissionSelectTrigger);
    if (initial !== null) {
      attached = initial;
      trigger = initial;
      contents = new MutationObserver(schedule);
      contents.observe(initial, { childList: true, subtree: true, characterData: true });
    }
    sync();
  } catch (error) {
    tree?.disconnect();
    contents?.disconnect();
    restore();
    report(error);
    return () => {};
  }

  return () => {
    scheduled = 0;
    tree?.disconnect();
    contents?.disconnect();
    restore();
  };
}
