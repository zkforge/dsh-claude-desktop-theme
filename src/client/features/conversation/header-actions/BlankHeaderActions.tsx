import { HeaderActionButton } from './HeaderActionButton.tsx';
import type { VIEWS } from './entries.ts';

type View = (typeof VIEWS)[number];

export interface BlankHeaderActionsProps {
  readonly labels: Record<View['kind'], string>;
  readonly useAvailableViews: () => readonly View[];
  readonly open: (kind: View['kind']) => void;
}

/** The blank header keeps its corner seat even while it omits Session utilities. */
export function BlankHeaderActions({ labels, useAvailableViews, open }: BlankHeaderActionsProps) {
  const views = useAvailableViews();
  if (views.length === 0) return null;
  return (
    <div className="ccd-blank-header-actions">
      {views.map(view => (
        <HeaderActionButton key={view.id} kind={view.kind} label={labels[view.kind]}
          open={() => { open(view.kind); }} />
      ))}
    </div>
  );
}
