import type { ImplementedFeature } from '../../contracts/feature.ts';
import { probeHost } from '../../compat/host-dom.ts';
import shellCss from './shell.css';
import rightPanelCss from './right-panel.css';

/**
 * Window frame and column geometry: flat surfaces, the sidebar column and its
 * divider, and the right panel's floating card. The three tracks stay entirely
 * `ui-layout`'s solve, so resizing the sidebar with the handle moves the divider
 * the pointer is on; the plugin only paints the columns.
 *
 * The right panel is a column's occupant rather than a track, so its card is
 * two sheets: `shell.css` insets the panel's box and paints the surface, and
 * `right-panel.css` dresses what the panel draws inside it — the file tree's
 * rows included, which belong to no feature of this plugin's own. Both mount
 * with the frame, because neither has a switch of its own to lose.
 */
export const shellFeature: ImplementedFeature = {
  id: 'shell',
  status: 'implemented',
  task: 'ARCHITECTURE.md#界面模块',
  mount(environment, scope) {
    if (!probeHost(document).frame) {
      environment.logger.debug('shell: frame anchor missing; native frame retained');
      return;
    }
    scope.add(environment.dom.mountStyles(shellCss));
    scope.add(environment.dom.mountStyles(rightPanelCss));
  },
};
