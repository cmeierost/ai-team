import { z } from 'zod';
import {
  ContextLevel,
  type ExecutionContext,
  type HireResult,
  type ICommand,
  type CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { IAgentRegistry } from '../orchestration/orchestration.types.js';

type Params = z.infer<typeof HireOrchestrationCommand.schema>;
const _hireOrchestrationCommandSchema = z.object({
  name: z.string().min(1).describe('Full name of the new team member'),
  role: z.string().min(1).describe('Job role / title'),
  specializations: z.array(z.string()).optional().describe('Areas of expertise'),
  reportsTo: z.string().optional().describe('Agent ID of the direct manager'),
});

export const HireOrchestrationCommandMetadata = {
  key: 'hire',
  description:
    'Create a new virtual team member with a defined role. Requires manage_agents permission.',
  availableIn: { tool: true },
  group: 'hr',
  parameters: _hireOrchestrationCommandSchema,
  permissionCheck: { type: 'manage-agents' as const },
  tags: ['orchestration', 'hr'],
} satisfies ICommandDescriptor;

export class HireOrchestrationCommand implements ICommand<Params, HireResult> {
  static readonly schema = _hireOrchestrationCommandSchema;
  readonly metadata = HireOrchestrationCommandMetadata;

  constructor(private readonly agents: IAgentRegistry) {}

  async execute(params: Params, ctx: ExecutionContext): Promise<CommandResponse<HireResult>> {
    const { name, role, specializations = [], reportsTo } = params;

    const created = await this.agents.createAgentAsync({
      name,
      role,
      specializations,
      reportsTo: reportsTo ?? ctx.agentId,
      contextLevel: ContextLevel.MODULE,
    });

    return {
      status: 'ok',
      data: {
        type: 'hire',
        agentId: created.id,
        name: created.name,
        role: created.role,
        specializations: created.specializations ?? [],
        reportsTo: created.reportsTo,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
