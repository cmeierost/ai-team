import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { PermissionOverlapReport } from '@ai-team/api-contracts';

type Params = z.infer<typeof AccessOverlapCommand.schema>;
const schema = z.object({
  mode: z.enum(['files', 'patterns']).optional().describe('Analysis mode: files | patterns'),
  right: z.enum(['read', 'write', 'list']).optional().describe('Optional right filter'),
  agent: z.string().optional().describe('Optional exact agent id filter'),
  json: z.boolean().optional().describe('Output as JSON'),
});

export const AccessOverlapCommandMetadata = {
  key: 'accessOverlap',
  cli: { command: 'overlap', parentKey: 'access' },
  description: 'Analyze overlap between agent .perm file responsibilities by right',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'access',
  parameters: schema,
} satisfies ICommandDescriptor;

export class AccessOverlapCommand implements ICommand<Params, PermissionOverlapReport> {
  static readonly schema = schema;
  readonly metadata = AccessOverlapCommandMetadata;

  constructor(private readonly agentManager: IAgentManager) {}

  async execute(
    payload: Params,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<PermissionOverlapReport>> {
    const result = await this.agentManager.analyzeWorkspacePermissionOverlap({
      mode: payload.mode,
      agentId: payload.agent,
    });
    return { status: 'ok', data: result as PermissionOverlapReport };
  }
}
