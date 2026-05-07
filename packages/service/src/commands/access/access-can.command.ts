import { z } from 'zod';
import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { DoIHavePermissionResponse } from '@ai-team/api-contracts';
import type { AccessService } from './access-service.js';

type Params = z.infer<typeof AccessCanCommand.schema>;

export class AccessCanCommand implements ICommand<Params, void, DoIHavePermissionResponse> {
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
  readonly parameters = AccessCanCommand.schema;

  constructor(private readonly accessService: AccessService) {}

  async execute(
    payload: Params,
    _ctx: void,
    _runtime: CommandRuntime
  ): Promise<DoIHavePermissionResponse> {
    return this.accessService.doIHaveAccess(payload);
  }
}
