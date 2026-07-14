import type { IPathPermissionChecker, PermissionConfig } from '@ai-team/core';
import { ContextPermissionService } from './permission-services.js';

export class PathPermissionChecker implements IPathPermissionChecker {
  private readonly permissionService: ContextPermissionService;

  constructor(workspaceRoot: string) {
    this.permissionService = new ContextPermissionService(workspaceRoot);
  }

  can(
    right: 'read' | 'write' | 'list',
    permissions: PermissionConfig | undefined,
    filePath: string
  ): boolean {
    switch (right) {
      case 'read':
        return this.canReadPath(permissions, filePath);
      case 'write':
        return this.canWritePath(permissions, filePath);
      case 'list':
        return this.canListPath(permissions, filePath);
    }
  }

  canReadPath(
    permissions: PermissionConfig | undefined,
    filePath: string
  ): boolean {
    return this.permissionService.canReadPath(permissions, filePath);
  }

  canWritePath(
    permissions: PermissionConfig | undefined,
    filePath: string
  ): boolean {
    return this.permissionService.canWritePath(permissions, filePath);
  }

  canListPath(
    permissions: PermissionConfig | undefined,
    filePath: string
  ): boolean {
    return this.permissionService.canListPath(permissions, filePath);
  }

  assertCanReadPath(
    contextId: string,
    permissions: PermissionConfig | undefined,
    filePath: string
  ): void {
    this.permissionService.assertCanReadPath(contextId, permissions, filePath);
  }

  assertCanWritePath(
    contextId: string,
    permissions: PermissionConfig | undefined,
    filePath: string
  ): void {
    this.permissionService.assertCanWritePath(contextId, permissions, filePath);
  }
}
