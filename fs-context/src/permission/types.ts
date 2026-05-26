export type Right = 'list' | 'read' | 'write';

export const ALL_RIGHTS: readonly Right[] = ['read', 'write', 'list'] as const;

/**
 * Minimal permission-checking contract used by workspace facades
 * (WorkspaceFs, WorkspaceCodeEdit, WorkspaceSearch).
 *
 * Both `ContextRuntime` (pre-resolved O(1) lookups) and lightweight
 * pattern-based adapters can implement this interface.
 */
export interface PermissionChecker {
  canRead(contextId: string, filePath: string): boolean;
  canWrite(contextId: string, filePath: string): boolean;
  canList(contextId: string, filePath: string): boolean;
}

/** allow or deny */
export type Effect = 'allow' | 'deny';

/**
 * A single permission rule.
 *
 * Binds a right to a workspace-relative path pattern with an effect.
 */
export interface PermissionRule {
  /** Which right this rule governs. */
  right: Right;

  /** allow or deny */
  effect: Effect;

  /**
   * Workspace-relative glob pattern for the path.
   * Examples: `src/**`, `docs/*.md`, `**`
   */
  pathPattern: string;

  /** Optional human-readable label for diagnostics. */
  label?: string;
}

export interface PatternToken {
  raw: string;
  kind: 'inherit' | 'allow' | 'deny';
  pattern?: string;
  bypass?: boolean;
}

export type SectionMap = Record<Right, PatternToken[]>;

export interface PermFileMeta {
  id?: string;
  name?: string;
  description?: string;
}

export interface ParsedPermFile {
  meta: PermFileMeta;
  sections: SectionMap;
  baseDir: string;
}

export interface ResolvedContext {
  list: Set<string>;
  read: Set<string>;
  write: Set<string>;
}

export interface GlobalContext {
  files: Set<string>;
}

export interface CheapFileMeta {
  path: string;
  name: string;
  ext: string;
  mtimeMs?: number;
  type: 'file' | 'dir' | 'symlink';
}

export interface ExpensiveFileMeta {
  size?: number;
  mode?: number;
  ino?: number;
  uid?: number;
  gid?: number;
}

export type CheapMetaCache = Map<string, CheapFileMeta>;

export interface FileIndex {
  byPath: CheapMetaCache;
  byDir: Map<string, string[]>;
  byExt: Map<string, string[]>;
  byBaseName: Map<string, string[]>;
}

export interface PathToContextsIndex {
  list: Map<string, Set<string>>;
  read: Map<string, Set<string>>;
  write: Map<string, Set<string>>;
}

export interface FileRightsByContext {
  contextId: string;
  canList: boolean;
  canRead: boolean;
  canWrite: boolean;
}

export interface FileRightsMatrixRow {
  path: string;
  rights: FileRightsByContext[];
}

export interface ContextFileTreeNode {
  path: string;
  name: string;
  type: 'file' | 'dir';
  children?: ContextFileTreeNode[];
  rightsByContext?: FileRightsByContext[];
}

export type ExpensiveMetaCache = Map<string, ExpensiveFileMeta>;

export interface ContextOverlap {
  listOnly: Set<string>;
  readOnly: Set<string>;
  shared: {
    list: Set<string>;
    read: Set<string>;
    write: Set<string>;
  };
}

/** Per-file context membership result. */
export interface FileContextMembership {
  path: string;
  contexts: string[];
}

/** Comparison of a file list against a single context. */
export interface FileListContextComparison {
  contextId: string;
  /** Files from the input list that are inside the context at the given right. */
  covered: Set<string>;
  /** Files from the input list that are NOT in the context at the given right. */
  uncovered: Set<string>;
  /** Files in the context (at the given right) that are NOT in the input list. */
  extra: Set<string>;
  /** Coverage ratio: covered.size / inputFiles.length (0–1). */
  coverage: number;
}

/** Ranked context match result. */
export interface ContextMatchRanking {
  contextId: string;
  /** How many input files this context covers. */
  coveredCount: number;
  /** How many input files this context does NOT cover. */
  uncoveredCount: number;
  /** Coverage ratio (0–1). */
  coverage: number;
  /** Files from the input list not in this context. */
  uncovered: Set<string>;
  /** Files in this context not in the input list. */
  extra: Set<string>;
}
