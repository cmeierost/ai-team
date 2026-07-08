import path from 'node:path';
import { z } from 'zod';
import {
  resolveInsideWorkspace,
  toWorkspaceRelativePath,
  type FileTreeNode,
  type Right,
} from 'fs-context';
import type { Agent, IPathPermissionChecker, PermissionConfig, WorkspacePathMeta } from '@ai-team/core';

export interface FsPathAccessEnvelope {
  allowed: boolean;
  deniedByIgnore?: boolean;
  blockedByPatterns?: string[];
  explanation: string;
  alternativeContexts: Array<{ contextId: string; allowedPaths: string[] }>;
}

export const accessRightSchema = z.enum(['read', 'write', 'list']);
export type AccessRight = z.infer<typeof accessRightSchema>;

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

export function canListViaContextManager(
  checker: IPathPermissionChecker,
  permissions: PermissionConfig | undefined,
  targetPath: string
): boolean {
  return checker.canListPath(permissions, targetPath);
}

/** Count leaf (file) nodes in a tree. */
export function countTreeLeaves(node: FileTreeNode): number {
  if (!node.children || node.children.length === 0) return 1;
  return node.children.reduce((sum, child) => sum + countTreeLeaves(child), 0);
}

export interface FilterTreeResult {
  tree: FileTreeNode | null;
  /** Number of leaf nodes that were removed by access filtering. */
  denied: number;
}

export function filterTreeByListAccess(
  checker: IPathPermissionChecker,
  permissions: PermissionConfig | undefined,
  node: FileTreeNode
): FilterTreeResult {
  const nodePath = node.relativePath || '.';
  const nodeAllowed = canListViaContextManager(checker, permissions, nodePath);

  // Leaf node (file): return based on direct access only
  if (!node.children || node.children.length === 0) {
    return nodeAllowed ? { tree: node, denied: 0 } : { tree: null, denied: 1 };
  }

  // Directory: recurse into children first
  let totalDenied = 0;
  const filteredChildren: FileTreeNode[] = [];
  for (const child of node.children) {
    const result = filterTreeByListAccess(checker, permissions, child);
    totalDenied += result.denied;
    if (result.tree) filteredChildren.push(result.tree);
  }

  // Keep the directory if it's directly accessible or has accessible descendants
  if (nodeAllowed || filteredChildren.length > 0) {
    return {
      tree: { ...node, children: filteredChildren },
      denied: totalDenied,
    };
  }

  return { tree: null, denied: totalDenied };
}

/**
 * Check access for a file-operation tool against the ContextManager.
 * Returns a access envelope with allowed/denied and explanation.
 */
export function toFsPathAccessEnvelope(
  checker: IPathPermissionChecker,
  agent: Agent | undefined,
  toolName:
    | 'read'
    | 'read_lines'
    | 'write_file'
    | 'create'
    | 'delete_path'
    | 'mkdir'
    | 'exists'
    | 'info'
    | 'list'
    | 'tree'
    | 'search_content'
    | 'search_metadata'
    | 'edit'
    | 'patch'
    | 'multiedit',
  targetPath: string
): FsPathAccessEnvelope {
  if (!agent) {
    return {
      allowed: false,
      explanation: 'No active agent context available.',
      alternativeContexts: [],
    };
  }
  // Determine required right from tool name
  const writingTools = new Set([
    'write_file',
    'create',
    'delete_path',
    'mkdir',
    'edit',
    'patch',
    'multiedit',
  ]);
  const listingTools = new Set([
    'exists',
    'info',
    'list',
    'tree',
    'search_content',
    'search_metadata',
  ]);

  let allowed: boolean;
  let right: string;

  if (writingTools.has(toolName)) {
    allowed = checker.canWritePath(agent.permissions, targetPath);
    right = 'write';
  } else if (listingTools.has(toolName)) {
    allowed = checker.canListPath(agent.permissions, targetPath);
    right = 'list';
  } else {
    allowed = checker.canReadPath(agent.permissions, targetPath);
    right = 'read';
  }

  return {
    allowed,
    explanation: allowed
      ? `Agent '${agent.id}' has ${right} access to '${targetPath}'.`
      : `Agent '${agent.id}' does not have ${right} access to '${targetPath}'.`,
    alternativeContexts: allowed ? [] : getAlternativeContexts(agent, targetPath, right as Right),
  };
}

/**
 * When access is denied, suggest alternatives.
 * Currently returns an empty list — full runtime context lookup is not available here.
 */
function getAlternativeContexts(
  _agent: Agent,
  _targetPath: string,
  _right: Right
): Array<{ contextId: string; allowedPaths: string[] }> {
  return [];
}

export function resolveFsAbsolutePath(workspaceRoot: string, targetPath: string): string | null {
  return resolveInsideWorkspace(workspaceRoot, targetPath);
}

export function toFsPathMeta(
  workspaceRoot: string,
  inputPath: string,
  absolutePath: string
): {
  input: string;
  absolute: string;
  relative: string;
} {
  const relativePath = toWorkspaceRelativePath(workspaceRoot, absolutePath) ?? '';
  return {
    input: inputPath,
    absolute: absolutePath,
    relative: relativePath,
  };
}

export function toAccessPathPayload(inputPath: string, pathMeta: WorkspacePathMeta): {
  input: string;
  absolute: string;
  relative: string;
} {
  return {
    input: inputPath,
    absolute: pathMeta.absolute,
    relative: pathMeta.relative,
  };
}

export function getAccessRightsForPath(
  checker: IPathPermissionChecker,
  permissions: PermissionConfig | undefined,
  relativePath: string
): AccessRight[] {
  const rights: AccessRight[] = [];
  if (checker.canReadPath(permissions, relativePath)) rights.push('read');
  if (checker.canWritePath(permissions, relativePath)) rights.push('write');
  if (checker.canListPath(permissions, relativePath)) rights.push('list');
  return rights;
}

export function findAgentsWithPathRight(
  agents: Agent[],
  checker: IPathPermissionChecker,
  relativePath: string,
  right: AccessRight
): Agent[] {
  return agents.filter((agent) => {
    if (right === 'read') return checker.canReadPath(agent.permissions, relativePath);
    if (right === 'write') return checker.canWritePath(agent.permissions, relativePath);
    return checker.canListPath(agent.permissions, relativePath);
  });
}
