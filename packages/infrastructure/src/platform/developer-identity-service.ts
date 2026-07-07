import type { IDeveloperIdentityService, UserConfig } from '@ai-team/core';

export class DeveloperIdentityService implements IDeveloperIdentityService {
  constructor(private readonly developerProfile: UserConfig['developer']) {}

  getUserName(): string | undefined {
    return this.developerProfile?.name?.trim() || undefined;
  }

  getUserEmail(): string | undefined {
    return this.developerProfile?.email?.trim() || undefined;
  }

  toDeveloperId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
