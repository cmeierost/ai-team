import path from 'node:path';
import type { PermissionConfig } from '../types/agent-models.js';
import type { IPathPermissionChecker } from '../types/runtime-contracts.js';
import type { Right } from '../types/rights.js';

export interface WorkspacePathMeta {
  insideWorkspace: boolean;
  absolute: string;
  relative: string;
}

export function resolveWorkspacePathMeta(
  workspaceRoot: string,
  inputPath: string
): WorkspacePathMeta {
  const absolute = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(workspaceRoot, inputPath);

  const relative = path.relative(workspaceRoot, absolute).replaceAll('\\', '/');
  const insideWorkspace =
    relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));

  return {
    insideWorkspace,
    absolute,
    relative,
  };
}

export function checkPathRight(
  pathPermissionChecker: IPathPermissionChecker,
  permissions: PermissionConfig | undefined,
  relativePath: string,
  right: Right
): boolean {
  return pathPermissionChecker.can(right, permissions, relativePath);
}