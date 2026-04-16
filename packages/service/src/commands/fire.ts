import fs from 'node:fs/promises';
import { AgentManager } from '@ai-team/infrastructure';
import type { FireOptions, InteractionContext } from '@ai-team/api-client';
import type { WorkflowDefinition } from '../workflow/types.js';
import { runWorkflowAsync } from '../workflow/runner.js';

interface FireWorkflowState {
  workspaceRoot: string;
  agentQuery: string;
  options: FireOptions;
  agent?: { name: string; id: string; role: string; filePath: string };
}

const fireWorkflow: WorkflowDefinition<FireWorkflowState> = {
  id: 'fire',
  steps: [
    {
      id: 'resolve',
      kind: 'action',
      execute: async (state) => {
        const agentManager = new AgentManager(state.workspaceRoot);
        const matches = await agentManager.resolveAgentAsync(state.agentQuery);

        if (matches.length === 0) {
          throw new Error(`No agent found matching "${state.agentQuery}".`);
        }

        if (matches.length > 1) {
          const summary = matches.map((m) => `${m.name} (${m.role}) [${m.id}]`).join(', ');
          throw new Error(`Multiple agents match "${state.agentQuery}": ${summary}`);
        }

        return { ...state, agent: matches[0] };
      },
    },
    {
      id: 'confirm',
      kind: 'confirm',
      message: (state) =>
        `Are you sure you want to fire '${state.agent!.name}' (${state.agent!.id})? This will delete their agent file.`,
      default: false,
      onDeclined: 'abort',
      skipWhen: (state) => state.options.force === true,
    },
    {
      id: 'delete',
      kind: 'action',
      execute: async (state) => {
        const { agent } = state;
        if (agent?.filePath && agent.filePath.endsWith('.md')) {
          await fs.unlink(agent.filePath);
        } else {
          throw new Error('Could not determine agent file path.');
        }
        return state;
      },
    },
  ],
};

export async function fireCommand(
  workspaceRoot: string,
  agentQuery: string,
  options: FireOptions,
  context: InteractionContext = {}
) {
  await runWorkflowAsync(fireWorkflow, { workspaceRoot, agentQuery, options }, context);
}
