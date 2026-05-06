import type { IPathPermissionChecker, PermissionConfig } from '@ai-team/core';
import {
  canReadPath,
  canWritePath,
  canListPath,
  assertCanReadPath,
  assertCanWritePath,
} from './index.js';

export class PathPermissionChecker implements IPathPermissionChecker {
  canReadPath(
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    filePath: string
  ): boolean {
    return canReadPath(workspaceRoot, permissions, filePath);
  }

  canWritePath(
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    filePath: string
  ): boolean {
    return canWritePath(workspaceRoot, permissions, filePath);
  }

  canListPath(
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    filePath: string
  ): boolean {
    return canListPath(workspaceRoot, permissions, filePath);
  }

  assertCanReadPath(
    workspaceRoot: string,
    contextId: string,
    permissions: PermissionConfig | undefined,
    filePath: string
  ): void {
    assertCanReadPath(workspaceRoot, contextId, permissions, filePath);
  }

  assertCanWritePath(
    workspaceRoot: string,
    contextId: string,
    permissions: PermissionConfig | undefined,
    filePath: string
  ): void {
    assertCanWritePath(workspaceRoot, contextId, permissions, filePath);
  }
}
