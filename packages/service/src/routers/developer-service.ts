import type { IDeveloperService } from '@ai-team/api-contracts';
import type { IDeveloperIdentityService } from '@ai-team/core';

export class DeveloperService implements IDeveloperService {
  constructor(private readonly developerIdentityService: IDeveloperIdentityService) {}

  async getMe(): Promise<{ id: string; name: string; email?: string }> {
    const name = this.developerIdentityService.getUserName() || 'Developer';
    const email = this.developerIdentityService.getUserEmail();
    const id = this.developerIdentityService.toDeveloperId(name);
    return { id, name, email: email || undefined };
  }
}
