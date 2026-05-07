import { z } from 'zod';
import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { WhoHasPermissionResponse } from '@ai-team/api-contracts';
import type { AccessService } from './access-service.js';

type Params = z.infer<typeof AccessWhoCommand.schema>;

export class AccessWhoCommand implements ICommand<Params, void, WhoHasPermissionResponse> {
  static readonly schema = z.object({
    path: z.string().describe('Path to evaluate'),
    right: z.enum(['read', 'write', 'list']).optional().describe('Right to evaluate'),
    json: z.boolean().optional().describe('Output as JSON'),
  });

  readonly key = 'accessWho';
  readonly cli = { command: 'who', parentKey: 'access' };
  readonly description = 'Show which contexts/agents can access a path for a right';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = AccessWhoCommand.schema;

  constructor(private readonly accessService: AccessService) {}

  async execute(
    payload: Params,
    _ctx: void,
    _runtime: CommandRuntime
  ): Promise<WhoHasPermissionResponse> {
    return this.accessService.whoHasAccess(payload);
  }
}
