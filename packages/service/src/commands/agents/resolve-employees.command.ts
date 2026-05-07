import { z } from 'zod';
import type { ICommand, CommandRuntime, IAgentManager } from '@ai-team/core';
import type { Agent } from '@ai-team/api-contracts';
import { ResolveEmployeesCommand as ResolveEmployeesCommandImpl } from '../setup/info.js';

type Params = z.infer<typeof ResolveEmployeesICommand.schema>;

export class ResolveEmployeesICommand implements ICommand<Params, void, Agent[]> {
  static readonly schema = z.object({
    query: z.string().describe('Agent id, name, or role query'),
    json: z.boolean().optional().describe('Output as JSON'),
  });

  readonly key = 'resolveEmployees';
  readonly cli = { command: 'info <agent>' };
  readonly description = 'Show detailed information about an employee';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = ResolveEmployeesICommand.schema;

  constructor(private readonly agents: IAgentManager) {}

  async execute(payload: Params, _ctx: void, _runtime: CommandRuntime): Promise<Agent[]> {
    return new ResolveEmployeesCommandImpl(this.agents).execute(payload.query);
  }
}
