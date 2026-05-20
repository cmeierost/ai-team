import { z } from 'zod';
import type { ExecutionContext, ICommand, CommandResponse, IAgentManager } from '@ai-team/core';

export interface AnalyzePermissionOverlapParams {
  mode?: 'files' | 'patterns';
  agentId?: string;
  maxDepth?: number;
}

export class AnalyzePermissionOverlapTool implements ICommand<
  AnalyzePermissionOverlapParams,
  unknown
> {
  readonly name = 'analyze_permission_overlap';
  readonly key = 'analyze_permission_overlap';
  readonly group = 'access';
  readonly availableIn = { tool: true };
  readonly description =
    'Analyze workspace permission overlap by files or patterns, optionally focused on one agent.';
  readonly parameters = z.object({
    mode: z.enum(['files', 'patterns']).optional().describe('Analysis mode (default: files)'),
    agentId: z
      .string()
      .optional()
      .describe('Optional exact agent id for focused overlap reporting'),
    maxDepth: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Optional max workspace traversal depth for file mode'),
  });

  constructor(private readonly agentManager: IAgentManager) {}

  async execute(
    params: AnalyzePermissionOverlapParams,
    context: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const { mode = 'files', agentId, maxDepth } = params;
    return {
      status: 'ok',
      data: await this.agentManager.analyzeWorkspacePermissionOverlap({ mode, agentId, maxDepth }),
    };
  }
}
