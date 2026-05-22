import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { UpdateAgentToolResponse } from '@ai-team/api-contracts';
import { AgentToolsService } from './tools-service.js';

type Params = z.infer<typeof ToolsDenyCommand.schema>;
const _toolsDenyCommandSchema = z.object({
  agent: z.string().describe('Agent id, name, or role query'),
  tool: z.string().describe('Tool name to disallow'),
  requestedBy: z.string().optional().describe('Governance actor requesting the change'),
  approvedByUser: z.boolean().optional().describe('Mark user approval as granted'),
  json: z.boolean().optional().describe('Output as JSON'),
});

export const ToolsDenyCommandMetadata = {
  key: 'deny',
  description: 'Disallow a tool for an agent (governed)',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'tool',
  parameters: _toolsDenyCommandSchema,
} satisfies ICommandDescriptor;

export class ToolsDenyCommand implements ICommand<Params, UpdateAgentToolResponse> {
  public static readonly schema = _toolsDenyCommandSchema;
  readonly metadata = ToolsDenyCommandMetadata;

  constructor(private readonly toolsService: AgentToolsService) {}

  async execute(
    payload: Params,
    ctx: ExecutionContext
  ): Promise<CommandResponse<UpdateAgentToolResponse>> {
    const data = await this.toolsService.governedDeny(ctx, payload);
    return { status: 'ok', data };
  }
}
