import type { ISystemService, SystemInfo } from '@ai-team/api-contracts';
import type { ISystemInfoService } from '@ai-team/core';

export class SystemService implements ISystemService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly apiBaseUrl: string,
    private readonly systemInfoService: ISystemInfoService
  ) {}

  async health(): Promise<{ status: 'ok' }> {
    return { status: 'ok' };
  }

  async info(): Promise<SystemInfo> {
    const systemInfo = this.systemInfoService.getSystemInfo(this.workspaceRoot);
    return { apiUrl: this.apiBaseUrl, ...systemInfo };
  }
}
