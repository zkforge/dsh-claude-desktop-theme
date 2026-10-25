import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import type { SidebarPanel, SidebarPanelsPort } from '../../compat/sidebar-panels.ts';
import { editorCopy } from './copy.ts';
import type { EditorCopy } from './copy.ts';
import type { EditorState, HiddenPanelStore } from './state.ts';

interface Props {
  readonly state: EditorState;
  readonly hidden: HiddenPanelStore;
  readonly port: SidebarPanelsPort;
  /** A copy of the glyph a panel's sidebar row draws. */
  readonly glyph: (id: string) => Element | null;
}

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="M3.6 8.3 6.6 11.2 12.4 4.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Edit sidebar: the dialog the More card's 编辑侧边栏… row opens, after the
 * reference.
 *
 * A native modal `<dialog>` whose body mounts per opening: each checkbox writes
 * straight through to the hidden set, so the column follows every click and
 * 完成 only closes.
 */
export function SidebarEditor({ state, hidden, port, glyph }: Props): ReactElement {
  const open = useSyncExternalStore(state.subscribe, state.isOpen, state.isOpen);
  const copy = editorCopy(document.documentElement.lang || globalThis.navigator?.language || '');
  return <EditDialog open={open} copy={copy} hidden={hidden} port={port} glyph={glyph} onClose={state.close} />;
}

interface DialogProps {
  readonly open: boolean;
  readonly copy: EditorCopy;
  readonly hidden: HiddenPanelStore;
  readonly port: SidebarPanelsPort;
  readonly glyph: (id: string) => Element | null;
  readonly onClose: () => void;
}

function EditDialog({ open, copy, hidden, port, glyph, onClose }: DialogProps): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressed = useRef(false);
  const title = useId();
  const description = useId();
  useLayoutEffect(() => {
    const node = dialog.current;
    if (node === null) return;
    if (open && !node.open) {
      node.showModal();
      node.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus({ preventScroll: true });
    }
    if (!open && node.open) node.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="ccd-sidebar-editor"
      aria-labelledby={title}
      aria-describedby={description}
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClose={onClose}
      /* Only a press and release on the backdrop itself dismisses. */
      onPointerDown={event => { pressed.current = event.target === event.currentTarget; }}
      onClick={event => {
        if (pressed.current && event.target === event.currentTarget) onClose();
        pressed.current = false;
      }}
    >
      {open ? (
        <div className="ccd-sidebar-editor-surface">
          <div className="ccd-sidebar-editor-head">
            <h2 id={title}>{copy.title}</h2>
            <button type="button" className="ccd-sidebar-editor-close" aria-label={copy.close} onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
          <p id={description} className="ccd-sidebar-editor-description">{copy.description}</p>
          <PanelList hidden={hidden} port={port} glyph={glyph} />
          <div className="ccd-sidebar-editor-actions">
            <button type="button" className="ccd-sidebar-editor-done" onClick={onClose}>{copy.done}</button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}

interface ListProps {
  readonly hidden: HiddenPanelStore;
  readonly port: SidebarPanelsPort;
  readonly glyph: (id: string) => Element | null;
}

function PanelList({ hidden, port, glyph }: ListProps): ReactElement {
  const ids = useSyncExternalStore(hidden.subscribe, hidden.ids, hidden.ids);
  const [panels, setPanels] = useState<readonly SidebarPanel[]>(() => port.panels());
  useEffect(() => port.subscribe(() => {
    setPanels(current => {
      const next = port.panels();
      const same = next.length === current.length
        && next.every((panel, index) => panel.id === current[index]!.id && panel.label === current[index]!.label);
      return same ? current : next;
    });
  }), [port]);
  return (
    <ul className="ccd-sidebar-editor-list">
      {panels.map(panel => (
        <li key={panel.id}>
          <label className="ccd-sidebar-editor-row">
            <input
              type="checkbox"
              checked={!ids.has(panel.id)}
              onChange={event => hidden.set(panel.id, !event.currentTarget.checked)}
            />
            <span className="ccd-sidebar-editor-box" aria-hidden="true"><CheckIcon /></span>
            <PanelGlyph id={panel.id} glyph={glyph} />
            <span className="ccd-sidebar-editor-label">{panel.label}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/** The row's own artwork, copied once per opening; React never owns its nodes. */
function PanelGlyph({ id, glyph }: { readonly id: string; readonly glyph: (id: string) => Element | null }): ReactElement {
  const seat = useRef<HTMLSpanElement>(null);
  const art = useMemo(() => glyph(id), [glyph, id]);
  useLayoutEffect(() => {
    seat.current?.replaceChildren(...(art === null ? [] : [art]));
  }, [art]);
  return <span ref={seat} className="ccd-sidebar-editor-glyph" aria-hidden="true" />;
}
