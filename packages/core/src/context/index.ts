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

import type { ContextRuntime, ReadFileResult } from 'fs-context';
import type { IdeAdapter } from '../types/ide.js';
import type { PermissionConfig } from '../types/agent-models.js';

export interface IIdeAdapterFactory {
  createAsync(workspaceRoot: string, channel: 'cli' | 'web'): Promise<IdeAdapter>;
}

export interface IWorkspaceAccessRuntime {
  createAgentRuntime(
    contextId: string,
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: readonly string[]
  ): Promise<ContextRuntime>;
  analyzeWorkspacePermissionOverlapAsync(
    workspaceRoot: string,
    options?: {
      mode?: 'files' | 'patterns';
      agentId?: string;
      maxDepth?: number;
    }
  ): Promise<unknown>;
}

export interface IWorkspaceFs {
  existsPath(path: string): Promise<boolean>;
  getPathInfo(path: string): Promise<unknown>;
  readFile(
    filePath: string,
    options?: { offset?: number; limit?: number; workspaceRoot?: string }
  ): Promise<ReadFileResult>;
  createFile(
    filePath: string,
    content: string,
    options?: { createDirectories?: boolean }
  ): Promise<{ bytes: number }>;
  writeFile(filePath: string, content: string): Promise<{ bytes: number }>;
  deletePath(path: string, options?: { recursive?: boolean }): Promise<void>;
  createDirectory(path: string, options?: { recursive?: boolean }): Promise<void>;
  getFileTreeWithStats(options?: {
    rootSubPath?: string;
    maxDepth?: number;
    includeHidden?: boolean;
  }): Promise<{ tree: FileTreeNode | null; denied: number }>;
  grepWithStats(
    query: string,
    options?: { caseInsensitive?: boolean }
  ): Promise<{
    matches: Array<{ filePath: string; line: number; lineText: string }>;
    denied: number;
  }>;
  canList(path: string): boolean;
  canRead(path: string): boolean;
  canWrite(path: string): boolean;
  toAbsolutePath(path: string): string;
}

export interface IWorkspaceFsFactory {
  create(agentId: string, permissions: PermissionConfig | undefined): Promise<IWorkspaceFs>;
}

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

export interface FuzzyFileMatch {
  /** Workspace-relative path. */
  path: string;
  /** Similarity score in [0, 1], where 1 is best match. */
  score: number;
}

/**
 * Finds the top N workspace files most similar to a requested path,
 * scoped to only files the agent is allowed to read.
 */
export interface IFuzzyFileSearch {
  /**
   * @param requestedPath  - The path the user tried to read (workspace-relative or absolute).
   * @param permissions    - The agent's permission config.
   * @param allFiles       - Full workspace file list (workspace-relative paths).
   * @param maxResults     - Maximum suggestions to return (default 10).
   */
  findSimilar(
    requestedPath: string,
    permissions: PermissionConfig | undefined,
    allFiles: string[],
    maxResults?: number
  ): string[];

  /**
   * Returns ranked fuzzy matches (best first) with scores.
   *
   * Implementations must only return files the caller is allowed to read.
   */
  findSimilarRanked(
    requestedPath: string,
    permissions: PermissionConfig | undefined,
    allFiles: string[],
    options?: { minScore?: number }
  ): FuzzyFileMatch[];
}
