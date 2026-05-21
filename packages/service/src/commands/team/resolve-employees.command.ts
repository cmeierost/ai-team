import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { Agent } from '@ai-team/api-contracts';

type Params = z.infer<typeof ResolveEmployeesICommand.schema>;
const _resolveEmployeesICommandSchema = z.object({
  query: z.string().describe('Agent id, name, or role query'),
  json: z.boolean().optional().describe('Output as JSON'),
});

export const ResolveEmployeesICommandMetadata = {
  key: 'resolveEmployees',
  cli: { command: 'info <agent>' },
  description: 'Show detailed information about an employee',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'team',
  parameters: _resolveEmployeesICommandSchema,
} satisfies ICommandDescriptor;

export class ResolveEmployeesICommand implements ICommand<Params, Agent[]> {
  static readonly schema = _resolveEmployeesICommandSchema;
  readonly metadata = ResolveEmployeesICommandMetadata;

  constructor(private readonly agents: IAgentManager) {}

  async execute(payload: Params, _ctx: ExecutionContext): Promise<CommandResponse<Agent[]>> {
    const matches = (await this.agents.resolveAgentAsync(payload.query)) as Agent[];
    return { status: 'ok', data: matches };
  }
}
