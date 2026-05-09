import { z } from 'zod';
import type { ICommand, CommandRuntime, IAgentManager } from '@ai-team/core';
import type { PermissionOverlapReport } from '@ai-team/api-contracts';

type Params = z.infer<typeof AccessOverlapCommand.schema>;

export class AccessOverlapCommand implements ICommand<Params, void, PermissionOverlapReport> {
  static readonly schema = z.object({
    mode: z.enum(['files', 'patterns']).optional().describe('Analysis mode: files | patterns'),
    right: z.enum(['read', 'write', 'list']).optional().describe('Optional right filter'),
    agent: z.string().optional().describe('Optional exact agent id filter'),
    json: z.boolean().optional().describe('Output as JSON'),
  });

  readonly key = 'accessOverlap';
  readonly cli = { command: 'overlap', parentKey: 'access' };
  readonly description = 'Analyze overlap between agent .perm file responsibilities by right';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'access';
  readonly parameters = AccessOverlapCommand.schema;

  constructor(private readonly agentManager: IAgentManager) {}

  async execute(
    payload: Params,
    _ctx: void,
    _runtime: CommandRuntime
  ): Promise<PermissionOverlapReport> {
    const result = await this.agentManager.analyzeWorkspacePermissionOverlap({
      mode: payload.mode,
      agentId: payload.agent,
    });
    return result as unknown as PermissionOverlapReport;
  }
}
