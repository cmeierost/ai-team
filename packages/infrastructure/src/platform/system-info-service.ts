import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ISystemInfoService, SystemInfo } from '@ai-team/core';

export class SystemInfoService implements ISystemInfoService {
  getSystemInfo(workspaceRoot: string): SystemInfo {
    let branch: string | null = null;
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: workspaceRoot,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim();
    } catch {
      try {
        // `rev-parse HEAD` fails in a newly initialized repository until its
        // first commit. The symbolic ref still contains the unborn branch.
        branch = execSync('git symbolic-ref --short HEAD', {
          cwd: workspaceRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
      } catch {
        // Not a git repo or git unavailable.
      }
    }

    let packageInfo: SystemInfo['package'] = null;
    try {
      const packageJsonPath = join(workspaceRoot, 'package.json');
      if (existsSync(packageJsonPath)) {
        const packageData = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        packageInfo = {
          name: packageData.name || null,
          version: packageData.version || null,
          description: packageData.description || null,
        };
      }
    } catch {
      // package.json missing or invalid.
    }

    return {
      workspace: workspaceRoot,
      branch,
      package: packageInfo,
    };
  }
}
