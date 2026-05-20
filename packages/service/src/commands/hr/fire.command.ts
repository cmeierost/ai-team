import fs from 'node:fs/promises';
import { z } from 'zod';

import type { ICommand, IAgentManager, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { FireOptions } from '@ai-team/api-contracts';
import type { WorkflowDefinition } from '../../workflow/types.js';
import { runWorkflowAsync } from '../../workflow/runner.js';
import type { IQuestionService } from '../../questions/question-service.js';

type Params = z.infer<typeof FireICommand.schema>;

export class FireICommand implements ICommand<Params, void> {
  static readonly schema = z.object({
    employeeQuery: z.string().describe('Agent id, name, or role query'),
    options: z
      .object({
        force: z.boolean().optional().describe('Do not prompt for confirmation'),
      })
      .optional()
      .default({}),
  });

  readonly key = 'fire';
  readonly cli = { command: 'fire <agent>' };
  readonly description = 'Fire (delete) an employee and remove their data';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'hr';
  readonly parameters = FireICommand.schema;

  constructor(
    private readonly agents: IAgentManager,
    private readonly questionService: IQuestionService
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    await runWorkflowAsync(
      fireWorkflow,
      {
        agentManager: this.agents,
        agentQuery: payload.employeeQuery,
        options: { force: payload.options?.force },
      },
      ctx,
      this.questionService
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
  steps: [
    {
      id: 'resolve',
      kind: 'action',
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
