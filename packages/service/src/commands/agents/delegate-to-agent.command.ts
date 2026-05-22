import { z } from 'zod';
import type {
  ICommand,
  CommandResponse,
  ExecutionContext,
  ICommandDescriptor,
} from '@ai-team/core';

// ─── DelegateToAgent ──────────────────────────────────────────────────────────

export interface DelegateToAgentParams {
  agentId: string;
  task: string;
  context?: string[];
}
export const DelegateToAgentToolMetadata = {
  key: 'delegate',
  group: 'com',
  availableIn: { tool: true, chat: true },
  description: 'Delegate a task to another agent. Checks delegation permissions.',
  parameters: z.object({
    agentId: z.string().describe('Target agent ID'),
    task: z.string().describe('Task description'),
    context: z.array(z.string()).optional().describe('File paths for context'),
  }),
} satisfies ICommandDescriptor;

export type DelegateToAgentResult = {
  delegatedTo: string;
  task: string;
  contextFiles?: string[];
  timestamp: string;
};

export class DelegateToAgentCommand implements ICommand<
  DelegateToAgentParams,
  DelegateToAgentResult
> {
  readonly metadata = DelegateToAgentToolMetadata;
  readonly name = 'delegate';

  async execute(
    params: DelegateToAgentParams,
    context: ExecutionContext
  ): Promise<CommandResponse<DelegateToAgentResult>> {
    const { agentId, task, context: contextFiles } = params;
    if (!context.agent) {
      return {
        status: 'error',
        message: 'No calling agent in context',
        error: { code: 'NO_CALLER', message: 'No calling agent in context' },
      };
    }
    if (!context.agent.delegatesTo?.includes(agentId)) {
      return {
        status: 'error',
        message: `Agent ${context.agent.id} cannot delegate to ${agentId}`,
        error: {
          code: 'DELEGATION_NOT_ALLOWED',
          message: `Agent ${context.agent.id} cannot delegate to ${agentId}`,
          details: { attemptedDelegateTo: agentId, task, contextFiles },
        },
      };
    }
    return {
      status: 'ok',
      message: `Task delegated to agent ${agentId}`,
      data: { delegatedTo: agentId, task, contextFiles, timestamp: new Date().toISOString() },
    };
  }
}
