// @ai-team/permission — File-path permission rights library

export { PermissionEngine } from './engine.js';
export type { PermissionEngineOptions } from './engine.js';

export type { Right, Effect, ResourceKind, AccessRule } from './rights.js';
export { ALL_RIGHTS } from './rights.js';
export {
  analyzePermOverlap,
} from './overlap.js';
export type {
  AgentRuleMap,
  SharedPatternOverlap,
  AgentRightSummary,
  PairwiseAgentOverlap,
  RightOverlapSummary,
  PermissionOverlapReport,
} from './overlap.js';

export type {
  AccessContext,
  AccessVerdict,
  PathVerdict,
  AlternativeContext,
  PathAnnotation,
  ContextRanking,
  GapAnalysis,
  WorkAssignment,
  ToolContext,
  PermissionDescriptor,
  AgentTool,
} from './types.js';

export {
  CommandRegistry,
  ToolRegistry,
  tokenizeCommand,
  extractPaths,
} from './operations.js';
export type {
  ArgExtractor,
  CommandPathArg,
  CommandDescriptor,
  ToolPathParam,
  ToolDescriptor,
} from './operations.js';

export { ContextRegistry } from './registry.js';
export { CompiledRuleSet, matchesIgnorePatterns } from './policy.js';
export { normalizePath, resolveAndNormalize, fileName } from './paths.js';
export {
  parseAccessFile,
  parseIgnoreStylePatterns,
  scopePatternToBaseDir,
  accessRulesToPatternSet,
  serializePatternSetToAccessFile,
} from './access-file.js';
export type { AccessPatternSet } from './access-file.js';
