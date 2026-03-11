import type { AccessRule, Right } from './rights.js';

/**
 * An access context — a named set of rules evaluated as one layer.
 */
export interface AccessContext {
  /** Unique identifier for this context. */
  id: string;

  /** Human-readable label (e.g. agent name, role). */
  label?: string;

  /** Ordered list of access rules. */
  rules: AccessRule[];

  /** Paths to ignore files whose patterns become global deny rules. */
  ignoreFiles?: string[];

  /** Arbitrary metadata the caller can attach. */
  metadata?: Record<string, unknown>;
}

/**
 * Per-path evaluation detail inside a verdict.
 */
export interface PathVerdict {
  /** Workspace-relative path that was checked. */
  path: string;

  /** The right that was checked. */
  right: Right;

  /** Whether this specific path+right is allowed. */
  allowed: boolean;

  /** The rule that granted access (if allowed). */
  matchedRule?: AccessRule;

  /** The rule that denied access (if denied). */
  deniedBy?: AccessRule;

  /** Whether denied because of an ignore pattern rather than an explicit rule. */
  deniedByIgnore?: boolean;
}

/**
 * A context that could allow an operation that was denied for the current context.
 */
export interface AlternativeContext {
  contextId: string;
  /** Which of the checked paths this context can handle. */
  allowedPaths: string[];
}

/**
 * Structured result of an access check.
 */
export interface AccessVerdict {
  /** Overall: true only if ALL resolved paths are allowed. */
  allowed: boolean;

  /** Per-path breakdown. */
  paths: PathVerdict[];

  /** Contexts that could allow paths denied for the checked context. */
  alternativeContexts: AlternativeContext[];

  /** Human-readable summary. */
  explanation: string;
}

/**
 * Per-path rights annotation — what each context can do with a path.
 */
export interface PathAnnotation {
  path: string;
  /** Map of contextId → set of rights that context has for this path. */
  contextRights: Map<string, Set<Right>>;
}

/**
 * Result of ranking contexts by their coverage of a file set.
 */
export interface ContextRanking {
  contextId: string;
  coverageCount: number;
  coveredPaths: string[];
}

/**
 * Gap analysis result: what's blocked and who can help.
 */
export interface GapAnalysis {
  /** Paths the checked context cannot access for the requested right. */
  denied: string[];

  /** For each denied path, which contexts could handle it. */
  alternatives: { path: string; contextIds: string[] }[];
}

/**
 * Work distribution assignment.
 */
export interface WorkAssignment {
  contextId: string;
  paths: string[];
}
