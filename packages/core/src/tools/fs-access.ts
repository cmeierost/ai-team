import { z } from 'zod';
import {
  resolveInsideWorkspace,
  toWorkspaceRelativePath,
  type FileTreeNode,
} from '@ai-team/fs';
import type { ToolContext } from '../types/index.js';

export interface FsPathAccessEnvelope {
  allowed: boolean;
  deniedByIgnore?: boolean;
  blockedByPatterns?: string[];
  explanation: string;
  alternativeContexts: Array<{ contextId: string; allowedPaths: string[] }>;
}

export const accessRightSchema = z.enum(['read', 'write', 'create', 'delete', 'list']);
export type AccessRight = z.infer<typeof accessRightSchema>;

export function getPermissionEngineOrDeny(context: ToolContext): { ok: true } | { ok: false; reason: string } {
  if (context.permissionEngine) return { ok: true };
  return {
    ok: false,
    reason: 'PermissionEngine is required for fs_* tools so all access patterns are evaluated by @ai-team/permission.',
  };
}

export function canListViaPermissionEngine(context: ToolContext, targetPath: string): boolean {
  if (!context.permissionEngine) return false;
  return context.permissionEngine.checkPath(
    targetPath,
    'list',
    context.workspaceRoot,
    context.agent.id,
  ).allowed;
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
  const nodeAllowed = canListViaPermissionEngine(context, nodePath);

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
  targetPath: string,
): FsPathAccessEnvelope {
  if (!context.permissionEngine) {
    return {
      allowed: false,
      explanation: 'PermissionEngine is required for fs_* tools so all access patterns are evaluated by @ai-team/permission.',
      alternativeContexts: [],
    };
  }

  const args =
    toolName === 'read'
    || toolName === 'read_lines'
    || toolName === 'write_file'
    || toolName === 'create'
    || toolName === 'edit'
      ? { filePath: targetPath }
      : { path: targetPath };

  const verdict = context.permissionEngine.checkToolCall(toolName, args, context.workspaceRoot, context.agent.id);

  const blockedByPatterns = Array.from(
    new Set(
      verdict.paths
        .filter((pv) => !pv.allowed && pv.deniedBy?.pathPattern)
        .map((pv) => pv.deniedBy!.pathPattern),
    ),
  );

  return {
    allowed: verdict.allowed,
    deniedByIgnore: verdict.paths.some((pv) => pv.deniedByIgnore === true),
    blockedByPatterns,
    explanation: verdict.explanation,
    alternativeContexts: verdict.alternativeContexts.map((alt) => ({
      contextId: alt.contextId,
      allowedPaths: alt.allowedPaths,
    })),
  };
}

export function resolveFsAbsolutePath(context: ToolContext, targetPath: string): string | null {
  return resolveInsideWorkspace(context.workspaceRoot, targetPath);
}

export function toFsPathMeta(context: ToolContext, inputPath: string, absolutePath: string): {
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
