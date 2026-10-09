/**
 * Mount the context panel's projection unit.
 *
 * The unit is the only thing the host half adds: the browser half reads the
 * host's own `contextPressure` / `contextBreakdown` straight off the session
 * list, so there is no route, no polling and no second state store — one
 * registration on the session-projection seam, riding this plugin's fiber like
 * `stats/unit.ts` does.
 *
 * A plugin's `apply` runs as soon as its own fiber starts, which can be before
 * the projection registry exists: the optional injection below waits for it,
 * and a deployment that mounts no registry simply never gets the panel's
 * per-tool rows — the card falls back to the host's three numbers alone.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection';
import { PLUGIN_ID } from '../../shared/identity.ts';
import { readCompactionPolicy } from './compaction.ts';
import { createContextProjection } from './unit.ts';

/**
 * Register the `ccdContext` unit, once the projection registry exists.
 *
 * @param ctx - host plugin context.
 * @param isEnabled - current plugin switch, read at mount time.
 */
export function mountContextBreakdown(ctx: Context, isEnabled: () => boolean): void {
  ctx.inject(['sessionProjections'], injected => {
    if (!isEnabled()) return;
    const projections = injected.get('sessionProjections') as SessionProjectionRegistry | undefined;
    if (projections === undefined) return;
    try {
      /* The policy is read on every view rather than captured here: a settings
         write that turns compaction on lands in the loader's entry tree
         without remounting this plugin. */
      projections.register(createContextProjection(() => readCompactionPolicy(injected)));
    } catch (error) {
      try {
        console.warn(`[${PLUGIN_ID}] context: the projection unit could not be registered`, error);
      } catch {
        /* logging must never throw */
      }
    }
  });
}
