import type {
  ICommand,
  ISystemInfoService,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { SystemInfoResponse } from '@ai-team/api-contracts';
export const SystemInfoCommandMetadata = {
  key: 'info',
  description: 'Display system information about the workspace',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'system',
} satisfies ICommandDescriptor;

export class SystemInfoCommand implements ICommand<Record<string, never>, SystemInfoResponse> {
  readonly metadata = SystemInfoCommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly systemInfoService: ISystemInfoService
  ) {}

  async execute(
    _payload: Record<string, never>,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<SystemInfoResponse>> {
    const data = this.systemInfoService.getSystemInfo(this.workspaceRoot);
    return { status: 'ok', data };
  }
}
