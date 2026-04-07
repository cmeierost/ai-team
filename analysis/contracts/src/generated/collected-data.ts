/* eslint-disable */
/* This file is auto-generated from JSON Schema. Do not edit manually. */

/**
 * Technology-agnostic raw facts collected from source code analysis. This is the intermediate representation that collectors produce and the calculation engine consumes.
 */
export interface CollectedCodeData {
  /**
   * Schema version for forward compatibility.
   */
  schemaVersion: '1.0';
  /**
   * ISO 8601 timestamp of when collection was performed.
   */
  collectedAt: string;
  /**
   * Metadata about the collector that produced this data.
   */
  collector: {
    /**
     * Collector identifier (e.g. '@aspect/collector-typescript').
     */
    id: string;
    /**
     * Collector version.
     */
    version: string;
    /**
     * Primary language this collector targets (e.g. 'typescript', 'csharp').
     */
    language: string;
    /**
     * List of tools used by this collector (e.g. ['dependency-cruiser', 'jscpd', 'eslint']).
     */
    tools: string[];
  };
  /**
   * All code entities discovered during collection.
   */
  entities: Entity[];
  /**
   * All relationships (edges) between entities.
   */
  relationships: Relationship[];
  /**
   * Module boundary definitions for architectural analysis.
   */
  moduleBoundaries: ModuleBoundary[];
  /**
   * Inventory of all files in the analysed scope, including non-code files. Every file gets an entry with category and size metadata.
   */
  fileInventory: FileInventoryEntry[];
  /**
   * Duplication detection results. Each entry comes from one tool run.
   */
  duplicationSignals?: DuplicationSignal[];
  /**
   * Code coverage data. Each entry comes from one coverage format/tool.
   */
  coverageSignals?: CoverageSignal[];
  /**
   * Lint/static analysis signals. Each entry comes from one linting tool run.
   */
  lintSignals?: LintSignal[];
  provenance: Provenance;
}
/**
 * A code construct discovered during static analysis. Entities range from files and modules down to individual functions and fields. Each entity carries raw metric counts that downstream analysers use to compute derived scores.
 */
export interface Entity {
  /**
   * Stable deterministic identifier for this entity, derived from canonical structural identity (file path, kind, qualified path, signature shape when applicable, and source range).
   */
  id: string;
  /**
   * The syntactic category of the code construct.
   */
  kind:
    | 'file'
    | 'module'
    | 'package'
    | 'class'
    | 'interface'
    | 'type-alias'
    | 'function'
    | 'method'
    | 'field'
    | 'property'
    | 'namespace'
    | 'enum';
  /**
   * Simple (unqualified) name of the entity as it appears in source code.
   */
  name: string;
  /**
   * Repository-relative path to the file containing this entity.
   */
  filePath: string;
  sourceRange: SourceRange;
  /**
   * Structural role of this entity in the codebase. Assigned by the adapter or derived from classification signals during analysis. Used for classification-aware coupling and clustering.
   */
  role?: 'logic' | 'contract' | 'presentation' | 'infrastructure' | 'entry_point' | 'barrel' | 'unknown';
  /**
   * Identifier of the entity that lexically contains this one (e.g. the class containing a method). Null for top-level entities.
   */
  parentEntityId?: string | null;
  /**
   * Identifiers of entities lexically contained within this one (e.g. methods within a class). Empty for leaf entities.
   */
  childEntityIds: string[];
  /**
   * Depth in the containment hierarchy. 0 = top-level (file/module), 1 = direct child, etc.
   */
  entityDepth: number;
  /**
   * Position in the containment hierarchy: 'root' = top-level entity, 'container' = has children, 'member' = leaf child.
   */
  hierarchyKind: 'root' | 'container' | 'member';
  classification: Classification;
  /**
   * Tokens extracted by splitting the entity name on camelCase / snake_case boundaries (e.g. 'calculateTotalPrice' → ['calculate', 'total', 'price']). Used for semantic cohesion analysis.
   */
  nameTokens?: string[];
  rawCounts?: RawCounts;
  /**
   * For class entities: a matrix recording which fields each method accesses. Used to compute Lack of Cohesion in Methods (LCOM). Null for non-class entities.
   */
  methodFieldAccessMatrix?: MethodFieldAccess[] | null;
}
/**
 * Source location spanning the full extent of this entity.
 */
export interface SourceRange {
  /**
   * 1-based line number where the range begins.
   */
  startLine: number;
  /**
   * 0-based column offset where the range begins.
   */
  startColumn: number;
  /**
   * 1-based line number where the range ends.
   */
  endLine: number;
  /**
   * 0-based column offset where the range ends.
   */
  endColumn: number;
}
/**
 * Semantic classification flags that describe how the entity participates in the type system and module graph.
 */
export interface Classification {
  /**
   * True if the entity is declared abstract (abstract class, abstract method).
   */
  isAbstract: boolean;
  /**
   * True if the entity is an interface declaration.
   */
  isInterface: boolean;
  /**
   * True if the entity is a concrete (non-abstract, non-interface) construct.
   */
  isConcrete: boolean;
  /**
   * True if the entity has no runtime existence — e.g. a TypeScript interface or type alias.
   */
  isTypeOnly: boolean;
  /**
   * True if the entity is exported from its containing module.
   */
  isExported: boolean;
  /**
   * Access modifier of the entity. Null when the language has no explicit visibility modifier.
   */
  visibility: ('public' | 'private' | 'protected' | 'internal') | null;
}
/**
 * Raw numeric counts collected from the source code. Each field is nullable — collectors only populate the counts they can compute.
 */
export interface RawCounts {
  /**
   * Total logical lines of code for this entity.
   */
  linesOfCode?: number | null;
  /**
   * Number of blank lines within this entity.
   */
  blankLines?: number | null;
  /**
   * Number of comment lines within this entity.
   */
  commentLines?: number | null;
  /**
   * Number of parameters declared by a function or method.
   */
  parameterCount?: number | null;
  /**
   * Number of return statements in a function or method.
   */
  returnStatements?: number | null;
  /**
   * Count of branching constructs (if, for, while, case, catch, &&, ||) for cyclomatic complexity calculation.
   */
  branchPoints?: number | null;
  /**
   * Per-nesting-level increments for cognitive complexity calculation. Each entry records a nesting depth and its associated complexity increment.
   */
  nestingContributions?: NestingContribution[] | null;
  /**
   * Distinct and total operator counts for Halstead metric calculation.
   */
  operators?: HalsteadCounts | null;
  /**
   * Distinct and total operand counts for Halstead metric calculation.
   */
  operands?: HalsteadCounts | null;
  /**
   * Count of type-checking patterns (instanceof, typeof ===, switch-on-discriminant) for Open/Closed Principle analysis.
   */
  typeCheckingPatterns?: number | null;
  /**
   * Locations where conditional dispatch occurs, used for Open/Closed Principle violation detection.
   */
  conditionalDispatchLocations?: ConditionalDispatchLocation[] | null;
  /**
   * Count of abstract methods, overridable slots, and other extension points for Open/Closed Principle compliance.
   */
  extensionPoints?: number | null;
  /**
   * Number of public methods on a class or interface, for Interface Segregation Principle analysis.
   */
  publicMethodCount?: number | null;
  /**
   * Number of public properties on a class or interface, for Interface Segregation Principle analysis.
   */
  publicPropertyCount?: number | null;
  /**
   * Methods overridden from a parent class, for Liskov Substitution Principle analysis.
   */
  overriddenMethods?: OverriddenMethod[] | null;
  /**
   * Number of JSX/TSX elements (tags) in a function or component. Used to distinguish rendering from logic in UI files.
   */
  jsxElementCount?: number | null;
}
/**
 * A single nesting-level contribution to cognitive complexity.
 */
export interface NestingContribution {
  /**
   * Nesting depth at which this contribution occurs (0 = top level).
   */
  depth: number;
  /**
   * Complexity increment added at this nesting depth.
   */
  increment: number;
}
/**
 * Distinct and total counts for a Halstead operand or operator category.
 */
export interface HalsteadCounts {
  /**
   * Number of unique operators or operands.
   */
  distinct: number;
  /**
   * Total occurrences of operators or operands.
   */
  total: number;
}
/**
 * Records a source location where conditional dispatch (type-checking, switch-on-discriminant) was detected.
 */
export interface ConditionalDispatchLocation {
  /**
   * 1-based line number of the conditional dispatch.
   */
  line: number;
  /**
   * The kind of dispatch detected (e.g. 'instanceof', 'typeof', 'switch-discriminant').
   */
  kind: string;
  /**
   * Number of branches in this dispatch construct.
   */
  branchCount: number;
}
/**
 * Describes a method overridden from a parent class, capturing its signature for LSP analysis.
 */
export interface OverriddenMethod {
  /**
   * Name of the overridden method.
   */
  name: string;
  /**
   * Ordered list of parameter type names as strings.
   */
  paramTypes: string[];
  /**
   * Return type of the overridden method. Null if the return type cannot be determined.
   */
  returnType: string | null;
}
/**
 * Records which instance fields a single method accesses, for Lack of Cohesion in Methods (LCOM) calculation.
 */
export interface MethodFieldAccess {
  /**
   * Name of the method.
   */
  methodName: string;
  /**
   * Names of instance fields accessed by this method.
   */
  accessedFields: string[];
}
/**
 * A directed edge between two entities representing a dependency, containment, inheritance, or other structural relationship discovered during analysis.
 */
export interface Relationship {
  /**
   * Identifier of the entity from which this relationship originates.
   */
  sourceEntityId: string;
  /**
   * Identifier of the entity that this relationship points to. Null when the target cannot be resolved (external or unresolved dependency).
   */
  targetEntityId: string | null;
  /**
   * The semantic kind of relationship between the two entities.
   */
  kind: 'import' | 'use' | 'call' | 'contain' | 'extend' | 'implement' | 'reference' | 'override' | 're-export';
  /**
   * Repository-relative path of the file containing the source entity. Denormalized for efficient lookup without entity join.
   */
  sourceFilePath: string;
  /**
   * Repository-relative path of the file containing the target entity. Null when unresolved.
   */
  targetFilePath?: string | null;
  sourceRange: SourceRange1;
  /**
   * Source location of the target symbol definition. Null when the target is unresolved or external.
   */
  targetRange?: SourceRange2 | null;
  /**
   * How the target was resolved: 'resolved' = fully matched to a known entity, 'proxy' = matched to a file/module but not a specific entity, 'unresolved' = target could not be found.
   */
  resolutionKind: 'resolved' | 'proxy' | 'unresolved';
  /**
   * Semantic classification of the target entity, used for Dependency Inversion Principle analysis.
   */
  targetClassification: 'abstract' | 'interface' | 'concrete' | 'function' | 'type-alias' | 'enum' | 'unknown';
  /**
   * True if the target entity is considered an abstraction (interface, abstract class, type alias). Used for DIP compliance scoring.
   */
  targetIsAbstraction: boolean;
  /**
   * Names of the target's public API members that the source entity actually uses. Null when consumption cannot be determined. Used for Interface Segregation Principle analysis.
   */
  consumedMembers?: string[] | null;
  /**
   * Total number of public API members on the target entity. Null when the count cannot be determined. Used alongside consumedMembers for ISP ratio calculation.
   */
  targetTotalMembers?: number | null;
  /**
   * True if this relationship crosses a module boundary.
   */
  crossModule: boolean;
  /**
   * True if this relationship crosses a package boundary.
   */
  crossPackage: boolean;
  /**
   * True if the target entity belongs to a third-party dependency (not part of the analysed codebase).
   */
  thirdParty: boolean;
  /**
   * True if this relationship exists only at the type level and has no runtime effect (e.g. TypeScript 'import type').
   */
  typeOnly: boolean;
  /**
   * True if this relationship was created via a dynamic import (import()) rather than a static import declaration.
   */
  dynamic: boolean;
}
/**
 * Source location of the statement or expression that creates this relationship.
 */
export interface SourceRange1 {
  /**
   * 1-based line number where the range begins.
   */
  startLine: number;
  /**
   * 0-based column offset where the range begins.
   */
  startColumn: number;
  /**
   * 1-based line number where the range ends.
   */
  endLine: number;
  /**
   * 0-based column offset where the range ends.
   */
  endColumn: number;
}
/**
 * A contiguous range of source code identified by start and end positions. Used to pinpoint where an entity or relationship originates in the source file.
 */
export interface SourceRange2 {
  /**
   * 1-based line number where the range begins.
   */
  startLine: number;
  /**
   * 0-based column offset where the range begins.
   */
  startColumn: number;
  /**
   * 1-based line number where the range ends.
   */
  endLine: number;
  /**
   * 0-based column offset where the range ends.
   */
  endColumn: number;
}
/**
 * Describes a logical module boundary for architectural analysis. Modules group files and can represent packages, layers, or other organisational units.
 */
export interface ModuleBoundary {
  /**
   * Stable unique identifier for this module boundary.
   */
  moduleId: string;
  /**
   * File-system path (relative to the repository root) that defines the module root.
   */
  modulePath: string;
  /**
   * List of file paths (relative to repository root) that belong to this module.
   */
  files: string[];
  /**
   * Numeric layer index when a layered architecture is configured. Lower numbers are lower layers (e.g. 0 = infrastructure, 1 = domain). Null when no layering is declared.
   */
  declaredLayer: number | null;
  /**
   * True if this module boundary corresponds to a discrete distributable package (e.g. an npm package or Maven module).
   */
  isPackage: boolean;
  /**
   * How this boundary was detected. 'package' = from package.json or similar manifest, 'directory' = from folder structure at a given depth, 'facade' = from re-export index files (e.g. index.ts), 'namespace' = from language namespaces, 'manual' = user-supplied.
   */
  kind: 'package' | 'directory' | 'facade' | 'namespace' | 'manual';
  /**
   * Entry points declared in this module's package.json (bin, main, exports). Only present for package-kind boundaries.
   */
  entryPoints?: {
    /**
     * Source file path (relative to repo root) resolved from the manifest entry.
     */
    file: string;
    /**
     * How this entry point was declared.
     */
    kind: 'bin' | 'main' | 'exports' | 'browser';
    /**
     * Optional entry point name (e.g. the bin command name or exports subpath).
     */
    name?: string;
    /**
     * True if this entry point belongs to an app package (CLI, server, extension, web app) rather than a library.
     */
    isAppEntry?: boolean;
  }[];
  /**
   * True if this package is an application (has bin, start script, vscode engine, or is a pure frontend build). False for libraries. Only set for package-kind boundaries.
   */
  isApp?: boolean;
  /**
   * Why this package is classified as an app. Only set when isApp is true.
   */
  appKind?: 'cli' | 'server' | 'extension' | 'web-app';
}
/**
 * Metadata for a single file in the repository. Every file gets an inventory entry regardless of whether it contains analysable code. Non-code files (config, assets, docs) carry category and size but no line-level metrics.
 */
export interface FileInventoryEntry {
  /**
   * Repository-relative path to the file.
   */
  filePath: string;
  /**
   * High-level file category. Adapters map language-specific extensions and paths into these canonical categories.
   */
  fileCategory: 'source_code' | 'style' | 'config' | 'asset' | 'docs' | 'test' | 'generated' | 'other';
  /**
   * True if this file is in a language the current adapter can extract entities from (e.g. TS/TSX/CSS for the TypeScript adapter).
   */
  isAnalyzedLanguage: boolean;
  /**
   * File size in bytes on disk.
   */
  fileSizeBytes: number;
  /**
   * Total number of lines in the file. Null for binary or non-text files.
   */
  totalLines?: number | null;
  /**
   * Number of blank (whitespace-only) lines. Null for non-text files.
   */
  blankLines?: number | null;
  /**
   * Number of lines that are comments or documentation. Null for non-text files or when the adapter cannot identify comments.
   */
  commentLines?: number | null;
  /**
   * Number of lines that contain only import/re-export/export-forwarding statements. Null for non-code files.
   */
  importExportOnlyLines?: number | null;
}
/**
 * Duplication signals from clone-detection tools such as jscpd. Represents a single collection run with detected code clones and summary statistics.
 */
export interface DuplicationSignal {
  /**
   * Metadata about the tool that produced these duplication signals.
   */
  source: {
    /**
     * Name of the duplication-detection tool (e.g. "jscpd").
     */
    tool: string;
    /**
     * Version of the tool that produced the output.
     */
    version: string;
  };
  /**
   * Array of detected code clones.
   */
  clones: Clone[];
  /**
   * Aggregate duplication statistics for the analysed scope.
   */
  statistics: {
    /**
     * Total number of lines in all analysed sources.
     */
    totalLines: number;
    /**
     * Total number of tokens in all analysed sources.
     */
    totalTokens: number;
    /**
     * Total number of source files analysed.
     */
    totalSources: number;
    /**
     * Number of lines involved in at least one clone.
     */
    duplicatedLines: number;
    /**
     * Number of tokens involved in at least one clone.
     */
    duplicatedTokens: number;
  };
}
/**
 * A single detected code clone between two file regions.
 */
export interface Clone {
  /**
   * Unique identifier for this clone entry.
   */
  id: string;
  /**
   * Language or format of the duplicated code (e.g. "javascript", "typescript").
   */
  format: string;
  /**
   * Number of tokens in the duplicated fragment.
   */
  tokenCount: number;
  /**
   * Number of lines in the duplicated fragment.
   */
  lineCount: number;
  /**
   * Actual duplicated code text, if available.
   */
  fragment?: string | null;
  firstFile: FileLocation;
  secondFile: FileLocation1;
}
/**
 * Location of the clone in the first file.
 */
export interface FileLocation {
  /**
   * Path to the source file, relative to the repository root.
   */
  filePath: string;
  /**
   * One-based start line of the region.
   */
  startLine: number;
  /**
   * One-based end line of the region (inclusive).
   */
  endLine: number;
  /**
   * Zero-based start column, if available.
   */
  startColumn?: number | null;
  /**
   * Zero-based end column, if available.
   */
  endColumn?: number | null;
}
/**
 * Location of the clone in the second file.
 */
export interface FileLocation1 {
  /**
   * Path to the source file, relative to the repository root.
   */
  filePath: string;
  /**
   * One-based start line of the region.
   */
  startLine: number;
  /**
   * One-based end line of the region (inclusive).
   */
  endLine: number;
  /**
   * Zero-based start column, if available.
   */
  startColumn?: number | null;
  /**
   * Zero-based end column, if available.
   */
  endColumn?: number | null;
}
/**
 * Code-coverage signals from tools such as LCOV, Istanbul, or Cobertura. Represents per-file line, branch, and function coverage data.
 */
export interface CoverageSignal {
  /**
   * Metadata about the coverage tool and format that produced these signals.
   */
  source: {
    /**
     * Name of the coverage tool (e.g. "istanbul", "llvm-cov").
     */
    tool: string;
    /**
     * Coverage report format used as input.
     */
    format: 'lcov' | 'cobertura' | 'istanbul' | 'clover' | 'other';
    /**
     * Version of the tool that produced the coverage data.
     */
    version: string;
  };
  /**
   * Per-file coverage data.
   */
  files: FileCoverage[];
}
/**
 * Coverage data for a single source file.
 */
export interface FileCoverage {
  /**
   * Path to the source file, relative to the repository root.
   */
  filePath: string;
  /**
   * Number of lines executed at least once.
   */
  linesCovered: number;
  /**
   * Total number of instrumentable lines in the file.
   */
  linesTotal: number;
  /**
   * Number of branches executed at least once, if available.
   */
  branchesCovered?: number | null;
  /**
   * Total number of branches in the file, if available.
   */
  branchesTotal?: number | null;
  /**
   * Per-function execution counts.
   */
  functions?: FunctionCoverage[];
}
/**
 * Execution data for a single function.
 */
export interface FunctionCoverage {
  /**
   * Name of the function as reported by the coverage tool.
   */
  name: string;
  /**
   * One-based line number where the function is defined.
   */
  line: number;
  /**
   * Number of times the function was executed during the test run.
   */
  executionCount: number;
}
/**
 * Lint signals from static-analysis tools such as ESLint, Stylelint, or Biome. Represents a collection of rule violations found in source files.
 */
export interface LintSignal {
  /**
   * Metadata about the lint tool that produced these signals.
   */
  source: {
    /**
     * Name of the lint tool (e.g. "eslint", "biome").
     */
    tool: string;
    /**
     * Version of the lint tool.
     */
    version: string;
    /**
     * Rule set or configuration name used for the run (e.g. "recommended", "custom").
     */
    ruleSet: string;
  };
  /**
   * Array of individual lint violations.
   */
  results: LintResult[];
}
/**
 * A single lint rule violation at a specific location in a source file.
 */
export interface LintResult {
  /**
   * Path to the source file, relative to the repository root.
   */
  filePath: string;
  /**
   * Identifier of the lint rule that was violated (e.g. "no-unused-vars").
   */
  ruleId: string;
  /**
   * Severity level of the violation.
   */
  severity: 'error' | 'warning' | 'info';
  /**
   * Human-readable description of the violation.
   */
  message: string;
  /**
   * One-based line number where the violation starts.
   */
  line: number;
  /**
   * Zero-based column number where the violation starts.
   */
  column: number;
  /**
   * One-based line number where the violation ends, if available.
   */
  endLine?: number | null;
  /**
   * Zero-based column number where the violation ends, if available.
   */
  endColumn?: number | null;
}
/**
 * Metadata about the collection process (timing, tool runs, warnings).
 */
export interface Provenance {
  /**
   * Total wall-clock time for the collection run, in milliseconds.
   */
  collectionDuration: number;
  /**
   * Ordered list of tool invocations that contributed to this collection.
   */
  toolRuns: ToolRun[];
}
/**
 * Record of a single tool invocation during collection.
 */
export interface ToolRun {
  /**
   * Name or identifier of the tool that was executed (e.g. 'ts-morph-collector', 'eslint').
   */
  tool: string;
  /**
   * Semantic version of the tool.
   */
  version: string;
  /**
   * Which analysis aspect this tool served (e.g. 'structure', 'complexity', 'dependencies').
   */
  aspect: string;
  /**
   * Process exit code returned by the tool. 0 indicates success.
   */
  exitCode: number;
  /**
   * Wall-clock time for this tool run, in milliseconds.
   */
  duration: number;
  /**
   * Non-fatal warnings emitted by the tool during execution.
   */
  warnings: string[];
}
