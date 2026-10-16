import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { ViewConfig } from '../../../../shared/config.ts';
import type { HostServices } from '../../../contracts/ports.ts';
import type { CleanupScope } from '../../../core/cleanup.ts';
import { DSH_SLOTS, OVERRIDE_PRIORITY } from '../../../compat/slots.ts';

/**
 * Native entry ids and order verified in the pinned app.asar's ui-subagent and
 * experimental-client-ui-agent-team registrations. Retire only these entries;
 * subagent lineage navigation and third-party header actions retain their seats.
 */
const ENTRIES = [
  { field: 'showHeaderSubagents', id: 'subagent-catalog', order: -30 },
  { field: 'showHeaderTeam', id: 'agent-team', order: -20 },
] as const;

/** Shadow a hidden entry with an empty renderer; releasing it restores DSH's. */
export function mountHeaderVisibility(
  slots: HostServices['slots'],
  view: Pick<ViewConfig, 'showHeaderSubagents' | 'showHeaderTeam'>,
  cleanup: CleanupScope,
): void {
  for (const entry of ENTRIES) {
    if (view[entry.field]) continue;
    cleanup.add(slots.inject(DSH_SLOTS.sessionHeaderActions, () => slots.register({
      name: DSH_SLOTS.sessionHeaderActions,
      id: entry.id,
      order: entry.order,
      priority: OVERRIDE_PRIORITY,
    }, () => null)));
  }
}
