import { z } from 'zod';
import { resolveInsideWorkspace, toWorkspaceRelativePath, type FileTreeNode, type Right } from 'fs-context';
import type { ToolContext } from '@ai-team/core';
import { canListPath, canReadPath, canWritePath } from '@ai-team/infrastructure';

export interface FsPathAccessEnvelope {
  allowed: boolean;
  deniedByIgnore?: boolean;
  blockedByPatterns?: string[];
  explanation: string;
  alternativeContexts: Array<{ contextId: string; allowedPaths: string[] }>;
}

export const accessRightSchema = z.enum(['read', 'write', 'list']);
export type AccessRight = z.infer<typeof accessRightSchema>;

export function canListViaContextManager(context: ToolContext, targetPath: string): boolean {
  return canListPath(context.workspaceRoot, context.agent.permissions, targetPath);
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

export function filterTreeByListAccess(context: ToolContext, node: FileTreeNode): FilterTreeResult {
  const nodePath = node.relativePath || '.';
  const nodeAllowed = canListViaContextManager(context, nodePath);

  // Leaf node (file): return based on direct access only
  if (!node.children || node.children.length === 0) {
    return nodeAllowed ? { tree: node, denied: 0 } : { tree: null, denied: 1 };
  }

  // Directory: recurse into children first
  let totalDenied = 0;
  const filteredChildren: FileTreeNode[] = [];
  for (const child of node.children) {
    const result = filterTreeByListAccess(context, child);
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
  context: ToolContext,
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
    allowed = canWritePath(context.workspaceRoot, context.agent.permissions, targetPath);
    right = 'write';
  } else if (listingTools.has(toolName)) {
    allowed = canListPath(context.workspaceRoot, context.agent.permissions, targetPath);
    right = 'list';
  } else {
    allowed = canReadPath(context.workspaceRoot, context.agent.permissions, targetPath);
    right = 'read';
  }

  return {
    allowed,
    explanation: allowed
      ? `Agent '${context.agent.id}' has ${right} access to '${targetPath}'.`
      : `Agent '${context.agent.id}' does not have ${right} access to '${targetPath}'.`,
    alternativeContexts: allowed
      ? []
      : getAlternativeContexts(context, targetPath, right as Right),
  };
}

/**
 * When access is denied, suggest alternatives.
 * Currently returns an empty list — full runtime context lookup is not available here.
 */
function getAlternativeContexts(
  _context: ToolContext,
  _targetPath: string,
  _right: Right,
): Array<{ contextId: string; allowedPaths: string[] }> {
  return [];
}

export function resolveFsAbsolutePath(context: ToolContext, targetPath: string): string | null {
  return resolveInsideWorkspace(context.workspaceRoot, targetPath);
}

export function toFsPathMeta(
  context: ToolContext,
  inputPath: string,
  absolutePath: string
): {
  input: string;
  absolute: string;
  relative: string;
} {
  const relativePath = toWorkspaceRelativePath(context.workspaceRoot, absolutePath) ?? '';
  return {
    input: inputPath,
    absolute: absolutePath,
    relative: relativePath,
  };
}
