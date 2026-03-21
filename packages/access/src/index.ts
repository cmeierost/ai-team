// @ai-team/access — File-path access rights library

export { AccessEngine } from './engine.js';
export type { AccessEngineOptions } from './engine.js';

export type { Right, Effect, ResourceKind, AccessRule } from './rights.js';
export { ALL_RIGHTS } from './rights.js';

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
