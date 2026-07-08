import {
  PermissionError,
  ContextRuntime,
  normalizePath,
  canRead,
  canWrite,
  canList,
  WorkspaceFs,
  WorkspaceCodeEdit,
  WorkspaceSearch,
} from 'fs-context';
import type { AccessPatternSet, PermissionChecker } from 'fs-context';
import type { PermissionConfig } from '@ai-team/core';

export class ContextPermissionService {
  constructor(private readonly workspaceRoot: string) {}

  private toPatternSet(permissions: PermissionConfig | undefined): AccessPatternSet {
    return {
      list: permissions?.list ?? [],
      read: permissions?.read ?? [],
      write: permissions?.write ?? [],
    };
  }

  canReadPath(permissions: PermissionConfig | undefined, filePath: string): boolean {
    return canRead(normalizePath(filePath, this.workspaceRoot), this.toPatternSet(permissions));
  }

  canWritePath(permissions: PermissionConfig | undefined, filePath: string): boolean {
    return canWrite(normalizePath(filePath, this.workspaceRoot), this.toPatternSet(permissions));
  }

  canListPath(permissions: PermissionConfig | undefined, filePath: string): boolean {
    if (permissions?.list === undefined) {
      return this.canReadPath(permissions, filePath);
    }

    return canList(normalizePath(filePath, this.workspaceRoot), this.toPatternSet(permissions));
  }

  assertCanReadPath(
    contextId: string,
    permissions: PermissionConfig | undefined,
    filePath: string
  ): void {
    if (!this.canReadPath(permissions, filePath)) {
      throw new PermissionError(contextId, filePath);
    }
  }

  assertCanWritePath(
    contextId: string,
    permissions: PermissionConfig | undefined,
    filePath: string
  ): void {
    if (!this.canWritePath(permissions, filePath)) {
      throw new PermissionError(contextId, filePath);
    }
  }
}

export class AgentRuntimeFactory {
  constructor(private readonly workspaceRoot: string) {}

  create(
    contextId: string,
    permissions: PermissionConfig | undefined,
    allFiles: readonly string[]
  ): ContextRuntime {
    const normalizedFiles = allFiles.map((f) => normalizePath(f, this.workspaceRoot));
    const runtime = new ContextRuntime();
    runtime.registerFromPatterns(
      contextId,
      {
        list: permissions?.list ?? [],
        read: permissions?.read ?? [],
        write: permissions?.write ?? [],
      },
      normalizedFiles
    );
    return runtime;
  }
}

export class PatternPermissionChecker implements PermissionChecker {
  private readonly permissionService: ContextPermissionService;

  constructor(
    private readonly workspaceRoot: string,
    private readonly permissions: PermissionConfig | undefined
  ) {
    this.permissionService = new ContextPermissionService(workspaceRoot);
  }

  canRead(_contextId: string, filePath: string): boolean {
    return this.permissionService.canReadPath(this.permissions, filePath);
  }

  canWrite(_contextId: string, filePath: string): boolean {
    return this.permissionService.canWritePath(this.permissions, filePath);
  }

  canList(_contextId: string, filePath: string): boolean {
    return this.permissionService.canListPath(this.permissions, filePath);
  }
}

export class WorkspaceAccessFactory {
  constructor(private readonly workspaceRoot: string) {}

  createWorkspaceFs(agentId: string, permissions: PermissionConfig | undefined): WorkspaceFs {
    return new WorkspaceFs(
      this.workspaceRoot,
      agentId,
      new PatternPermissionChecker(this.workspaceRoot, permissions)
    );
  }

  createWorkspaceCodeEdit(
    agentId: string,
    permissions: PermissionConfig | undefined
  ): WorkspaceCodeEdit {
    return new WorkspaceCodeEdit(
      this.workspaceRoot,
      agentId,
      new PatternPermissionChecker(this.workspaceRoot, permissions)
    );
  }

  createWorkspaceSearch(
    agentId: string,
    permissions: PermissionConfig | undefined
  ): WorkspaceSearch {
    return new WorkspaceSearch(
      this.workspaceRoot,
      agentId,
      new PatternPermissionChecker(this.workspaceRoot, permissions)
    );
  }
}
