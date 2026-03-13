import path from 'node:path';
import { z } from 'zod';
import type { ToolContext } from '../types/index.js';
import type { FileTreeNode } from '@ai-team/fs';

export interface FsPathAccessEnvelope {
  allowed: boolean;
  deniedByIgnore?: boolean;
  blockedByPatterns?: string[];
  explanation: string;
  alternativeContexts: Array<{ contextId: string; allowedPaths: string[] }>;
}

export const accessRightSchema = z.enum(['read', 'write', 'create', 'delete', 'list']);
export type AccessRight = z.infer<typeof accessRightSchema>;

export function getAccessEngineOrDeny(context: ToolContext): { ok: true } | { ok: false; reason: string } {
  if (context.accessEngine) return { ok: true };
  return {
    ok: false,
    reason: 'AccessEngine is required for fs_* tools so all access patterns are evaluated by @ai-team/access.',
  };
}

export function canListViaAccessEngine(context: ToolContext, targetPath: string): boolean {
  if (!context.accessEngine) return false;
  return context.accessEngine.checkPath(
    targetPath,
    'list',
    context.workspaceRoot,
    context.agent.id,
  ).allowed;
}

export function filterTreeByListAccess(context: ToolContext, node: FileTreeNode): FileTreeNode | null {
  const nodePath = node.relativePath || '.';
  if (!canListViaAccessEngine(context, nodePath)) {
    return null;
  }

  if (!node.children || node.children.length === 0) {
    return node;
  }

  const filteredChildren = node.children
    .map((child) => filterTreeByListAccess(context, child))
    .filter((child): child is FileTreeNode => child !== null);

  return {
    ...node,
    children: filteredChildren,
  };
}

export function toFsPathAccessEnvelope(
  context: ToolContext,
  toolName:
    | 'fs_read'
    | 'fs_read_lines'
    | 'fs_write_file'
    | 'fs_create'
    | 'fs_delete_path'
    | 'fs_mkdir'
    | 'fs_exists'
    | 'fs_info'
    | 'fs_list'
    | 'fs_tree'
    | 'fs_search_content'
    | 'fs_search_metadata',
  targetPath: string,
): FsPathAccessEnvelope {
  if (!context.accessEngine) {
    return {
      allowed: false,
      explanation: 'AccessEngine is required for fs_* tools so all access patterns are evaluated by @ai-team/access.',
      alternativeContexts: [],
    };
  }

  const args =
    toolName === 'fs_read'
    || toolName === 'fs_read_lines'
    || toolName === 'fs_write_file'
    || toolName === 'fs_create'
      ? { filePath: targetPath }
      : { path: targetPath };

  const verdict = context.accessEngine.checkToolCall(toolName, args, context.workspaceRoot, context.agent.id);

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
  const absolutePath = path.isAbsolute(targetPath)
    ? targetPath
    : path.join(context.workspaceRoot, targetPath);

  const normalizedWorkspace = path.resolve(context.workspaceRoot);
  const normalizedAbsolute = path.resolve(absolutePath);

  if (normalizedAbsolute === normalizedWorkspace || normalizedAbsolute.startsWith(`${normalizedWorkspace}${path.sep}`)) {
    return normalizedAbsolute;
  }

  return null;
}

export function toFsPathMeta(context: ToolContext, inputPath: string, absolutePath: string): {
  input: string;
  absolute: string;
  relative: string;
} {
  const relativePath = path.relative(context.workspaceRoot, absolutePath).replaceAll('\\', '/');
  return {
    input: inputPath,
    absolute: absolutePath,
    relative: relativePath,
  };
}
