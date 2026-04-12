// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  Right,
  Effect,
  PermissionChecker,
  PermissionRule,
  PatternToken,
  SectionMap,
  PermFileMeta,
  ParsedPermFile,
  ResolvedContext,
  GlobalContext,
  CheapFileMeta,
  ExpensiveFileMeta,
  CheapMetaCache,
  FileIndex,
  PathToContextsIndex,
  FileRightsByContext,
  FileRightsMatrixRow,
  ContextFileTreeNode,
  ExpensiveMetaCache,
  ContextOverlap,
  FileContextMembership,
  FileListContextComparison,
  ContextMatchRanking,
} from './permission/types.js';
export { ALL_RIGHTS } from './permission/types.js';

// ── Access file (.perm) ───────────────────────────────────────────────────────
export {
  parseAccessFile,
  parseIgnoreStylePatterns,
  scopePatternToBaseDir,
  permissionRulesToPatternSet,
  explicitListPatternsFromRules,
  serializePatternSetToAccessFile,
  canRead,
  canWrite,
  canList,
} from './permission/access-file.js';
export type { AccessPatternSet } from './permission/access-file.js';

// ── Parser (.perm files with YAML frontmatter) ────────────────────────────────
export { parsePermFile } from './permission/parser.js';

// ── Glob engine ───────────────────────────────────────────────────────────────
export { matchesPattern, matchInSet, clearMatcherCache } from './permission/glob-engine.js';

// ── Global context (file index) ───────────────────────────────────────────────
export { buildGlobalContext, createEmptyFileIndex } from './tree/global-context.js';

// ── Resolver ──────────────────────────────────────────────────────────────────
export { resolveContext } from './permission/resolver.js';

// ── Runtime ───────────────────────────────────────────────────────────────────
export { ContextRuntime, PermissionError } from './permission/context-runtime.js';
export type { PermissionDenialInfo } from './permission/context-runtime.js';

// ── Registry ──────────────────────────────────────────────────────────────────
export { ContextRegistry } from './permission/registry.js';

// ── Watcher ───────────────────────────────────────────────────────────────────
export { FileContextWatcher } from './permission/watcher.js';
export type { WatcherOptions } from './permission/watcher.js';

// ── Overlap analysis ──────────────────────────────────────────────────────────
export { analyzeContextOverlap } from './permission/overlap.js';
export { analyzePermOverlap } from './permission/pattern-overlap.js';
export type {
  AgentRuleMap,
  SharedPatternOverlap,
  AgentRightSummary,
  PairwiseAgentOverlap,
  RightOverlapSummary,
  PermissionOverlapReport,
} from './permission/pattern-overlap.js';

// ── Path utilities ────────────────────────────────────────────────────────────
export {
  normalizePath,
  normalizeRelativePosixPath,
  resolveAndNormalize,
  fileName,
  normalizeWorkspaceRelativePath,
  isInsideWorkspaceRoot,
  resolveInsideWorkspace,
  toWorkspaceRelativePath,
} from './paths.js';

// ── Perm file registry ────────────────────────────────────────────────────────
export { PermFileRegistry } from './permission/perm-file-registry.js';

// ── Workspace FS (permission-aware FS accessor) ───────────────────────────────
export { WorkspaceFs } from './workspace-fs.js';

// ── Workspace Code Edit (permission-aware editing facade) ─────────────────────
export { WorkspaceCodeEdit } from './workspace-code-edit.js';
export type {
  FileDiff,
  ParsedHunk,
  PatchType,
  FuzzyMatch,
  FuzzyStage,
  FuzzyReplaceResult,
  UnifiedDiffOptions,
  StructuredDiff,
  DiffHunk,
} from './workspace-code-edit.js';

// ── Workspace Search (permission-aware search facade) ─────────────────────────
export { WorkspaceSearch } from './workspace-search.js';
export type { GrepMatch, GrepOptions, RgMatch } from './workspace-search.js';

// ── File system ───────────────────────────────────────────────────────────────
export * from './workspace.js';
export * from './tree/ignore.js';
export * from './tree/file-tree.js';
export * from './tree/file-tree-cache.js';
export * from './tools/tool-contracts.js';
export * from './fs/file-time.js';
export * from './fs/file-read.js';
export * from './fs/file-ops.js';
export * from './search/ripgrep.js';
export * from './edit/patch.js';
export * from './edit/fuzzy-replace.js';
export * from './edit/diff-gen.js';
export * from './tools/truncation.js';
export * from './search/grep-search.js';
export * from './fs/file-events.js';
export * from './format/which.js';
export * from './format/format.js';
