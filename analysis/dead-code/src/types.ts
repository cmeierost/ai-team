/**
 * @module dead-code/types
 *
 * Type definitions for the dead-code detector.
 */

import type { Entity, Relationship } from '@aspect/contracts';

/** A single dead-code finding. */
export interface DeadCodeFinding {
  /** Entity ID of the dead symbol. */
  entityId: string;
  /** Entity kind (class, interface, function, etc.). */
  kind: string;
  /** Symbol name. */
  name: string;
  /** File path where the symbol is declared. */
  filePath: string;
  /** Line number of the declaration. */
  line: number;
  /** Reason this symbol is considered dead. */
  reason: DeadCodeReason;
  /** Confidence score (0-1). Higher = more certain. */
  confidence: number;
  /** Whether this symbol is exported. */
  isExported: boolean;
  /** Whether this symbol is part of a public API (cross-package reference). */
  isPublicApi: boolean;
  /** Suggested action. */
  suggestion: 'delete' | 'review' | 'keep';
}

/** Reasons a symbol can be considered dead. */
export type DeadCodeReason =
  | 'no-references'
  | 'unused-class'
  | 'unused-interface'
  | 'unused-method'
  | 'unused-property'
  | 'unused-export'
  | 'unreachable-method'
  | 'shadowed-by-re-export';

/** Full dead-code report. */
export interface DeadCodeReport {
  /** Total number of findings. */
  totalFindings: number;
  /** Findings grouped by kind. */
  byKind: Record<string, number>;
  /** Findings grouped by reason. */
  byReason: Record<string, number>;
  /** All findings. */
  findings: DeadCodeFinding[];
  /** Summary statistics. */
  summary: {
    totalEntities: number;
    totalRelationships: number;
    deadEntities: number;
    deadExportedEntities: number;
    deadPublicApiEntities: number;
    deadRatio: number;
  };
}

/** Options for the dead-code detector. */
export interface DeadCodeDetectorOptions {
  /** Minimum confidence to include in the report (0-1). Default: 0.5. */
  minConfidence?: number;
  /** Whether to include findings for exported symbols. Default: true. */
  includeExported?: boolean;
  /** Whether to include findings for public API symbols. Default: false. */
  includePublicApi?: boolean;
  /** Entity kinds to check. Default: ['class', 'interface', 'function', 'type-alias', 'enum']. */
  checkKinds?: string[];
}

/** Input data for the detector. */
export interface DeadCodeInput {
  entities: Entity[];
  relationships: Relationship[];
}