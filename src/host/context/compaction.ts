/**
 * The autocompaction policy this deployment actually runs.
 *
 * The panel's last row says how much of the window the compaction policy is
 * holding back, and that number belongs to another plugin's configuration. DSH
 * publishes no read face for it, so the loader's own entry tree is the source:
 * an entry that is enabled *and* declares the policy's own fields
 * (`thresholdRatio` / `headroomTokens`) is the backend that will compact this
 * session, and an enabled `compaction-basic` with an empty config is that
 * backend running on its defaults.
 *
 * A deployment with no such entry — which is this plugin's own machine, where
 * `compaction-basic` is `disabled: true` — yields null, and the panel leaves
 * the row out rather than drawing a threshold nobody enforces.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis';
import { DEFAULT_HEADROOM_TOKENS, DEFAULT_THRESHOLD_RATIO } from '../../shared/context.ts';
import type { CompactionPolicy } from './unit.ts';

/** The backend whose defaults the two fields fall back to. */
const DEFAULT_BACKEND = '@deepseek-ai/dsh-compaction-basic';

/** One loader entry, as far as this read touches it. */
interface LoaderEntry {
  readonly id: string;
  readonly disabled?: boolean;
  readonly options?: {
    readonly name?: string;
    readonly config?: unknown;
  };
}

/** The loader's entry tree, structurally. */
interface LoaderPort {
  entries(): Iterable<LoaderEntry>;
}

/** Read one positive finite ratio, or null. */
function ratioOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1 ? value : null;
}

/** Read one non-negative integer, or null. */
function headroomOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** The policy one entry's config declares, or null when it declares none. */
function policyOf(entry: LoaderEntry): CompactionPolicy | null {
  const config = entry.options?.config;
  const record = (typeof config === 'object' && config !== null ? config : {}) as Record<string, unknown>;
  const ratio = ratioOf(record['thresholdRatio']);
  const headroom = headroomOf(record['headroomTokens']);
  const named = entry.options?.name === DEFAULT_BACKEND;
  if (ratio === null && headroom === null && !named) return null;
  return {
    ratio: ratio ?? DEFAULT_THRESHOLD_RATIO,
    headroom: headroom ?? DEFAULT_HEADROOM_TOKENS,
  };
}

/**
 * The policy that will compact a session on this deployment.
 *
 * @param ctx - host plugin context carrying the loader.
 * @returns the policy, or null when no enabled backend declares one.
 */
export function readCompactionPolicy(ctx: Context): CompactionPolicy | null {
  const loader = ctx.get('loader') as LoaderPort | undefined;
  if (loader === undefined || typeof loader.entries !== 'function') return null;
  try {
    let found: CompactionPolicy | null = null;
    for (const entry of loader.entries()) {
      if (entry.disabled === true) continue;
      const policy = policyOf(entry);
      /* A later entry wins: a profile lists the engine before the backend that
         replaces its policy, and the last declaration is the effective one. */
      if (policy !== null) found = policy;
    }
    return found;
  } catch {
    /* A loader that cannot be walked is a policy nobody can read; the panel
       leaves the row out rather than failing the plugin. */
    return null;
  }
}
