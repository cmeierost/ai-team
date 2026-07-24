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

export type FsSearchMode = 'names' | 'content';
export interface FsSearchParams {
  query: string;
  mode?: FsSearchMode;
  glob?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  maxResults?: number;
}
export interface FsSearchResult {
  query: string;
  mode: FsSearchMode;
  scope: 'workspace' | 'agent-permissions';
  glob?: string;
  totalMatches: number;
  returnedMatches: number;
  contentHitsKnown: number;
  truncated: boolean;
  results: Array<{
    path: string;
    score: number;
    matchedBy: Array<'name' | 'content'>;
    readable: boolean;
    writable: boolean;
    contentSearched: boolean;
    lines?: number[];
    snippets?: Array<{ line: number; content: string }>;
    size?: number;
    mtime?: string;
    readers?: Array<{ contextId: string; label: string }>;
    writers?: Array<{ contextId: string; label: string }>;
    nextAction?: string;
  }>;
}
