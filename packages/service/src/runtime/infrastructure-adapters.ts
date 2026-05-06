import type { IdeAdapter, PermissionConfig } from '@ai-team/core';
import type { ContextRuntime } from 'fs-context';

export interface IIdeAdapterFactory {
  createAsync(workspaceRoot: string, channel: 'cli' | 'web'): Promise<IdeAdapter>;
}

export class InfrastructureIdeAdapterFactory implements IIdeAdapterFactory {
  async createAsync(workspaceRoot: string, channel: 'cli' | 'web'): Promise<IdeAdapter> {
    const { createIdeAdapter } = await import('@ai-team/infrastructure');
    return createIdeAdapter(workspaceRoot, channel);
  }
}

export interface IWorkspaceAccessRuntime {
  createAgentRuntime(
    contextId: string,
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: readonly string[]
  ): Promise<ContextRuntime>;
  analyzeWorkspacePermissionOverlapAsync(
    workspaceRoot: string,
    options?: {
      mode?: 'files' | 'patterns';
      agentId?: string;
      maxDepth?: number;
    }
  ): Promise<unknown>;
}

export class InfrastructureWorkspaceAccessRuntime implements IWorkspaceAccessRuntime {
  async createAgentRuntime(
    contextId: string,
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: readonly string[]
  ) {
    const { createAgentRuntime } = await import('@ai-team/infrastructure');
    return createAgentRuntime(contextId, workspaceRoot, permissions, allFiles as string[]);
  }

  async analyzeWorkspacePermissionOverlapAsync(
    workspaceRoot: string,
    options?: {
      mode?: 'files' | 'patterns';
      agentId?: string;
      maxDepth?: number;
    }
  ) {
    const { analyzeWorkspacePermissionOverlap } = await import('@ai-team/infrastructure');
    return analyzeWorkspacePermissionOverlap(workspaceRoot, options);
  }
}
