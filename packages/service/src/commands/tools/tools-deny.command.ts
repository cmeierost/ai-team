import { z } from 'zod';
import type { ICommand, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { UpdateAgentToolResponse } from '@ai-team/api-contracts';
import { AgentToolsService } from './tools-service.js';

type Params = z.infer<typeof ToolsDenyCommand.schema>;

export class ToolsDenyCommand implements ICommand<Params, UpdateAgentToolResponse> {
  public static readonly schema = z.object({
    agent: z.string().describe('Agent id, name, or role query'),
    tool: z.string().describe('Tool name to disallow'),
    requestedBy: z.string().optional().describe('Governance actor requesting the change'),
    approvedByUser: z.boolean().optional().describe('Mark user approval as granted'),
    json: z.boolean().optional().describe('Output as JSON'),
  });

  readonly key = 'toolsDeny';
  readonly aliases = ['remove'];
  readonly cli = { command: 'disallow', parentKey: 'tools' };
  readonly description = 'Disallow a tool for an agent (governed)';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'tool';
  readonly parameters = ToolsDenyCommand.schema;

  constructor(private readonly toolsService: AgentToolsService) {}

  async execute(
    payload: Params,
    ctx: ExecutionContext
  ): Promise<CommandResponse<UpdateAgentToolResponse>> {
    const data = await this.toolsService.governedDeny(ctx, payload);
    return { status: 'ok', data };
  }
}
