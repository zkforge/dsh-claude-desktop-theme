import type { Context } from '@deepseek-ai/cordis';
import type { FeatureEnvironment } from '../../contracts/feature.ts';
import type { CleanupScope } from '../../core/cleanup.ts';
import { mountFilesPane } from '../../compat/files-pane.ts';
import { mountRightPanes } from '../../compat/right-panes.ts';
import frameCss from './frame.css';
import rightPanelCss from './right-panel.css';

/** Styles, injected controls and pane layout share the right-sidebar switch. */
export function mountRightPanel(ctx: Context, environment: FeatureEnvironment, scope: CleanupScope): void {
  if (!environment.config.features['right-panel']) return;
  scope.add(environment.dom.mountStyles(frameCss));
  scope.add(environment.dom.mountStyles(rightPanelCss));
  scope.add(mountFilesPane(
    document,
    error => environment.logger.error('files pane: observer failed', error),
  ));
  scope.add(mountRightPanes(
    ctx,
    document,
    error => environment.logger.error('right panes: observer failed', error),
  ));
}
