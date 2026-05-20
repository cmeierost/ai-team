import type { FileTreeNode } from 'fs-context';
import type { IWorkspaceFs } from '@ai-team/core';

export const FS_TREE_PRE_LLM_PATTERNS: readonly RegExp[] = [
  /\b(call\s+fs_tree)\b/i,
  /\b(file\s*tree|visible\s+file|visible\s+files|readable\s+file|readable\s+files)\b/i,
  /\bwhat\b.*\bfiles\b.*\b(read|write|list)\b/i,
];

export function matchesFsTreePreLlmIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return FS_TREE_PRE_LLM_PATTERNS.some((pattern) => pattern.test(text));
}

interface FsTreeNodeRights {
  l: boolean;
  r: boolean;
  w: boolean;
}

export type FsTreeNodeWithRights = FileTreeNode & {
  rights: FsTreeNodeRights;
  children?: FsTreeNodeWithRights[];
};

export function annotateFsTreeWithRights(
  node: FileTreeNode,
  fs: IWorkspaceFs
): FsTreeNodeWithRights {
  const relPath = node.relativePath === '.' ? '' : node.relativePath;
  const childNodes = node.children?.map((child) => annotateFsTreeWithRights(child, fs));

  const ownRights: FsTreeNodeRights = {
    l: fs.canList(relPath),
    r: fs.canRead(relPath),
    w: fs.canWrite(relPath),
  };

  const rights: FsTreeNodeRights =
    childNodes && childNodes.length > 0
      ? {
          l: ownRights.l || childNodes.some((child) => child.rights.l),
          r: ownRights.r || childNodes.some((child) => child.rights.r),
          w: ownRights.w || childNodes.some((child) => child.rights.w),
        }
      : ownRights;

  return { ...node, rights, children: childNodes };
}
