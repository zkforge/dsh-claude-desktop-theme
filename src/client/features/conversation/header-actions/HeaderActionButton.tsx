import type { ReactElement } from 'react';

/** Props the registration layer derives; the component never sees `ctx`. */
export interface HeaderActionProps {
  /** Localised accessible name, also used as the native tooltip. */
  readonly label: string;
  /** Which right-panel view this button opens; selects the glyph in CSS. */
  readonly kind: 'terminal' | 'browser' | 'files';
  /** Opens or focuses the native right-panel view. */
  readonly open: () => void;
}

/**
 * One view button for the conversation header.
 *
 * All three sit in the utilities group beside the native actions, in terminal,
 * browser, project folder order. Blank Sessions use the corner seat instead,
 * because the host omits their utilities group. The panel's shipped expand
 * control is retired and its action moves into the Session menu.
 * All three are the same control: the box size, hover surface and spacing
 * belong to the seat's own stylesheet
 * (`features/conversation/conversation.css`) so every control in the row shares
 * one rhythm; this component only carries the glyph, the name and the click.
 *
 * @param props - Derived label, view kind and callback.
 * @returns The header button.
 */
export function HeaderActionButton({ label, kind, open }: HeaderActionProps): ReactElement {
  return (
    <button
      type="button"
      className="ccd-header-action"
      data-ccd-header-view={kind}
      aria-label={label}
      title={label}
      onClick={open}
    />
  );
}
