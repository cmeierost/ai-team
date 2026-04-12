import { parse, AST_NODE_TYPES, TSESTree } from '@typescript-eslint/typescript-estree';
import { readFile } from 'node:fs/promises';

/**
 * Complexity metrics for a function or method
 */
export interface ComplexityMetrics {
  cyclomaticComplexity: number;
  linesOfCode: number;
  parameters: number;
  returnStatements: number;
  nestedDepth: number;
}

/**
 * Information about a TypeScript function
 */
export interface FunctionInfo {
  name: string;
  startLine: number;
  endLine: number;
  isAsync: boolean;
  isExported: boolean;
  parameters: string[];
  returnType?: string;
  complexity: ComplexityMetrics;
}

/**
 * Information about a TypeScript class
 */
export interface ClassInfo {
  name: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  isAbstract: boolean;
  extends?: string;
  implements: string[];
  methods: FunctionInfo[];
  properties: string[];
}

/**
 * Import information
 */
export interface ImportInfo {
  source: string;
  imports: string[];
  isTypeOnly: boolean;
  line: number;
}

/**
 * TypeScript-specific analyzer using @typescript-eslint/typescript-estree
 * Provides richer analysis than generic tree-sitter for TS code
 */
export interface ITypeScriptAnalyzer {
  /**
   * Parse a TypeScript file and return the AST
   */
  parseFile(filePath: string): Promise<TSESTree.Program>;

  /**
   * Get all functions in a file
   */
  getFunctions(filePath: string): Promise<FunctionInfo[]>;

  /**
   * Get all classes in a file
   */
  getClasses(filePath: string): Promise<ClassInfo[]>;

  /**
   * Get all imports in a file
   */
  getImports(filePath: string): Promise<ImportInfo[]>;

  /**
   * Calculate complexity metrics for a function
   */
  calculateComplexity(filePath: string, functionName: string): Promise<ComplexityMetrics | null>;

  /**
   * Find unused imports in a file
   */
  findUnusedImports(filePath: string): Promise<ImportInfo[]>;
}
