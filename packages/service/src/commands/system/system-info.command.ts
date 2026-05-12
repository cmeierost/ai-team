import type {
  ICommand,
  ISystemInfoService,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import type { SystemInfoResponse } from '@ai-team/api-contracts';

export class SystemInfoCommand implements ICommand<Record<string, never>, SystemInfoResponse> {
  readonly key = 'systemInfo';
  readonly cli = { command: 'sysinfo' };
  readonly aliases = ['sys'];
  readonly description = 'Display system information about the workspace';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'system';

  constructor(private readonly systemInfoService: ISystemInfoService) {}

  async execute(
    _payload: Record<string, never>,
    ctx: ExecutionContext
  ): Promise<CommandResponse<SystemInfoResponse>> {
    const data = this.systemInfoService.getSystemInfo(ctx.workspaceRoot);
    return { status: 'ok', data };
  }
}
