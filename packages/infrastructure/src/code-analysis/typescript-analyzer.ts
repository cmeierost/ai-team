import { parse, AST_NODE_TYPES, TSESTree } from '@typescript-eslint/typescript-estree';
import { readFile } from 'node:fs/promises';
import type { ITypeScriptAnalyzer } from '@ai-team/core';

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
export class TypeScriptAnalyzer implements ITypeScriptAnalyzer<TSESTree.Program> {
  /**
   * Parse a TypeScript file and return the AST
   */
  async parseFile(filePath: string): Promise<TSESTree.Program> {
    const sourceCode = await readFile(filePath, 'utf-8');

    return parse(sourceCode, {
      loc: true,
      range: true,
      comment: true,
      filePath,
    });
  }

  /**
   * Get all functions in a file
   */
  async getFunctions(filePath: string): Promise<FunctionInfo[]> {
    const ast = await this.parseFile(filePath);
    const functions: FunctionInfo[] = [];

    this.visitNode(ast, (node) => {
      if (
        node.type === AST_NODE_TYPES.FunctionDeclaration ||
        node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
        node.type === AST_NODE_TYPES.FunctionExpression
      ) {
        const funcInfo = this.extractFunctionInfo(node);
        if (funcInfo) {
          functions.push(funcInfo);
        }
      }
    });

    return functions;
  }

  /**
   * Get all classes in a file
   */
  async getClasses(filePath: string): Promise<ClassInfo[]> {
    const ast = await this.parseFile(filePath);
    const classes: ClassInfo[] = [];

    this.visitNode(ast, (node) => {
      if (node.type === AST_NODE_TYPES.ClassDeclaration) {
        const classInfo = this.extractClassInfo(node);
        if (classInfo) {
          classes.push(classInfo);
        }
      }
    });

    return classes;
  }

  /**
   * Get all imports in a file
   */
  async getImports(filePath: string): Promise<ImportInfo[]> {
    const ast = await this.parseFile(filePath);
    const imports: ImportInfo[] = [];

    this.visitNode(ast, (node) => {
      if (node.type === AST_NODE_TYPES.ImportDeclaration) {
        imports.push(this.extractImportInfo(node));
      }
    });

    return imports;
  }

  /**
   * Calculate complexity metrics for a function
   */
  calculateComplexity(filePath: string, functionName: string): Promise<ComplexityMetrics | null> {
    return this.getFunctions(filePath).then((functions) => {
      const func = functions.find((f) => f.name === functionName);
      return func ? func.complexity : null;
    });
  }

  /**
   * Find unused imports in a file
   */
  async findUnusedImports(filePath: string): Promise<ImportInfo[]> {
    await this.parseFile(filePath);
    const sourceCode = await readFile(filePath, 'utf-8');

    const imports = await this.getImports(filePath);
    const unusedImports: ImportInfo[] = [];

    for (const importInfo of imports) {
      const hasUnusedIdentifiers = importInfo.imports.some((importedName) => {
        // Simple check: see if the imported name appears anywhere in the code
        // (excluding the import statement itself)
        const regex = new RegExp(String.raw`\b${importedName}\b`, 'g');
        const matches = sourceCode.match(regex) || [];
        // If it appears only once (the import itself), it's unused
        return matches.length <= 1;
      });

      if (hasUnusedIdentifiers) {
        unusedImports.push(importInfo);
      }
    }

    return unusedImports;
  }

  /**
   * Extract function information from an AST node
   */
  private extractFunctionInfo(
    node:
      | TSESTree.FunctionDeclaration
      | TSESTree.ArrowFunctionExpression
      | TSESTree.FunctionExpression
      | TSESTree.TSEmptyBodyFunctionExpression
  ): FunctionInfo | null {
    // Get function name
    let name = 'anonymous';
    if (node.type === AST_NODE_TYPES.FunctionDeclaration && node.id) {
      name = node.id.name;
    }

    // Get location
    const startLine = node.loc?.start.line || 0;
    const endLine = node.loc?.end.line || 0;

    // Get parameters
    const parameters = node.params.map((param) => {
      if (param.type === AST_NODE_TYPES.Identifier) {
        return param.name;
      }
      return 'complex_param';
    });

    // Calculate complexity
    const complexity = this.calculateNodeComplexity(node);

    return {
      name,
      startLine,
      endLine,
      isAsync: node.async || false,
      isExported: false, // Would need parent context to determine
      parameters,
      complexity,
    };
  }

  /**
   * Extract class information from an AST node
   */
  private extractClassInfo(node: TSESTree.ClassDeclaration): ClassInfo | null {
    if (!node.id) {
      return null;
    }

    const methods: FunctionInfo[] = [];
    const properties: string[] = [];

    for (const member of node.body.body) {
      if (member.type === AST_NODE_TYPES.MethodDefinition) {
        if (member.key.type === AST_NODE_TYPES.Identifier && member.value) {
          const funcInfo = this.extractFunctionInfo(member.value);
          if (funcInfo) {
            funcInfo.name = member.key.name;
            methods.push(funcInfo);
          }
        }
      } else if (member.type === AST_NODE_TYPES.PropertyDefinition) {
        if (member.key.type === AST_NODE_TYPES.Identifier) {
          properties.push(member.key.name);
        }
      }
    }

    return {
      name: node.id.name,
      startLine: node.loc?.start.line || 0,
      endLine: node.loc?.end.line || 0,
      isExported: false, // Would need parent context
      isAbstract: node.abstract || false,
      extends:
        node.superClass?.type === AST_NODE_TYPES.Identifier ? node.superClass.name : undefined,
      implements: [],
      methods,
      properties,
    };
  }

  /**
   * Extract import information from an AST node
   */
  private extractImportInfo(node: TSESTree.ImportDeclaration): ImportInfo {
    const imports: string[] = [];

    for (const specifier of node.specifiers) {
      if (specifier.type === AST_NODE_TYPES.ImportSpecifier) {
        const imported = specifier.imported;
        imports.push(imported.type === AST_NODE_TYPES.Identifier ? imported.name : imported.value);
      } else if (specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier) {
        imports.push(specifier.local.name);
      } else if (specifier.type === AST_NODE_TYPES.ImportNamespaceSpecifier) {
        imports.push(specifier.local.name);
      }
    }

    return {
      source: node.source.value,
      imports,
      isTypeOnly: node.importKind === 'type',
      line: node.loc?.start.line || 0,
    };
  }

  /**
   * Calculate cyclomatic complexity and other metrics for a node
   */
  private calculateNodeComplexity(node: TSESTree.Node): ComplexityMetrics {
    let complexity = 1; // Base complexity
    let returnStatements = 0;
    let nestedDepth = 0;

    this.visitNode(node, (n, depth = 0) => {
      if (depth > nestedDepth) {
        nestedDepth = depth;
      }

      // Increment complexity for decision points
      if (
        n.type === AST_NODE_TYPES.IfStatement ||
        n.type === AST_NODE_TYPES.ConditionalExpression ||
        n.type === AST_NODE_TYPES.ForStatement ||
        n.type === AST_NODE_TYPES.ForInStatement ||
        n.type === AST_NODE_TYPES.ForOfStatement ||
        n.type === AST_NODE_TYPES.WhileStatement ||
        n.type === AST_NODE_TYPES.DoWhileStatement ||
        n.type === AST_NODE_TYPES.CatchClause
      ) {
        complexity++;
      }

      // Count logical operators (&&, ||)
      if (n.type === AST_NODE_TYPES.LogicalExpression) {
        complexity++;
      }

      // Count case clauses in switch statements
      if (n.type === AST_NODE_TYPES.SwitchCase && n.test !== null) {
        complexity++;
      }

      // Count return statements
      if (n.type === AST_NODE_TYPES.ReturnStatement) {
        returnStatements++;
      }
    });

    const linesOfCode = node.loc ? node.loc.end.line - node.loc.start.line + 1 : 0;

    return {
      cyclomaticComplexity: complexity,
      linesOfCode,
      parameters:
        'params' in node && Array.isArray(node.params) ? (node.params as any[]).length : 0,
      returnStatements,
      nestedDepth,
    };
  }

  /**
   * Visit all nodes in the AST
   */
  private visitNode(
    node: TSESTree.Node,
    callback: (node: TSESTree.Node, depth?: number) => void,
    depth = 0
  ): void {
    callback(node, depth);

    // Recursively visit children
    for (const key in node) {
      const value = (node as any)[key];

      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item && typeof item === 'object' && item.type) {
              this.visitNode(item, callback, depth + 1);
            }
          }
        } else if (value.type) {
          this.visitNode(value, callback, depth + 1);
        }
      }
    }
  }
}
