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
