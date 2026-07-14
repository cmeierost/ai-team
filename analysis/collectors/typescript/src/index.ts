// @aspect/collector-typescript — TypeScript/JavaScript code analysis collector

export { collect } from './orchestrator.js';

export type {
  CollectorOptions,
  CollectionResult,
  CollectionAspect,
} from './orchestrator.js';

export {
  runJscpdAdapter,
  normalizeJscpdOutput,
  normalizePath,
  buildCloneId,
} from './adapters/jscpd.js';

export type {
  JscpdAdapterOptions,
  JscpdResult,
  JscpdToolRun,
  JscpdRawOutput,
  JscpdRawDuplicate,
  JscpdRawFileRef,
  JscpdRawFileLoc,
  JscpdRawStatistics,
  JscpdRawFormatStats,
  DuplicationSignal,
  DuplicationClone,
  DuplicationFileRef,
  DuplicationStatistics,
} from './adapters/jscpd.js';

export {
  runCoverageAdapter,
  parseLcov,
  parseIstanbul,
} from './adapters/coverage.js';

export type {
  CoverageAdapterOptions,
  CoverageResult,
  CoverageToolRun,
  CoverageSignal,
  CoverageSignalSource,
  CoverageFile,
  CoverageFileFunction,
} from './adapters/coverage.js';

export {
  runAstVisitor,
  visitSourceFile,
  normalizePath as normalizeAstPath,
  tokenizeName,
} from './adapters/ast-visitor.js';

export type {
  AstVisitorOptions,
  AstVisitorResult,
  AstVisitorToolRun,
} from './adapters/ast-visitor.js';

export {
  detectModuleBoundaries,
  detectPackageBoundaries,
  detectFacadeBoundaries,
  detectDirectoryBoundaries,
} from './boundary-detector.js';

export type {
  BoundaryDetectionOptions,
  DetectedBoundary,
} from './boundary-detector.js';

export { findOneLineMethodsAsync, findOneLineMethodsInSource } from './one-line-methods.js';
export type {
  OneLineMethodFinding,
  OneLineMethodKind,
  OneLineMethodScanOptions,
} from './one-line-methods.js';

export { buildPathFilter } from '@aspect/collector-shared';
export type { PathFilter } from '@aspect/collector-shared';
