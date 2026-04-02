// @aspect/collector-typescript — TypeScript/JavaScript code analysis collector

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
