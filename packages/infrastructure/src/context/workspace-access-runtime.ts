import type {
  IConfigurationStorage,
  FileTypeGroupConfig,
  IWorkspaceAccessRuntime,
  PermissionConfig,
} from '@ai-team/core';
import type { ContextRuntime } from 'fs-context';
import { AgentRuntimeFactory } from './permission-services.js';

export class InfrastructureWorkspaceAccessRuntime implements IWorkspaceAccessRuntime {
  constructor(private readonly configurationStorage?: IConfigurationStorage) {}

  async createAgentRuntime(
    contextId: string,
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: readonly string[]
  ): Promise<ContextRuntime> {
    const runtimeFactory = new AgentRuntimeFactory(workspaceRoot);
    return runtimeFactory.create(contextId, permissions, allFiles);
  }

  async analyzeWorkspacePermissionOverlapAsync(
    workspaceRoot: string,
    options?: {
      mode?: 'files' | 'patterns';
      agentId?: string;
      maxDepth?: number;
    }
  ): Promise<unknown> {
    const { analyzeWorkspacePermissionOverlap } = await import('./perm-overlap.js');
    let fileTypeGroupsFromConfig: Record<string, FileTypeGroupConfig> | undefined;
    try {
      fileTypeGroupsFromConfig = this.configurationStorage?.get('fileTypeGroups') as
        | Record<string, FileTypeGroupConfig>
        | undefined;
    } catch {
      fileTypeGroupsFromConfig = undefined;
    }

    return analyzeWorkspacePermissionOverlap(workspaceRoot, options, fileTypeGroupsFromConfig);
  }
}
