import type { IPathPermissionChecker, PermissionConfig } from '@ai-team/core';
import {
  canReadPath,
  canWritePath,
  canListPath,
  assertCanReadPath,
  assertCanWritePath,
} from './index.js';

export class PathPermissionChecker implements IPathPermissionChecker {
  constructor(private readonly workspaceRoot: string) {}

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
    return canReadPath(this.workspaceRoot, permissions, filePath);
  }

  canWritePath(
    permissions: PermissionConfig | undefined,
    filePath: string
  ): boolean {
    return canWritePath(this.workspaceRoot, permissions, filePath);
  }

  canListPath(
    permissions: PermissionConfig | undefined,
    filePath: string
  ): boolean {
    return canListPath(this.workspaceRoot, permissions, filePath);
  }

  assertCanReadPath(
    contextId: string,
    permissions: PermissionConfig | undefined,
    filePath: string
  ): void {
    assertCanReadPath(this.workspaceRoot, contextId, permissions, filePath);
  }

  assertCanWritePath(
    contextId: string,
    permissions: PermissionConfig | undefined,
    filePath: string
  ): void {
    assertCanWritePath(this.workspaceRoot, contextId, permissions, filePath);
  }
}
