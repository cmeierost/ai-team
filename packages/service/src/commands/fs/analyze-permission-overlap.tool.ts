import { z } from 'zod';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IAgentManager,
  ICommandDescriptor,
} from '@ai-team/core';

export interface AnalyzePermissionOverlapParams {
  mode?: 'files' | 'patterns';
  agentId?: string;
  maxDepth?: number;
}
export const AnalyzePermissionOverlapToolMetadata = {
  key: 'analyze_permission_overlap',
  group: 'access',
  availableIn: { tool: true },
  description:
    'Analyze workspace permission overlap by files or patterns, optionally focused on one agent.',
  parameters: z.object({
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
  }),
} satisfies ICommandDescriptor;

export class AnalyzePermissionOverlapTool implements ICommand<
  AnalyzePermissionOverlapParams,
  unknown
> {
  readonly metadata = AnalyzePermissionOverlapToolMetadata;
  readonly name = 'analyze_permission_overlap';

  constructor(private readonly agentManager: IAgentManager) {}

  async execute(
    params: AnalyzePermissionOverlapParams,
    _context: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const { mode = 'files', agentId, maxDepth } = params;
    return {
      status: 'ok',
      data: await this.agentManager.analyzeWorkspacePermissionOverlap({ mode, agentId, maxDepth }),
    };
  }
}
