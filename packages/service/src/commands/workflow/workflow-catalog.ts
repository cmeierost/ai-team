import type { ICommandRegistry } from '@ai-team/core';

export function listWorkflowToolIds(registry: Pick<ICommandRegistry, 'getAll'>): string[] {
  return registry
    .getAll({ availableIn: { tool: true } })
    .filter(
      (t) =>
        t.key !== 'list' &&
        (t.group === 'workflow' || (t.tags ?? []).includes('workflow-definition'))
    )
    .map((t) => t.key);
}
