// @aspect/collector-shared — shared utilities for all collectors

export { buildPathFilter } from './gitignore-filter.js';
export type { PathFilter } from './gitignore-filter.js';

export {
  SCORE_MATRIX,
  resolveAlias,
  getSymbolKind,
  getSymbolLine,
  classifyReferenceKind,
  isDeclarationIdentifier,
  isBarrelFile,
  getPackageName,
  determineScope,
  collectAllReferencesOnce,
  findAllReferences,
  loadTsconfig,
  findTsconfig,
  buildProgram,
} from './reference-walker.js';
export type { ReferenceKind, ScopeLevel, SymbolReference } from './reference-walker.js';

export {
  DEFAULT_SKIP_DIRS,
  collectDevDeps,
  importsDevDeps,
  getProdSourceFiles,
} from './prod-files.js';
