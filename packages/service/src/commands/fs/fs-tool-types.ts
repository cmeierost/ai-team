import type { FileTreeNode } from 'fs-context';

export interface FsPathParams {
  path: string;
}
export interface FsExistsResult {
  path: string;
  exists: boolean;
  access?: { allowed: boolean };
  error?: string;
}
export interface FsInfoResult {
  path: string;
  exists: boolean;
  info: unknown;
  access?: { allowed: boolean };
  error?: string;
}

export interface FsReadParams {
  filePath: string;
  offset?: number;
  limit?: number;
}
export type FsReadResult = Record<string, unknown>;

export interface FsReadLinesParams {
  filePath: string;
  startLine: number;
  endLine: number;
}
export type FsReadLinesResult = Record<string, unknown>;

export interface FsCreateParams {
  filePath: string;
  content?: string;
  createDirectories?: boolean;
}
export interface FsCreateResult {
  path: string;
  created: boolean;
  bytes?: number;
  error?: string;
}

export interface FsWriteParams {
  filePath: string;
  content: string;
}
export interface FsWriteResult {
  path: string;
  written: boolean;
  bytes?: number;
  _fileChanges?: unknown[];
  error?: string;
}

export interface FsDeleteParams {
  path: string;
  recursive?: boolean;
}
export interface FsDeleteResult {
  path: string;
  deleted: boolean;
  error?: string;
}

export interface FsMkdirParams {
  path: string;
  recursive?: boolean;
}
export interface FsMkdirResult {
  path: string;
  created: boolean;
  error?: string;
}

export interface FsListParams {
  path?: string;
  includeHidden?: boolean;
}
export interface FsListResult {
  path: string;
  entries: Array<{
    path: string;
    name: string;
    isDirectory: boolean;
    size?: number;
    modified?: string;
  }>;
  denied: number;
  access: { allowed: boolean; explanation?: string };
}

export interface FsTreeParams {
  path?: string;
  maxDepth?: number;
  includeHidden?: boolean;
}
export interface FsTreeResult {
  path: string;
  tree: FileTreeNode | null;
  denied: number;
  access: { allowed: boolean; explanation?: string };
}

export interface FsSearchContentParams {
  path?: string;
  query: string;
  maxResults?: number;
  caseSensitive?: boolean;
}
export interface FsSearchContentResult {
  path: string;
  query: string;
  matches: Array<{ path: string; line: number; content: string }>;
  denied: number;
  access: { allowed: boolean; explanation?: string };
}

export interface FsSearchMetadataParams {
  pattern: string;
  path?: string;
  maxResults?: number;
}
export interface FsSearchMetadataResult {
  pattern: string;
  path: string;
  matches: Array<{ path: string; size: number; mtime: string }>;
  numMatches: number;
  truncated: boolean;
  denied: number;
  access: { allowed: boolean; explanation?: string };
}
