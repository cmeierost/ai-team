/** A file annotated with its read/write permission state for a specific agent */
export interface AnnotatedFile {
  /** Workspace-relative path */
  path: string;
  /** Whether the agent can read this file */
  readable: boolean;
  /** Whether the agent can list/discover this file path */
  listable: boolean;
  /** Whether the agent can write this file */
  writable: boolean;
}

export interface FileTreeNode {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  size?: number;
  modified?: string;
  extension?: string;
  gitignored?: boolean;
}

export interface GetFileTreeOptions {
  maxDepth?: number;
  includeHidden?: boolean;
  ignoreGitignore?: boolean;
  excludeDirs?: string[];
  rootSubPath?: string;
  allowPaths?: string[];
}

import type { PermissionConfig } from '../types/agent-models.js';

export interface IFileTreeService {
  getCachedFileTree(workspaceRoot: string, options?: GetFileTreeOptions): Promise<FileTreeNode>;
}

export interface IFileAnnotationService {
  getAnnotatedFiles(
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: string[]
  ): AnnotatedFile[];
  getWritableFiles(
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: string[]
  ): string[];
  getReadableFiles(
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: string[]
  ): string[];
}
