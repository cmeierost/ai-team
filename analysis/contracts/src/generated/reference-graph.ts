/* eslint-disable */
/* This file is auto-generated from JSON Schema. Do not edit manually. */

/**
 * Symbol-level reference graph produced by the TypeScript reference walker. Captures scored, weighted edges between entities (reference, call, implement, extend, re-export) with scope classification and barrel awareness. Used by the dead-code detector, SOLID calculator, structural pipeline, and LLM priority reader.
 */
export interface ReferenceGraphSignal {
  /**
   * Metadata about the tool that produced the reference graph.
   */
  source: {
    /**
     * Name of the tool that produced the signal.
     */
    tool: 'reference-graph';
    /**
     * Version of the reference-graph adapter.
     */
    version: string;
    /**
     * Repository-relative root directory that was analysed.
     */
    rootDir: string;
    /**
     * Path to the tsconfig.json used to build the TypeScript program.
     */
    tsconfig: string;
    /**
     * Number of production source files included in reference counting.
     */
    prodFileCount?: number;
    /**
     * Number of test files excluded from reference counting.
     */
    testFileCount?: number;
  };
  /**
   * Scored reference edges between entities.
   */
  edges: ReferenceEdge[];
  /**
   * Aggregate counts over all edges.
   */
  summary: {
    totalEdges: number;
    byKind: {
      [k: string]: number | undefined;
    };
    byScope: {
      [k: string]: number | undefined;
    };
    /**
     * Number of edges whose target could not be resolved to a known entity.
     */
    unresolvedCount: number;
  };
}
/**
 * A single scored reference edge from a source entity to a target entity.
 */
export interface ReferenceEdge {
  /**
   * Identifier of the entity that contains the reference.
   */
  sourceEntityId: string;
  /**
   * Identifier of the entity being referenced. Null when the target could not be resolved.
   */
  targetEntityId: string | null;
  /**
   * Semantic kind of the reference.
   */
  kind: 'reference' | 'call' | 'implement' | 'extend' | 're-export';
  /**
   * Scope level of the reference relative to the target's declaration.
   */
  scope:
    | 'same_file'
    | 'same_folder'
    | 'sub_dir_barrel'
    | 'sub_dir_deep'
    | 'parent_barrel'
    | 'sibling_barrel'
    | 'sibling_deep'
    | 'cross_package';
  /**
   * Weighted score for this edge (from SCORE_MATRIX[kind][scope]).
   */
  score: number;
  /**
   * True if the target declaration file is a barrel (index.ts/index.tsx/index.js/index.mjs).
   */
  isBarrel?: boolean;
  sourceRange?: SourceRange;
  /**
   * Source location of the target symbol's declaration. Null when unresolved.
   */
  targetRange?: SourceRange1 | null;
  /**
   * How the target was resolved.
   */
  resolutionKind?: 'resolved' | 'unresolved';
}
/**
 * Source location of the reference.
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
 * A contiguous range of source code identified by start and end positions. Used to pinpoint where an entity or relationship originates in the source file.
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
