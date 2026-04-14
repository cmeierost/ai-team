import type { AgentFilesResponse, FilePatternsResponse } from '../../types';

export interface FlatFile {
  path: string;
  readable: boolean;
  listable: boolean;
  writable: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: FlatFile;
}

export type FileAccessFilter = 'all' | 'read' | 'list' | 'write';
export type PatternScope = 'agent' | 'global';
export type PatternMode = 'read' | 'write' | 'list';

export interface PatternGroup {
  label: string;
  scope: PatternScope;
  mode: PatternMode;
  values: string[];
  /** True when no explicit pattern is configured and the value shown is the implicit default. */
  isDefault?: boolean;
}

export interface FileTreeViewState {
  data: AgentFilesResponse | null;
  patterns: FilePatternsResponse | null;
  loading: boolean;
  error: string | null;
  pendingPaths: Set<string>;
  pendingPatternKey: string | null;
  patternScope: PatternScope;
  patternMode: PatternMode;
  patternInput: string;
  filter: FileAccessFilter;
  search: string;
}
