import { useSyncExternalStore } from 'react';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { FeatureEnvironment } from '../../contracts/feature.ts';
import type { CleanupScope } from '../../core/cleanup.ts';
import type { Disposer } from '../../contracts/ports.ts';
import { createPetAnchor } from '../../compat/pet-anchor.ts';
import { DSH_SLOTS } from '../../compat/slots.ts';
import { BlankPet } from './BlankPet.tsx';
import css from './pet.css';

/** List order inside the frame-wide overlay; the plugin owns no other occupant. */
const PET_ORDER = 20;

/**
 * Mount the new-session whale in shell.overlay at the measured Composer corner.
 * pet-anchor selects the DSH conversation root's data-phase=hero state.
 * @param cleanup - scope owning the styles, slot registration and anchor.
 */
export function mountComposerPet(ctx: Context, environment: FeatureEnvironment, cleanup: CleanupScope): void {
  cleanup.add(environment.dom.mountStyles(css));
  const registration = ctx.inject(['slots'], scope => {
    const disposers: Disposer[] = [];
    /* The frame-wide seat belongs to the blank-session page's own layout, so it
       follows that feature rather than the pet's switch. */
    if (environment.config.features['new-session']) {
      const anchor = createPetAnchor(
        document,
        error => environment.logger.error('composer-pet: frame-wide seat unavailable; native UI retained', error),
        environment.config.personalization.petStyle === 'claude' ? { width: 36, height: 24, inset: 9 } : undefined,
      );
      disposers.push(anchor.dispose);
      disposers.push(scope.slots.inject(DSH_SLOTS.shellOverlay, () => scope.slots.register({
        name: DSH_SLOTS.shellOverlay, id: 'ccd-blank-pet', order: PET_ORDER,
        inject: () => ({
          petStyle: environment.config.personalization.petStyle,
          useAnchor: () => useSyncExternalStore(anchor.subscribe, anchor.getSnapshot),
        }),
      }, BlankPet)));
    }
    return () => {
      /* Reverse acquisition order, without mutating the list: the seat that
         needs the anchor (and its React tree) goes before the anchor itself. */
      for (const dispose of [...disposers].reverse()) dispose();
    };
  });
  cleanup.add(() => { void registration.dispose(); });
}
