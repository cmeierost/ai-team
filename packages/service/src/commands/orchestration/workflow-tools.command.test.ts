import { describe, expect, it } from 'vitest';
import type { WorkflowDefinitionApiResponse } from '@ai-team/api-contracts';

import {
  createWorkflowDefinitionCommands,
  ListWorkflowsOrchestrationCommand,
} from './workflow-tools.command.js';

function makeWorkflowCatalog() {
  const ids = [
    'chat-full-loop',
    'chat-preturn-interceptors',
    'chat-send-turn',
    'chat-tool-round',
    'chat-post-turn-resolution',
    'chat-handoff-transition',
    'chat-turn-failure',
  ];

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
  it('creates one dedicated workflow tool per workflow ID plus workflow_list', () => {
    const commands = createWorkflowDefinitionCommands(makeWorkflowCatalog() as any);

    const keys = commands.map((command) => `${command.group}_${command.key}`);
    expect(keys).toContain('workflow_list');
    expect(keys).toContain('workflow_chat-full-loop');
    expect(keys).toContain('workflow_chat-send-turn');
    expect(keys).toContain('workflow_chat-turn-failure');
    expect(commands).toHaveLength(8);
  });

  it('workflow_list command returns all workflow IDs', async () => {
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
    expect(result.workflows).toContain('chat-full-loop');
    expect(result.workflows).toContain('chat-send-turn');
  });
});
