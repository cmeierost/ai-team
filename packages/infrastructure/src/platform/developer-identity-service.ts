import * as childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { IConfigurationStorage, IDeveloperIdentityService, UserConfig } from '@ai-team/core';

export class DeveloperIdentityService implements IDeveloperIdentityService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly configurationStorage: IConfigurationStorage
  ) {}

  getUserName(): string | undefined {
    const configuredName = this.readConfiguredDeveloper()?.name?.trim();
    if (configuredName) {
      return configuredName;
    }

    try {
      const gitName =
        childProcess.execSync('git config user.name', {
          cwd: this.workspaceRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim() || undefined;
      if (gitName) {
        this.persistDeveloperFallback({ name: gitName });
      }
      return gitName;
    } catch {
      return undefined;
    }
  }

  getUserEmail(): string | undefined {
    const configuredEmail = this.readConfiguredDeveloper()?.email?.trim();
    if (configuredEmail) {
      return configuredEmail;
    }

    try {
      const gitEmail =
        childProcess.execSync('git config user.email', {
          cwd: this.workspaceRoot,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim() || undefined;
      if (gitEmail) {
        this.persistDeveloperFallback({ email: gitEmail });
      }
      return gitEmail;
    } catch {
      return undefined;
    }
  }

  toDeveloperId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private readConfiguredDeveloper(): UserConfig['developer'] | undefined {
    const userConfigPath = this.configurationStorage.getUserConfigPath(this.workspaceRoot);
    try {
      if (!fs.existsSync(userConfigPath)) {
        return undefined;
      }

      const content = fs.readFileSync(userConfigPath, 'utf-8');
      const parsed = JSON.parse(content) as UserConfig;
      return parsed?.developer;
    } catch {
      return undefined;
    }
  }

  private persistDeveloperFallback(partial: { name?: string; email?: string }): void {
    try {
      const userConfigPath = this.configurationStorage.getUserConfigPath(this.workspaceRoot);
      let current: UserConfig = {};

      if (fs.existsSync(userConfigPath)) {
        try {
          current = JSON.parse(fs.readFileSync(userConfigPath, 'utf-8')) as UserConfig;
        } catch {
          current = {};
        }
      }

      const existingDeveloper = current.developer ?? {};
      const mergedDeveloper = {
        ...existingDeveloper,
        ...partial,
      };

      if (!mergedDeveloper.id && mergedDeveloper.name) {
        mergedDeveloper.id = this.toDeveloperId(mergedDeveloper.name);
      }

      const next: UserConfig = {
        ...current,
        developer: mergedDeveloper,
      };

      fs.mkdirSync(path.dirname(userConfigPath), { recursive: true });
      fs.writeFileSync(userConfigPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    } catch {
      // Best-effort persistence only. Identity resolution should not fail hard.
    }
  }
}
