import fs from 'node:fs/promises';
import { z } from 'zod';

import type {
  ICommand,
  IAgentManager,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { FireOptions } from '@ai-team/api-contracts';
import { WorkflowAbortError } from '../../workflow/types.js';
import type { WorkflowDefinition } from '../../workflow/types.js';
import type { IWorkflowRunnerFactory } from '../../workflow/runner.js';

type Params = z.infer<typeof FireICommand.schema>;
const _fireICommandSchema = z.object({
  agentQuery: z.string().describe('Agent id, name, or role query'),
  options: z
    .object({
      force: z.boolean().optional().describe('Do not prompt for confirmation'),
    })
    .optional()
    .default({}),
});

export const FireICommandMetadata = {
  key: 'fire',
  cli: { command: 'fire <agent>' },
  description: 'Fire (delete) an agent and remove their data',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'hr',
  parameters: _fireICommandSchema,
} satisfies ICommandDescriptor;

export class FireICommand implements ICommand<Params, void> {
  static readonly schema = _fireICommandSchema;
  readonly metadata = FireICommandMetadata;

  constructor(
    private readonly agents: IAgentManager,
    private readonly runnerFactory: IWorkflowRunnerFactory
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    await this.runnerFactory.create().run(
      fireWorkflow,
      {
        agentManager: this.agents,
        agentQuery: payload.agentQuery,
        options: { force: payload.options?.force },
      },
      { executionContext: ctx }
    );
    return { status: 'ok' };
  }
}

interface FireWorkflowState {
  agentManager: IAgentManager;
  agentQuery: string;
  options: FireOptions;
  agent?: { name: string; id: string; role: string; filePath: string };
}

const fireWorkflow: WorkflowDefinition<FireWorkflowState> = {
  id: 'fire',
  description: 'Fire (delete) an agent and remove their data',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'hr',
  steps: [
    {
      id: 'resolve',
      execute: async (state) => {
        const matches = await state.agentManager.resolveAgentAsync(state.agentQuery);

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
      command: 'com_ask',
      skipWhen: (state) => state.options.force === true,
      params: (state) => ({
        kind: 'confirm',
        message: `Are you sure you want to fire '${state.agent!.name}' (${state.agent!.id})? This will delete their agent file.`,
        defaultBoolean: false,
      }),
      applyResult: (state, raw) => {
        const confirmed = (raw as { data?: { answer?: boolean } }).data?.answer;
        if (!confirmed) throw new WorkflowAbortError();
        return state;
      },
    },
    {
      id: 'delete',
      execute: async (state) => {
        const { agent } = state;
        if (agent?.filePath?.endsWith('.md')) {
          await fs.unlink(agent.filePath);
        } else {
          throw new Error('Could not determine agent file path.');
        }
        return state;
      },
    },
  ],
};
