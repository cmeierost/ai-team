import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { ListToolsResponse } from '@ai-team/api-contracts';
import { AgentToolsService } from './tools-service.js';

type Params = z.infer<typeof ToolsListCommand.schema>;
const _toolsListCommandSchema = z.object({
  agent: z.string().optional().describe('Show tool allow/deny state for a specific agent'),
  json: z.boolean().optional().describe('Output as JSON'),
});

export const ToolsListCommandMetadata = {
  key: 'list',
  description: 'List available tools and optionally annotate permissions for an agent',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'tool',
  parameters: _toolsListCommandSchema,
} satisfies ICommandDescriptor;

export class ToolsListCommand implements ICommand<Params, ListToolsResponse> {
  static readonly schema = _toolsListCommandSchema;
  readonly metadata = ToolsListCommandMetadata;

  constructor(private readonly toolsService: AgentToolsService) {}

  async execute(
    payload: Params,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<ListToolsResponse>> {
    const data = await this.toolsService.list({ agent: payload.agent });
    return { status: 'ok', data };
  }
}
