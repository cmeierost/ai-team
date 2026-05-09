import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { SystemInfoResponse } from '@ai-team/api-contracts';
import { getSystemInfo } from '../../utils/system-info.js';

export class SystemInfoCommand implements ICommand<
  Record<string, never>,
  void,
  SystemInfoResponse
> {
  readonly key = 'systemInfo';
  readonly cli = { command: 'sysinfo' };
  readonly aliases = ['sys'];
  readonly description = 'Display system information about the workspace';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'system';

  async execute(
    _payload: Record<string, never>,
    _ctx: void,
    runtime: CommandRuntime
  ): Promise<SystemInfoResponse> {
    return getSystemInfo(runtime.workspaceRoot);
  }
}
