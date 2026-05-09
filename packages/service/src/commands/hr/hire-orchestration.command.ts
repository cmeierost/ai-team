import { z } from 'zod';
import {
  ContextLevel,
  type CommandRuntime,
  type HireResult,
  type ICommand,
  type ToolContext,
} from '@ai-team/core';
import type { IAgentRegistry } from '../orchestration/orchestration.types.js';

type Params = z.infer<typeof HireOrchestrationCommand.schema>;

export class HireOrchestrationCommand implements ICommand<Params, ToolContext, HireResult> {
  static readonly schema = z.object({
    name: z.string().min(1).describe('Full name of the new team member'),
    role: z.string().min(1).describe('Job role / title'),
    specializations: z.array(z.string()).optional().describe('Areas of expertise'),
    reportsTo: z.string().optional().describe('Agent ID of the direct manager'),
  });

  readonly key = 'hire';
  readonly description =
    'Create a new virtual team member with a defined role. Requires manage_agents permission.';
  readonly availableIn = { tool: true };
  readonly group = 'hr';
  readonly parameters = HireOrchestrationCommand.schema;
  readonly permissionCheck = { type: 'manage-agents' as const };
  readonly tags = ['orchestration', 'hr'];

  constructor(private readonly agents: IAgentRegistry) {}

  async execute(params: Params, context: ToolContext, _runtime: CommandRuntime): Promise<HireResult> {
    const { name, role, specializations = [], reportsTo } = params;

    const created = await this.agents.createAgentAsync({
      name,
      role,
      specializations,
      reportsTo: reportsTo ?? context.agent.id,
      contextLevel: ContextLevel.MODULE,
    });

    return {
      type: 'hire',
      agentId: created.id,
      name: created.name,
      role: created.role,
      specializations: created.specializations ?? [],
      reportsTo: created.reportsTo,
      timestamp: new Date().toISOString(),
    };
  }
}
