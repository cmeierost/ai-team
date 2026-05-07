import { z } from 'zod';
import type { ICommand, CommandRuntime, IAgentManager } from '@ai-team/core';
import type { ListToolsResponse } from '@ai-team/api-contracts';
import type { ToolManager } from '../../tools/tool-manager.js';
import { listToolsCommand } from './tools.js';

type Params = z.infer<typeof ToolsListCommand.schema>;

export class ToolsListCommand implements ICommand<Params, void, ListToolsResponse> {
  static readonly schema = z.object({
    agent: z.string().optional().describe('Show tool allow/deny state for a specific agent'),
    json: z.boolean().optional().describe('Output as JSON'),
  });

  readonly key = 'toolsList';
  readonly cli = { command: 'tools' };
  readonly description = 'List available tools and optionally annotate permissions for an agent';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = ToolsListCommand.schema;

  constructor(
    private readonly agents: IAgentManager,
    private readonly toolManager: ToolManager
  ) {}

  async execute(payload: Params, _ctx: void, _runtime: CommandRuntime): Promise<ListToolsResponse> {
    return listToolsCommand(this.agents, this.toolManager, { agent: payload.agent });
  }
}
