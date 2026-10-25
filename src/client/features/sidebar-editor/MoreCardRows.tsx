import { useSyncExternalStore } from 'react';
import type { ReactElement } from 'react';
import type { MenuRowClasses } from '../../compat/host-dom.ts';
import type { SidebarPanelsPort } from '../../compat/sidebar-panels.ts';
import { editorCopy } from './copy.ts';
import type { EditorState, HiddenPanelStore } from './state.ts';

/*
 * Rows this plugin adds to the panel list's More card. They are the `Menu`
 * primitive's own markup — an item wrap holding a `button[role="menuitem"]`
 * and its label, a separator leading the wrap where a group starts — so the
 * card's keyboard walk (every enabled button in the list) and every popup rule
 * in `menus.css` reach them as host rows. The card mounts per opening, so each
 * row reads its state as it opens.
 */

interface HiddenProps {
  readonly hidden: HiddenPanelStore;
  readonly port: SidebarPanelsPort;
  readonly classes: MenuRowClasses;
  /** `PanelMoreMenu`'s own dismissal, passed to every `sidebar.panellist.actions` row. */
  readonly onDismiss?: (() => void) | undefined;
}

/**
 * The panels the Edit sidebar dialog took out of the column, at the head of
 * the card, so each stays one click away; a separator closes the group.
 */
export function HiddenPanelRows({ hidden, port, classes, onDismiss }: HiddenProps): ReactElement | null {
  const ids = useSyncExternalStore(hidden.subscribe, hidden.ids, hidden.ids);
  const panels = port.panels().filter(panel => ids.has(panel.id));
  if (panels.length === 0) return null;
  const active = port.active();
  return (
    <>
      {panels.map(panel => (
        <div key={panel.id} className={classes.itemWrap}>
          <button
            type="button"
            role="menuitem"
            className={classes.item}
            aria-current={panel.id === active ? 'page' : undefined}
            onClick={() => {
              onDismiss?.();
              port.select(panel.id);
            }}
          >
            <span className={classes.itemLabel}>{panel.label}</span>
          </button>
        </div>
      ))}
      <div className={classes.itemWrap} role="none">
        <div className={classes.separator} role="separator" />
      </div>
    </>
  );
}

interface EditProps {
  readonly state: EditorState;
  readonly classes: MenuRowClasses;
  readonly onDismiss?: (() => void) | undefined;
}

/** 编辑侧边栏…, after the host's Browse and Create rows: closes the card, opens the dialog. */
export function EditSidebarRow({ state, classes, onDismiss }: EditProps): ReactElement {
  const label = editorCopy(document.documentElement.lang || globalThis.navigator?.language || '').edit;
  return (
    <div className={classes.itemWrap}>
      <div className={classes.separator} role="separator" />
      <button
        type="button"
        role="menuitem"
        className={classes.item}
        onClick={() => {
          onDismiss?.();
          state.open();
        }}
      >
        <span className={classes.itemLabel}>{label}</span>
      </button>
    </div>
  );
}
