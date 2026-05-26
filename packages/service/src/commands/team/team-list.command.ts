import { z } from 'zod';
import type { ICommand, IAgentManager, ICommandDescriptor } from '@ai-team/core';
import type { Employee } from '@ai-team/api-contracts';

type Params = z.infer<typeof TeamListICommand.schema>;
const _teamListICommandSchema = z.object({
  role: z.string().optional().describe('Filter employees by role'),
  feature: z.string().optional().describe('Filter employees by supported feature'),
});

export const TeamListICommandMetadata = {
  key: 'list',
  description: 'List all team members',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'team',
  parameters: _teamListICommandSchema,
} satisfies ICommandDescriptor;

export class TeamListICommand implements ICommand<Params, Employee[]> {
  static readonly schema = _teamListICommandSchema;
  readonly metadata = TeamListICommandMetadata;
  readonly key = 'list' as const;
  readonly cli = { command: 'list', parentKey: 'team' } as const;

  constructor(private readonly agentManager: IAgentManager) {}

  async execute(payload: Params, _unusedOrCtx?: unknown, _ctx?: unknown): Promise<any> {
    let employees = (await this.agentManager.getAllAgentsAsync()) as Employee[];
    if (payload.role) {
      employees = employees.filter((e) => e.role === payload.role);
    }
    if (payload.feature) {
      const feature = payload.feature;
      employees = employees.filter((e) => e.features?.includes(feature));
    }
    return employees;
  }
}
