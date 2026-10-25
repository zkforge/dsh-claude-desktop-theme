import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from 'react';
import type { PaletteScheduleRuns, SearchPaletteOpener, SearchPalettePort } from '../../contracts/ports.ts';
import {
  entryActions, isFilterQuery, paletteCopy, paletteSections, paletteTabs, relativeTime, scheduleLabel, scheduleMeta,
} from './model.ts';
import type { MatchRange, PaletteAction, PaletteCopy, PaletteEntry, PaletteTab } from './model.ts';

/** The palette's open state, shared with the sidebar row that opens it. */
export interface PaletteState extends SearchPaletteOpener {
  close(): void;
}

interface Props {
  readonly state: PaletteState;
  readonly port: SearchPalettePort;
  readonly report: (error: unknown) => void;
}

/** Wait before asking the host's content index, so typing does not flood it. */
const CONTENT_DELAY_MS = 180;
/** Rough `…` menu row pitch, for flipping the menu above a low row. */
const MENU_ROW = 30;

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const Glyph = ({ children, size = 16 }: { readonly children: ReactNode; readonly size?: number }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">{children}</svg>
);
const CodeIcon = () => <Glyph><path {...stroke} d="M5.25 4.75 2 8l3.25 3.25M10.75 4.75 14 8l-3.25 3.25M9.1 3.25 6.9 12.75" /></Glyph>;
const ClockIcon = () => <Glyph><circle {...stroke} cx="8" cy="8" r="6" /><path {...stroke} d="M8 4.9V8l2.1 1.3" /></Glyph>;
const FolderIcon = () => <Glyph><path {...stroke} d="M1.9 4.4c0-.6.5-1.1 1.1-1.1h3l1.4 1.5H13c.6 0 1.1.5 1.1 1.1v6.2c0 .6-.5 1.1-1.1 1.1H3c-.6 0-1.1-.5-1.1-1.1z" /></Glyph>;
const ChatPlusIcon = () => <Glyph><path {...stroke} d="M8.4 13.6H3.1l1-1.6A5.6 5.6 0 1 1 13.6 8" /><path {...stroke} d="M12.4 10.4v4M10.4 12.4h4" /></Glyph>;
const SearchIcon = () => <Glyph><circle {...stroke} cx="7" cy="7" r="4.6" /><path {...stroke} d="m10.4 10.4 3.6 3.6" /></Glyph>;
const CloseIcon = () => <Glyph><path {...stroke} strokeWidth={1.3} d="m3.5 3.5 9 9M12.5 3.5l-9 9" /></Glyph>;
const MoreIcon = () => <Glyph><circle cx="4.5" cy="8" r="1" fill="currentColor" /><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="11.5" cy="8" r="1" fill="currentColor" /></Glyph>;
const EnterIcon = () => <Glyph><path {...stroke} d="M12.5 4.25v3.5c0 .83-.67 1.5-1.5 1.5H4M6.25 7 4 9.25l2.25 2.25" /></Glyph>;

const TAB_ICONS: Readonly<Record<PaletteTab, () => ReactElement>> = {
  all: SearchIcon, session: CodeIcon, project: FolderIcon, schedule: ClockIcon,
};

function Highlight({ text, match }: { readonly text: string; readonly match: MatchRange }): ReactElement {
  if (match === null) return <>{text}</>;
  return <>{text.slice(0, match[0])}<mark>{text.slice(match[0], match[1])}</mark>{text.slice(match[1])}</>;
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const preventFocus = (event: ReactMouseEvent) => { event.preventDefault(); };

/**
 * The search palette: a modal card opened from the sidebar's Search row or ⌘K.
 *
 * It is drawn after the reference — a borderless field with a close button, a
 * row of type tabs, sectioned results with the current row's `…` and ↵, and a
 * footer of key hints — over lists read from the host's own catalogs. The
 * card is a native modal `<dialog>`, so focus, the top layer and Esc are the
 * browser's; the body is mounted per opening, so each opening starts from 全部
 * with an empty field.
 */
export function SearchPalette({ state, port, report }: Props): ReactElement {
  const open = useSyncExternalStore(state.subscribe, state.isOpen, state.isOpen);
  const dialog = useRef<HTMLDialogElement>(null);
  const pressed = useRef(false);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (node === null) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);
  const language = document.documentElement.lang || globalThis.navigator?.language || '';
  const copy = paletteCopy(language);
  return (
    <dialog
      ref={dialog}
      className="ccd-search-palette"
      aria-label={copy.placeholder}
      onCancel={event => { event.preventDefault(); state.close(); }}
      onClose={() => state.close()}
      /* Only a press and release on the backdrop itself dismisses; a text
         selection dragged out of the card does not. */
      onPointerDown={event => { pressed.current = event.target === event.currentTarget; }}
      onClick={event => {
        if (pressed.current && event.target === event.currentTarget) state.close();
        pressed.current = false;
      }}
    >
      {open ? <PaletteBody port={port} copy={copy} language={language} close={state.close} report={report} /> : null}
    </dialog>
  );
}

interface BodyProps {
  readonly port: SearchPalettePort;
  readonly copy: PaletteCopy;
  readonly language: string;
  readonly close: () => void;
  readonly report: (error: unknown) => void;
}

interface MenuState {
  readonly key: string;
  readonly index: number;
  readonly top: number;
  readonly right: number;
}

function PaletteBody({ port, copy, language, close, report }: BodyProps): ReactElement {
  const snapshot = useSyncExternalStore(port.subscribe, port.getSnapshot, port.getSnapshot);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<PaletteTab>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [content, setContent] = useState<{ readonly query: string; readonly hits: ReadonlyMap<string, string> } | null>(null);
  const [runs, setRuns] = useState<ReadonlyMap<string, PaletteScheduleRuns>>(() => new Map());
  const [notice, setNotice] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const requested = useRef(new Set<string>());
  const keyboard = useRef(false);
  const id = useId();
  const mac = document.documentElement.dataset.platform === 'darwin'
    || /mac/iu.test(globalThis.navigator?.platform ?? '');

  useEffect(() => {
    port.refreshSchedules();
    field.current?.focus();
  }, [port]);

  const trimmed = query.trim();
  const searching = trimmed !== '' && !isFilterQuery(query);
  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      port.searchContent(trimmed, controller.signal).then(items => {
        if (!controller.signal.aborted) setContent({ query: trimmed, hits: new Map(items.map(item => [item.sessionId, item.snippet])) });
      }, error => { if (!controller.signal.aborted) report(error); });
    }, CONTENT_DELAY_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [port, trimmed, searching, report]);

  const tabs = paletteTabs(snapshot);
  const activeTab = tabs.includes(tab) ? tab : 'all';
  const sections = useMemo(() => paletteSections(snapshot, {
    query, tab: activeTab, content: content?.query === trimmed ? content.hits : undefined,
  }, copy), [snapshot, query, activeTab, content, trimmed, copy]);
  const entries = useMemo(() => sections.flatMap(section => section.entries), [sections]);
  const current = entries.find(entry => entry.key === selected) ?? entries[0] ?? null;
  const menuOwner = menu === null ? null : entries.find(entry => entry.key === menu.key) ?? null;
  const menuActions = menuOwner === null ? [] : entryActions(menuOwner, copy);

  /* Run counts are one history read per active task, asked once per opening
     and only for the tasks on screen. */
  useEffect(() => {
    for (const entry of entries) {
      if (entry.kind !== 'schedule' || !entry.schedule.active || requested.current.has(entry.schedule.id)) continue;
      const task = entry.schedule.id;
      requested.current.add(task);
      port.scheduleRuns(task).then(value => setRuns(previous => new Map(previous).set(task, value)), report);
    }
  }, [entries, port, report]);

  useLayoutEffect(() => {
    if (!keyboard.current || current === null) return;
    keyboard.current = false;
    list.current?.querySelector(`[data-key="${CSS.escape(current.key)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const reset = () => { setSelected(null); setMenu(null); };
  const chooseTab = (next: PaletteTab) => { setTab(next); reset(); };
  const move = (delta: number) => {
    if (entries.length === 0) return;
    const index = current === null ? -1 : entries.indexOf(current);
    keyboard.current = true;
    setSelected(entries[(index + delta + entries.length) % entries.length]!.key);
  };
  const switchTab = (delta: number) => {
    const index = tabs.indexOf(activeTab);
    chooseTab(tabs[(index + delta + tabs.length) % tabs.length]!);
  };

  /** Run one host action; navigation closes the card, list edits keep it. */
  const run = (task: () => void | Promise<void>, keepOpen = false) => {
    setMenu(null);
    try {
      const result = task();
      if (!keepOpen) close();
      Promise.resolve(result).catch(error => { report(error); setNotice(copy.failed(message(error))); });
    } catch (error) {
      report(error);
      setNotice(copy.failed(message(error)));
    }
  };

  const perform = (entry: PaletteEntry, action: PaletteAction['id'] | 'default') => {
    switch (entry.kind) {
      case 'session': {
        const session = entry.session.id;
        if (action === 'pin' || action === 'unpin') run(() => port.setPinned(session, action === 'pin'), true);
        else if (action === 'archive' || action === 'unarchive') run(() => port.setArchived(session, action === 'archive'), true);
        else if (action === 'fork') run(() => port.fork(session));
        else run(() => port.openSession(session));
        return;
      }
      case 'project':
        if (action === 'copy-path') run(() => port.copy(entry.project.path));
        else run(() => port.startSession({ workspaceId: entry.project.id }));
        return;
      case 'schedule':
        if (action === 'open-session') run(() => port.openSession(entry.schedule.sessionId));
        else run(() => port.openSchedule(entry.schedule.id));
        return;
      case 'action':
        run(() => port.startSession(entry.prompt === '' ? {} : { prompt: entry.prompt }));
        return;
      case 'filter':
        setQuery('');
        chooseTab(entry.tab);
        field.current?.focus();
        return;
    }
  };

  const openMenu = (entry: PaletteEntry) => {
    const actions = entryActions(entry, copy);
    if (actions.length === 0) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(entry.key)}"]`);
    const anchor = row?.querySelector<HTMLElement>('.ccd-search-palette-more') ?? row;
    const box = surface.current?.getBoundingClientRect();
    const at = anchor?.getBoundingClientRect();
    if (!box || !at) return;
    const height = actions.length * MENU_ROW + 10;
    const below = at.bottom - box.top + 4;
    setSelected(entry.key);
    setMenu({
      key: entry.key, index: 0, right: Math.max(8, box.right - at.right),
      top: below + height > box.height - 8 ? Math.max(8, at.top - box.top - 4 - height) : below,
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const primary = event.metaKey || event.ctrlKey;
    if (primary && event.key.toLowerCase() === 'k') { event.preventDefault(); close(); return; }
    if (menu !== null) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (menuActions.length > 0) {
          const step = event.key === 'ArrowDown' ? 1 : -1;
          setMenu({ ...menu, index: (menu.index + step + menuActions.length) % menuActions.length });
        }
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const action = menuActions[menu.index];
        if (menuOwner !== null && action !== undefined) perform(menuOwner, action.id);
        return;
      }
      if (event.key === 'Escape' || event.key === 'ArrowLeft' || event.key === 'Tab') {
        /* Prevented here, Esc never reaches the dialog's own cancel. */
        event.preventDefault();
        setMenu(null);
        return;
      }
      setMenu(null);
    }
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault();
        move(event.key === 'ArrowDown' ? 1 : -1);
        return;
      case 'Enter':
        event.preventDefault();
        if (current === null) return;
        if (event.altKey) openMenu(current);
        else perform(current, 'default');
        return;
      case 'Tab':
        event.preventDefault();
        if (!event.shiftKey && !isFilterQuery(query)) run(() => port.startSession(trimmed === '' ? {} : { prompt: trimmed }));
        return;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const input = field.current;
        if (event.shiftKey || event.altKey || primary) return;
        if (input !== null && event.target === input) {
          /* The caret keeps the arrows until it reaches that end of the text. */
          const edge = event.key === 'ArrowLeft'
            ? input.selectionStart === 0 && input.selectionEnd === 0
            : input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
          if (!edge) return;
        }
        event.preventDefault();
        switchTab(event.key === 'ArrowLeft' ? -1 : 1);
        return;
      }
      case 'Backspace':
        if (event.target === field.current && query === '' && activeTab !== 'all') {
          event.preventDefault();
          chooseTab('all');
        }
        return;
    }
  };

  const rows: ReactNode[] = [];
  let index = 0;
  for (const section of sections) {
    rows.push(<div key={`heading:${section.id}`} className="ccd-search-palette-heading" role="presentation">{section.title}</div>);
    for (const entry of section.entries) {
      const active = entry === current;
      rows.push(
        <PaletteRow
          key={`${section.id}:${entry.key}`}
          id={`${id}-option-${index++}`}
          entry={entry}
          recent={section.id === 'recent'}
          active={active}
          menuOpen={menu?.key === entry.key}
          copy={copy}
          language={language}
          runs={entry.kind === 'schedule' ? runs.get(entry.schedule.id) : undefined}
          onHover={() => { if (selected !== entry.key) setSelected(entry.key); }}
          onActivate={() => perform(entry, 'default')}
          onMore={() => { if (menu?.key === entry.key) setMenu(null); else openMenu(entry); }}
        />,
      );
    }
  }
  const activeId = current === null ? undefined : `${id}-option-${entries.indexOf(current)}`;
  const option = mac ? '⌥' : 'Alt';

  return (
    <div ref={surface} className="ccd-search-palette-surface" onKeyDown={onKeyDown}>
      <div className="ccd-search-palette-field">
        <input
          ref={field}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-label={copy.placeholder}
          placeholder={copy.placeholder}
          spellCheck={false}
          autoComplete="off"
          value={query}
          onChange={event => { setQuery(event.target.value); reset(); }}
        />
        <button type="button" className="ccd-search-palette-close" aria-label={copy.close} tabIndex={-1} onMouseDown={preventFocus} onClick={close}>
          <CloseIcon />
        </button>
      </div>
      <div className="ccd-search-palette-tabs" role="tablist" aria-label={copy.hints.tabs}>
        {tabs.map(candidate => (
          <button
            key={candidate}
            type="button"
            role="tab"
            tabIndex={-1}
            aria-selected={candidate === activeTab}
            onMouseDown={preventFocus}
            onClick={() => chooseTab(candidate)}
          >{copy.tabs[candidate]}</button>
        ))}
      </div>
      <div ref={list} id={`${id}-list`} className="ccd-search-palette-list" role="listbox" aria-label={copy.placeholder} onScroll={() => { if (menu !== null) setMenu(null); }}>
        {entries.length === 0 ? <p className="ccd-search-palette-empty">{copy.empty}</p> : rows}
      </div>
      {menu !== null && menuOwner !== null ? (
        <div className="ccd-search-palette-menu" role="menu" aria-label={copy.more} style={{ top: menu.top, right: menu.right }}>
          {menuActions.map((action, position) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-active={position === menu.index ? '' : undefined}
              onMouseDown={preventFocus}
              onPointerEnter={() => setMenu({ ...menu, index: position })}
              onClick={() => perform(menuOwner, action.id)}
            >
              <span>{action.label}</span>
              {action.primary ? <kbd aria-hidden="true">↵</kbd> : null}
            </button>
          ))}
        </div>
      ) : null}
      {notice !== null ? <p className="ccd-search-palette-notice" role="status">{notice}</p> : null}
      <footer className="ccd-search-palette-footer" aria-hidden="true">
        <span>{copy.hints.close}<kbd>Esc</kbd></span>
        <span>{copy.hints.tabs}<kbd>←</kbd><kbd>→</kbd></span>
        <span>{copy.hints.filter}<kbd>/</kbd></span>
        <span>{copy.hints.actions}<kbd>{option}</kbd><kbd>↵</kbd></span>
        <span className="ccd-search-palette-compose">{copy.hints.compose}<kbd>Tab</kbd></span>
      </footer>
    </div>
  );
}

interface RowProps {
  readonly id: string;
  readonly entry: PaletteEntry;
  readonly recent: boolean;
  readonly active: boolean;
  readonly menuOpen: boolean;
  readonly copy: PaletteCopy;
  readonly language: string;
  readonly runs: PaletteScheduleRuns | undefined;
  readonly onHover: () => void;
  readonly onActivate: () => void;
  readonly onMore: () => void;
}

function PaletteRow({ id, entry, recent, active, menuOpen, copy, language, runs, onHover, onActivate, onMore }: RowProps): ReactElement {
  let icon: ReactElement;
  let label: ReactNode;
  let secondary: string | null = null;
  let meta = '';
  let title: string | undefined;
  switch (entry.kind) {
    case 'session': {
      const { session } = entry;
      icon = <CodeIcon />;
      label = <Highlight text={session.title} match={entry.match} />;
      secondary = entry.snippet ?? (recent ? null : session.workspace);
      if (session.archived) meta = copy.archived;
      else if (!recent) meta = session.running ? copy.running : relativeTime(session.updatedAt, language);
      break;
    }
    case 'project':
      icon = <FolderIcon />;
      label = <Highlight text={entry.project.title} match={entry.match} />;
      secondary = entry.project.path;
      meta = copy.sessionCount(entry.project.sessions);
      title = entry.project.path;
      break;
    case 'schedule':
      icon = <ClockIcon />;
      label = <Highlight text={scheduleLabel(entry.schedule, copy)} match={entry.match} />;
      meta = scheduleMeta(entry.schedule, runs, copy);
      title = entry.schedule.prompt;
      break;
    case 'action':
      icon = <ChatPlusIcon />;
      label = copy.newSession;
      secondary = entry.prompt === '' ? null : `“${entry.prompt}”`;
      break;
    case 'filter': {
      const Icon = TAB_ICONS[entry.tab];
      icon = <Icon />;
      label = copy.tabs[entry.tab];
      break;
    }
  }
  const actions = active && entryActions(entry, copy).length > 0;
  return (
    <div
      id={id}
      className="ccd-search-palette-row"
      role="option"
      aria-selected={active}
      data-key={entry.key}
      data-kind={entry.kind}
      data-archived={entry.kind === 'session' && entry.session.archived ? '' : undefined}
      title={title}
      onMouseDown={preventFocus}
      onPointerMove={onHover}
      onClick={onActivate}
    >
      <span className="ccd-search-palette-icon">{icon}</span>
      <span className="ccd-search-palette-label">{label}</span>
      {secondary === null ? null : <span className="ccd-search-palette-secondary">{secondary}</span>}
      <span className="ccd-search-palette-trail">
        {meta === '' ? null : <span className="ccd-search-palette-meta">{meta}</span>}
        {actions ? (
          <button
            type="button"
            className="ccd-search-palette-more"
            aria-label={copy.more}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            tabIndex={-1}
            onMouseDown={preventFocus}
            onClick={event => { event.stopPropagation(); onMore(); }}
          ><MoreIcon /></button>
        ) : null}
        {active ? <span className="ccd-search-palette-enter" aria-hidden="true"><EnterIcon /></span> : null}
      </span>
    </div>
  );
}
