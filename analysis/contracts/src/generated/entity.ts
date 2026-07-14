 
/* This file is auto-generated from JSON Schema. Do not edit manually. */

/**
 * A code construct discovered during static analysis. Entities range from files and modules down to individual functions and fields. Each entity carries raw metric counts that downstream analysers use to compute derived scores.
 */
export interface Entity {
  /**
   * Stable deterministic identifier for this entity, derived from canonical structural identity (file path, kind, qualified path, signature shape when applicable, and source range).
   */
  id: string;
  /**
   * The syntactic category of the code construct. Includes TypeScript/JS, CSS, and Markdown entity kinds.
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
    | 'enum'
    | 'selector-rule'
    | 'custom-property'
    | 'keyframes'
    | 'mixin'
    | 'section';
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
  /**
   * Sum of type-node counts across all parameters of a function/method/constructor. Each type reference, union/intersection member, generic argument, object property, or tuple element adds 1. Null for non-callable entities.
   */
  parameterTypeComplexity?: number | null;
  /**
   * Type-node count of the return/output type annotation. Each type reference, union/intersection member, generic argument, object property, or tuple element adds 1. Null for non-callable entities or when no explicit return type is declared.
   */
  returnTypeComplexity?: number | null;
  /**
   * Composite signature surface score for a single callable entity: parameterCount + parameterTypeComplexity + returnTypeComplexity. For classes: sum across constructor + all public methods. For interfaces: sum across all declared members. Null when not applicable.
   */
  signatureSurface?: number | null;
  /**
   * When a type-alias narrows an imported type via a utility type. Narrowed references carry less coupling weight because the consumer only depends on a subset of the target surface. Null when not a narrowing alias.
   */
  narrowingKind?: ('pick' | 'omit' | 'extract' | 'exclude' | 'partial' | 'required' | 'readonly' | 'record') | null;
  /**
   * For Pick/Omit narrowing: the number of fields selected or excluded. For Pick this is the effective surface consumed from the target type. Null when not applicable or not determinable.
   */
  narrowedFieldCount?: number | null;
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
