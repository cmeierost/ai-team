import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import type { Agent } from '@ai-team/api-contracts';

type Params = z.infer<typeof ResolveEmployeesICommand.schema>;

export class ResolveEmployeesICommand implements ICommand<Params, Agent[]> {
  static readonly schema = z.object({
    query: z.string().describe('Agent id, name, or role query'),
    json: z.boolean().optional().describe('Output as JSON'),
  });

  readonly key = 'resolveEmployees';
  readonly cli = { command: 'info <agent>' };
  readonly description = 'Show detailed information about an employee';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'team';
  readonly parameters = ResolveEmployeesICommand.schema;

  constructor(private readonly agents: IAgentManager) {}

  async execute(payload: Params, _ctx: ExecutionContext): Promise<CommandResponse<Agent[]>> {
    const matches = (await this.agents.resolveAgentAsync(payload.query)) as Agent[];
    return { status: 'ok', data: matches };
  }
}
