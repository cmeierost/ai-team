import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import type { Employee } from '@ai-team/api-contracts';

type Params = z.infer<typeof TeamListICommand.schema>;

export class TeamListICommand implements ICommand<Params, Employee[]> {
  static readonly schema = z.object({
    role: z.string().optional().describe('Filter employees by role'),
    feature: z.string().optional().describe('Filter employees by supported feature'),
  });

  readonly key = 'team-list';
  readonly cli = { command: 'list', parentKey: 'team' };
  readonly description = 'List all team members';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'team';
  readonly parameters = TeamListICommand.schema;

  constructor(private readonly agentManager: IAgentManager) {}

  async execute(payload: Params, _ctx: ExecutionContext): Promise<CommandResponse<Employee[]>> {
    let employees = (await this.agentManager.getAllAgentsAsync()) as Employee[];
    if (payload.role) {
      employees = employees.filter((e) => e.role === payload.role);
    }
    if (payload.feature) {
      const feature = payload.feature;
      employees = employees.filter((e) => e.features?.includes(feature));
    }
    return { status: 'ok', data: employees };
  }
}
