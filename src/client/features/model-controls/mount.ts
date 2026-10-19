import { useSyncExternalStore } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { FeatureEnvironment } from '../../contracts/feature.ts';
import type { CleanupScope } from '../../core/cleanup.ts';
import { ModelControls } from './ModelControls.tsx';
import { effortSelection } from './selection.ts';
import css from './controls.css';
import effortCss from './effort.css';

/**
 * The browser's session list store, declared by the one member this file uses.
 *
 * `ctx.sessions` on the client is `@deepseek-ai/dsh-api-session-controller`'s
 * client half (it answers `subagentAddress`), not the Host's `SessionStore`
 * from `@deepseek-ai/dsh-session` — that package is outside this project's
 * type baseline, and importing its Context augmentation would mistype the
 * service in the browser half. Source: the package's `client` export.
 */
interface ClientSessionList {
  /** Address of the subagent behind one session, or undefined for a top-level session. */
  subagentAddress(sessionId: string): unknown;
}

/** Register a presentation occupant over the native seat, sharing its official directory. */
export function mountModelControls(ctx: Context, environment: FeatureEnvironment, cleanup: CleanupScope): void {
  cleanup.add(environment.dom.mountStyles(css));
  cleanup.add(environment.dom.mountStyles(effortCss));
  const registration = ctx.inject(['modelDirectories', 'sessions', 'slots', 'remote', 'remote.session'], scope => {
    const sessions = scope.sessions as unknown as ClientSessionList;
    return scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model', priority: -10, locale: 'model',
      inject: slotSessionId => {
        // Slot scopes are strings; the resolver requires the SDK-branded session id.
        const sessionId = slotSessionId as Parameters<typeof scope.modelDirectories.directoryFor>[0];
        const directory = scope.modelDirectories.directoryFor(sessionId);
        const available = sessions.subagentAddress(sessionId) === undefined;
        return {
          available,
          showModelIcons: environment.config.view.showModelIcons,
          useDirectory: () => useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot),
          load: () => { if (available) void directory.load().catch(() => {}); },
          select: (selection: Parameters<typeof directory.select>[0]) => available ? directory.select(selection) : Promise.resolve(undefined),
          selectEffort: (route: Parameters<typeof directory.select>[0], effort: string | undefined) => {
            if (!available) return;
            const selection = effortSelection(directory.store.getSnapshot(), route, effort);
            if (selection) void directory.select(selection).catch(() => {});
          },
        };
      },
    }, ModelControls));
  });
  cleanup.add(() => { void registration.dispose(); });
}
