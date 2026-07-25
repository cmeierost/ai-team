import { z } from 'zod';
import type {
  ICommand,
  ICommandDescriptor,
  ExecutionContext,
  CommandResponse,
  IPermissionStorage,
  IAgentManager,
} from '@ai-team/core';

const setPermissionsParamsSchema = z.object({
  agentId: z.string().min(1).describe('Agent id whose permissions to set.'),
  list: z.array(z.string()).describe('Glob patterns the agent may list (directory enumeration).'),
  read: z.array(z.string()).describe('Glob patterns the agent may read.'),
  write: z.array(z.string()).describe('Glob patterns the agent may write.'),
});

export type SetPermissionsParams = z.infer<typeof setPermissionsParamsSchema>;

export interface SetPermissionsResult {
  agentId: string;
}

export const SetPermissionsCommandMetadata = {
  key: 'set_permissions',
  group: 'access',
  description:
    'Persist list/read/write glob patterns for an agent. Replaces any existing permission set for that agent.',
  availableIn: { tool: true },
  parameters: setPermissionsParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'access'],
} satisfies ICommandDescriptor;

/**
 * `set_permissions` — write an `AgentAccessPatternSet` to permission storage.
 *
 * Thin wrapper over `IPermissionStorage.saveAsync()`. Used by onboarding
 * workflows after `create_agent` to grant the new agent appropriate access.
 */
export class SetPermissionsCommand implements ICommand<SetPermissionsParams, SetPermissionsResult> {
  readonly metadata = SetPermissionsCommandMetadata;

  constructor(
    private readonly permissionStorage: IPermissionStorage,
    private readonly agentManager?: Pick<IAgentManager, 'refreshAsync'>
  ) {}

  async execute(
    params: SetPermissionsParams,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<SetPermissionsResult>> {
    await this.permissionStorage.saveAsync(params.agentId, {
      list: params.list,
      read: params.read,
      write: params.write,
    });
    await this.agentManager?.refreshAsync();
    return { status: 'ok', data: { agentId: params.agentId } };
  }
}
