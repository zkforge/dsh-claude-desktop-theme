import type { ImplementedFeature } from '../../contracts/feature.ts';
import { mountToolCallGroups } from '../../compat/tool-call-groups.ts';
import { mountToolCallLabels } from '../../compat/tool-call-labels.ts';
import { mountToolCallDetails } from '../../compat/tool-call-details.ts';
import toolCallsCss from './tool-calls.css';

export const toolCallsFeature: ImplementedFeature = {
  id: 'tool-calls', status: 'implemented', task: 'ARCHITECTURE.md#界面模块',
  mount(environment, scope) {
    scope.add(environment.dom.mountStyles(toolCallsCss));
    scope.add(mountToolCallGroups(document, error => environment.logger.error('tool-calls: grouping failed', error)));
    scope.add(mountToolCallLabels(document, error => environment.logger.error('tool-calls: labels failed', error)));
    scope.add(mountToolCallDetails(document, error => environment.logger.error('tool-calls: details failed', error)));
  },
};
