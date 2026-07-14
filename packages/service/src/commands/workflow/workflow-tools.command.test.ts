import { describe, expect, it } from 'vitest';
import type { WorkflowDefinitionApiResponse } from '@ai-team/api-contracts';

import {
  createWorkflowDefinitionCommands,
  ListWorkflowsOrchestrationCommand,
} from './workflow-tools.command.js';

function makeWorkflowCatalog() {
  // Legacy workflows migrated to XState-based WorkflowRunner
  const ids: string[] = [];

  return {
    listWorkflowIds: () => ids,
    getWorkflowDefinition: async (workflowId: string): Promise<WorkflowDefinitionApiResponse> => ({
      workflowId,
      format: 'workflow/v1',
      definitionJson: { format: 'workflow/v1', id: workflowId, initial: 'noop', states: {} },
      definitionYaml: `format: workflow/v1\nid: ${workflowId}\ninitial: noop\nstates: {}`,
    }),
  };
}

describe('workflow orchestration tools', () => {
  it('creates workflow_list command when no legacy workflows present', () => {
    const commands = createWorkflowDefinitionCommands(makeWorkflowCatalog() as any);

    const keys = commands.map((command) => `${command.group}_${command.key}`);
    expect(keys).toContain('workflow_list');
    expect(commands).toHaveLength(1);
  });

  it('workflow_list command returns empty array when no legacy workflows', async () => {
    const command = new ListWorkflowsOrchestrationCommand(makeWorkflowCatalog() as any);

    const result = await command.execute(
      {},
      {
        agentId: 'michael-brown',
        workspaceRoot: '/workspace',
        agent: { id: 'michael-brown', permissions: {} },
      } as any,
      { invocationSurface: 'tool', workspaceRoot: '/workspace', agentId: 'michael-brown' }
    );

    expect(result.type).toBe('workflow_list_result');
    expect(result.workflows).toEqual([]);
  });
});
