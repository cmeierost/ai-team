import { getCachedFileTree } from 'fs-context';
import type { FileTreeNode, GetFileTreeOptions, IFileTreeService } from '@ai-team/core';

export class FileTreeServiceImpl implements IFileTreeService {
  getCachedFileTree(workspaceRoot: string, options?: GetFileTreeOptions): Promise<FileTreeNode> {
    return getCachedFileTree(workspaceRoot, options ?? {});
  }
}
