import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type { FeatureEnvironment } from '../../contracts/feature.ts';
import type { SearchPaletteOpener } from '../../contracts/ports.ts';
import type { CleanupScope } from '../../core/cleanup.ts';
import { DSH_SLOTS } from '../../compat/slots.ts';
import { searchPalettePort } from '../../compat/search-palette-port.ts';
import { SearchPalette, type PaletteState } from './SearchPalette.tsx';
import css from './search-palette.css';

/** List order inside the frame-wide overlay; the context panel is at 40. */
const SEARCH_PALETTE_ORDER = 50;

function createPaletteState(): PaletteState {
  let open = false;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    if (open === next) return;
    open = next;
    for (const listener of listeners) listener();
  };
  return {
    open: () => set(true),
    close: () => set(false),
    isOpen: () => open,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/**
 * Put the search palette in the frame-wide overlay and return its opener.
 *
 * The palette is this plugin's own surface: a React entry in `shell.overlay`
 * whose modal card lists the host's Sessions, Workspaces and scheduled tasks
 * (`compat/search-palette-port.ts`). The sidebar's Search row and the host's
 * ⌘K both reach it through the returned opener (`compat/sidebar-search.ts`).
 *
 * @param ctx - client root context carrying the slot service and host catalogs.
 * @param environment - configuration, ports and logging for this activation.
 * @param cleanup - scope owning the styles, the open state and the registration.
 */
export function mountSearchPalette(
  ctx: Context,
  environment: FeatureEnvironment,
  cleanup: CleanupScope,
): SearchPaletteOpener {
  cleanup.add(environment.dom.mountStyles(css));
  const report = (error: unknown) => environment.logger.error('search palette: operation failed', error);
  const port = searchPalettePort(ctx, document, report);
  const state = createPaletteState();
  const registration = ctx.inject(['slots'], scope => scope.slots.inject(
    DSH_SLOTS.shellOverlay,
    () => scope.slots.register({
      name: DSH_SLOTS.shellOverlay, id: 'ccd-search-palette', order: SEARCH_PALETTE_ORDER,
      inject: () => ({ state, port, report }),
    }, SearchPalette),
  ));
  cleanup.add(() => {
    state.close();
    void registration.dispose();
  });
  return state;
}
