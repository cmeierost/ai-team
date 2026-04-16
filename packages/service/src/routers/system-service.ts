import type { ISystemService, SystemInfo } from '@ai-team/api-client';
import { getSystemInfo } from '../utils/system-info.js';

export class SystemService implements ISystemService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly apiBaseUrl: string
  ) {}

  async health(): Promise<{ status: 'ok' }> {
    return { status: 'ok' };
  }

  async info(): Promise<SystemInfo> {
    const systemInfo = getSystemInfo(this.workspaceRoot);
    return { apiUrl: this.apiBaseUrl, ...systemInfo };
  }
}
