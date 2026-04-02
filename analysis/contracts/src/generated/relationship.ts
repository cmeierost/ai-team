/* eslint-disable */
/* This file is auto-generated from JSON Schema. Do not edit manually. */

/**
 * A directed edge between two entities representing a dependency, containment, inheritance, or other structural relationship discovered during analysis.
 */
export interface Relationship {
  /**
   * Identifier of the entity from which this relationship originates.
   */
  sourceEntityId: string;
  /**
   * Identifier of the entity that this relationship points to.
   */
  targetEntityId: string;
  /**
   * The semantic kind of relationship between the two entities.
   */
  kind: 'import' | 'use' | 'call' | 'contain' | 'extend' | 'implement' | 'reference' | 'override' | 're-export';
  sourceRange: SourceRange;
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
