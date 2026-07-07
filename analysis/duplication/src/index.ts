export {
  calculateDuplication,
  type FileDuplicationResult,
  type ProjectDuplicationResult,
  type CrossModuleDuplication,
  type DuplicationResults,
  type DuplicationOptions,
} from './duplication.js';

export {
  detectFuzzyDuplicatesAsync,
  formatFuzzyDuplicateReport,
  type FuzzyDuplicateOptions,
  type FuzzyDuplicateMatch,
  type FuzzyDuplicateFileResult,
  type FuzzyDuplicateSummary,
  type FuzzyDuplicateReport,
} from './fuzzy-duplication.js';
