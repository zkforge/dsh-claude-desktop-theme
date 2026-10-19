import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { PersonalizationConfig } from '../../../shared/config.ts';
import { ClaudePet } from './ClaudePet.tsx';
import { ComposerPet } from './ComposerPet.tsx';
import type { PetAnchor } from '../../compat/pet-anchor.ts';

/** Business face the frame overlay injects: the measured new-session corner. */
export interface BlankPetFace {
  /** Visual variant chosen in settings. */
  readonly petStyle: PersonalizationConfig['petStyle'];
  /** Selector hook over the compat layer's measurement. */
  readonly useAnchor: () => PetAnchor | null;
}

export type BlankPetProps = PropsRuntime<'shell.overlay'> & BlankPetFace;

/**
 * The whale's only seat, drawn from the frame-wide overlay at the measured
 * corner of the new-session Composer card. Renders nothing until the anchor
 * finds a card — and the anchor only finds one on a page the host marks
 * `data-phase="hero"`, so a conversation never shows the pet.
 * @param props - injected measurement.
 * @returns the positioned whale, or null.
 */
export function BlankPet({ useAnchor, petStyle }: BlankPetProps) {
  const anchor = useAnchor();
  if (anchor === null) return null;
  return (
    <div className="ccd-pet-blank-seat" data-pet-style={petStyle} style={{ left: anchor.left, top: anchor.top }}>
      {petStyle === 'claude' ? <ClaudePet /> : <ComposerPet />}
    </div>
  );
}
