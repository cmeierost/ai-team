export interface SystemInfo {
  workspace: string;
  branch: string | null;
  package: {
    name: string | null;
    version: string | null;
    description: string | null;
  } | null;
}

/**
 * Infrastructure-facing developer identity service.
 * Implementations can read from git config or other host identity sources.
 */
export interface IDeveloperIdentityService {
  getUserName(): string | undefined;
  getUserEmail(): string | undefined;
  toDeveloperId(name: string): string;
}

/**
 * Infrastructure-facing system information service.
 * Implementations can inspect git state and workspace package metadata.
 */
export interface ISystemInfoService {
  getSystemInfo(workspaceRoot: string): SystemInfo;
}
