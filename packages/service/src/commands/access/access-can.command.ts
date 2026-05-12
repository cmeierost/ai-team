import { z } from 'zod';
import type { ICommand, ExecutionContext, CommandResponse, IAgentManager } from '@ai-team/core';
import type { DoIHavePermissionResponse } from '@ai-team/api-contracts';
import type { AccessService } from './access-service.js';

type Params = z.infer<typeof AccessCanCommand.schema>;

export class AccessCanCommand implements ICommand<Params, DoIHavePermissionResponse> {
  static readonly schema = z.object({
    path: z.string().describe('Path to evaluate'),
    right: z.enum(['read', 'write', 'list']).default('list').describe('Right to evaluate'),
    agent: z.string().optional().describe('Optional agent query override'),
    json: z.boolean().optional().describe('Output as JSON'),
  });

  readonly key = 'accessCan';
  readonly cli = { command: 'can', parentKey: 'access' };
  readonly description = 'Check whether a context/agent can access a path for a right';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'access';
  readonly parameters = AccessCanCommand.schema;

  constructor(
    private readonly accessService: AccessService,
    private readonly agentManager: IAgentManager
  ) {}

  async execute(
    payload: Params,
    ctx: ExecutionContext
  ): Promise<CommandResponse<DoIHavePermissionResponse>> {
    const agentQuery = payload.agent ?? ctx.agent?.id;
    if (!agentQuery) {
      return {
        status: 'error',
        message: 'No agent specified',
        error: { code: 'AGENT_NOT_FOUND', message: 'No agent specified' },
      };
    }
    const data = await this.accessService.doIHaveAccess({
      path: payload.path,
      right: payload.right,
      agent: agentQuery,
    });
    return { status: 'ok', data };
  }
}
