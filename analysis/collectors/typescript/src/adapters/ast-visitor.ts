/**
 * @module ast-visitor
 *
 * Custom AST visitor that walks TypeScript source files using the TS compiler
 * API to extract entities with raw metric counts. Unlike the other adapters in
 * this collector (dep-cruiser, jscpd, eslint, coverage) which wrap existing
 * CLI tools, this adapter operates directly on the AST.
 */

import ts from 'typescript';
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import type {
  Entity,
  Classification,
  RawCounts,
  NestingContribution,
  HalsteadCounts,
  ConditionalDispatchLocation,
  OverriddenMethod,
  MethodFieldAccess,
  SourceRange,
} from '@aspect/contracts';

// ── Public option / result types ────────────────────────────────────────────

export interface AstVisitorOptions {
  rootDir: string;
  files: string[];
}

export interface AstVisitorToolRun {
  tool: 'typescript-ast';
  version: string;
  aspect: 'entityExtraction';
  exitCode: number;
  duration: number;
  warnings: string[];
}

export interface AstVisitorResult {
  entities: Entity[];
  toolRun: AstVisitorToolRun;
}

// ── Entry points ────────────────────────────────────────────────────────────

/**
 * Full adapter entry point: creates a TS program, walks every requested file
 * and returns entities with raw counts.
 */
export async function runAstVisitor(
  options: AstVisitorOptions,
): Promise<AstVisitorResult> {
  const start = Date.now();
  const warnings: string[] = [];
  const version = ts.version;

  try {
    const absoluteFiles = options.files.map((f) =>
      path.isAbsolute(f) ? f : path.resolve(options.rootDir, f),
    );

    const program = ts.createProgram(absoluteFiles, {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      allowJs: true,
      noEmit: true,
    });

    const entities: Entity[] = [];

    for (const absPath of absoluteFiles) {
      const sourceFile = program.getSourceFile(absPath);
      if (!sourceFile) {
        warnings.push(`Could not load source file: ${absPath}`);
        continue;
      }
      const relPath = normalizePath(
        path.relative(options.rootDir, absPath),
      );
      entities.push(...visitSourceFile(sourceFile, relPath));
    }

    return {
      entities,
      toolRun: {
        tool: 'typescript-ast',
        version,
        aspect: 'entityExtraction',
        exitCode: 0,
        duration: Date.now() - start,
        warnings,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`AST visitor failed: ${msg}`);
    return {
      entities: [],
      toolRun: {
        tool: 'typescript-ast',
        version,
        aspect: 'entityExtraction',
        exitCode: 1,
        duration: Date.now() - start,
        warnings,
      },
    };
  }
}

/**
 * Pure function: visit a single parsed SourceFile and return all discovered
 * entities. Suitable for unit tests where we parse from a string.
 */
export function visitSourceFile(
  sourceFile: ts.SourceFile,
  filePath: string,
): Entity[] {
  const entities: Entity[] = [];

  // File-level entity
  const fileEntity = buildFileEntity(sourceFile, filePath);
  entities.push(fileEntity);

  // Walk top-level statements
  for (const stmt of sourceFile.statements) {
    collectEntities(stmt, sourceFile, filePath, fileEntity.id, entities, 0);
  }

  return entities;
}

// ── AST walking ─────────────────────────────────────────────────────────────

function collectEntities(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  parentId: string,
  entities: Entity[],
  nestingBase: number,
): void {
  // Class declaration / expression
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    const className = node.name?.text ?? '<anonymous>';
    const id = `class:${filePath}:${className}`;
    const isAbstract = hasModifier(node, ts.SyntaxKind.AbstractKeyword);
    const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);

    const range = getSourceRange(node, sourceFile);
    const classEntity: Entity = {
      id,
      kind: 'class',
      name: className,
      filePath,
      sourceRange: range,
      parentEntityId: parentId,
      classification: {
        isAbstract,
        isInterface: false,
        isConcrete: !isAbstract,
        isTypeOnly: false,
        isExported,
        visibility: null,
      },
      nameTokens: tokenizeName(className),
      rawCounts: buildClassRawCounts(node, sourceFile),
      methodFieldAccessMatrix: buildMethodFieldAccessMatrix(node, sourceFile),
    };
    entities.push(classEntity);

    // Methods and constructor
    for (const member of node.members) {
      if (
        ts.isMethodDeclaration(member) ||
        ts.isConstructorDeclaration(member) ||
        ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member)
      ) {
        const methodName = ts.isConstructorDeclaration(member)
          ? 'constructor'
          : (member.name && ts.isIdentifier(member.name)
              ? member.name.text
              : member.name?.getText(sourceFile) ?? '<computed>');
        const methodId = `method:${filePath}:${className}.${methodName}`;
        const methodRange = getSourceRange(member, sourceFile);
        const vis = getMemberVisibility(member);
        const isMethodAbstract = hasModifier(
          member,
          ts.SyntaxKind.AbstractKeyword,
        );

        entities.push({
          id: methodId,
          kind: 'method',
          name: methodName,
          filePath,
          sourceRange: methodRange,
          parentEntityId: id,
          classification: {
            isAbstract: isMethodAbstract,
            isInterface: false,
            isConcrete: !isMethodAbstract,
            isTypeOnly: false,
            isExported,
            visibility: vis,
          },
          nameTokens: tokenizeName(methodName),
          rawCounts: buildFunctionRawCounts(member, sourceFile),
        });
      }

      // Fields / properties
      if (ts.isPropertyDeclaration(member)) {
        const fieldName =
          member.name && ts.isIdentifier(member.name)
            ? member.name.text
            : member.name?.getText(sourceFile) ?? '<computed>';
        const fieldId = `field:${filePath}:${className}.${fieldName}`;
        const fieldRange = getSourceRange(member, sourceFile);
        const vis = getMemberVisibility(member);

        entities.push({
          id: fieldId,
          kind: 'field',
          name: fieldName,
          filePath,
          sourceRange: fieldRange,
          parentEntityId: id,
          classification: {
            isAbstract: false,
            isInterface: false,
            isConcrete: true,
            isTypeOnly: false,
            isExported,
            visibility: vis,
          },
          nameTokens: tokenizeName(fieldName),
        });
      }
    }

    // Override detection
    const overriddenMethods = detectOverriddenMethods(node, sourceFile);
    if (overriddenMethods.length > 0) {
      classEntity.rawCounts = {
        ...classEntity.rawCounts,
        overriddenMethods,
      };
    }

    return;
  }

  // Interface declaration
  if (ts.isInterfaceDeclaration(node)) {
    const name = node.name.text;
    const id = `interface:${filePath}:${name}`;
    const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
    const range = getSourceRange(node, sourceFile);

    entities.push({
      id,
      kind: 'interface',
      name,
      filePath,
      sourceRange: range,
      parentEntityId: parentId,
      classification: {
        isAbstract: false,
        isInterface: true,
        isConcrete: false,
        isTypeOnly: true,
        isExported,
        visibility: null,
      },
      nameTokens: tokenizeName(name),
      rawCounts: buildInterfaceRawCounts(node, sourceFile),
    });
    return;
  }

  // Type alias
  if (ts.isTypeAliasDeclaration(node)) {
    const name = node.name.text;
    const id = `type:${filePath}:${name}`;
    const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
    const range = getSourceRange(node, sourceFile);

    entities.push({
      id,
      kind: 'type-alias',
      name,
      filePath,
      sourceRange: range,
      parentEntityId: parentId,
      classification: {
        isAbstract: false,
        isInterface: false,
        isConcrete: false,
        isTypeOnly: true,
        isExported,
        visibility: null,
      },
      nameTokens: tokenizeName(name),
    });
    return;
  }

  // Enum declaration
  if (ts.isEnumDeclaration(node)) {
    const name = node.name.text;
    const id = `enum:${filePath}:${name}`;
    const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
    const range = getSourceRange(node, sourceFile);

    entities.push({
      id,
      kind: 'enum',
      name,
      filePath,
      sourceRange: range,
      parentEntityId: parentId,
      classification: {
        isAbstract: false,
        isInterface: false,
        isConcrete: true,
        isTypeOnly: false,
        isExported,
        visibility: null,
      },
      nameTokens: tokenizeName(name),
      rawCounts: {
        linesOfCode: countLines(range),
      },
    });
    return;
  }

  // Function declaration
  if (ts.isFunctionDeclaration(node) && node.name) {
    const name = node.name.text;
    const id = `function:${filePath}:${name}`;
    const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
    const range = getSourceRange(node, sourceFile);

    entities.push({
      id,
      kind: 'function',
      name,
      filePath,
      sourceRange: range,
      parentEntityId: parentId,
      classification: {
        isAbstract: false,
        isInterface: false,
        isConcrete: true,
        isTypeOnly: false,
        isExported,
        visibility: null,
      },
      nameTokens: tokenizeName(name),
      rawCounts: buildFunctionRawCounts(node, sourceFile),
    });
    return;
  }

  // Variable statement with arrow / function expression (top-level exports)
  if (ts.isVariableStatement(node)) {
    const isExported = hasModifier(node, ts.SyntaxKind.ExportKeyword);
    for (const decl of node.declarationList.declarations) {
      if (
        decl.initializer &&
        (ts.isArrowFunction(decl.initializer) ||
          ts.isFunctionExpression(decl.initializer)) &&
        ts.isIdentifier(decl.name)
      ) {
        const name = decl.name.text;
        const id = `function:${filePath}:${name}`;
        const range = getSourceRange(decl, sourceFile);

        entities.push({
          id,
          kind: 'function',
          name,
          filePath,
          sourceRange: range,
          parentEntityId: parentId,
          classification: {
            isAbstract: false,
            isInterface: false,
            isConcrete: true,
            isTypeOnly: false,
            isExported,
            visibility: null,
          },
          nameTokens: tokenizeName(name),
          rawCounts: buildFunctionRawCounts(decl.initializer, sourceFile),
        });
      }
    }
    return;
  }

  // Export default function / class
  if (ts.isExportAssignment(node)) return;
}

// ── File entity ─────────────────────────────────────────────────────────────

function buildFileEntity(
  sourceFile: ts.SourceFile,
  filePath: string,
): Entity {
  const lineCount =
    sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1;
  return {
    id: `file:${filePath}`,
    kind: 'file',
    name: path.basename(filePath),
    filePath,
    sourceRange: {
      startLine: 1,
      startColumn: 0,
      endLine: lineCount,
      endColumn: 0,
    },
    parentEntityId: null,
    classification: {
      isAbstract: false,
      isInterface: false,
      isConcrete: true,
      isTypeOnly: false,
      isExported: false,
      visibility: null,
    },
    nameTokens: tokenizeFileName(filePath),
    rawCounts: {
      linesOfCode: lineCount,
    },
  };
}

// ── Raw counts builders ─────────────────────────────────────────────────────

function buildFunctionRawCounts(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): RawCounts {
  const range = getSourceRange(node, sourceFile);
  const linesOfCode = countLines(range);

  let branchPoints = 0;
  const nestingContributions: NestingContribution[] = [];
  let typeCheckingPatterns = 0;
  const conditionalDispatchLocations: ConditionalDispatchLocation[] = [];
  let returnStatements = 0;
  let jsxElementCount = 0;
  let parameterCount = 0;

  // Count parameters
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    parameterCount = (node as ts.FunctionLikeDeclaration).parameters.length;
  }

  // Halstead tracking
  const operatorSet = new Set<string>();
  let operatorTotal = 0;
  const operandSet = new Set<string>();
  let operandTotal = 0;

  function walkForCounts(n: ts.Node, depth: number): void {
    // Branch points
    switch (n.kind) {
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
      case ts.SyntaxKind.CatchClause:
      case ts.SyntaxKind.ConditionalExpression:
        branchPoints++;
        nestingContributions.push({ depth, increment: 1 });
        break;
      case ts.SyntaxKind.CaseClause:
        branchPoints++;
        break;
    }

    // Binary expression branch points (&&, ||, ??)
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        branchPoints++;
      }
    }

    // Type checking patterns
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if (op === ts.SyntaxKind.InstanceOfKeyword) {
        typeCheckingPatterns++;
        const line =
          sourceFile.getLineAndCharacterOfPosition(n.getStart(sourceFile))
            .line + 1;
        conditionalDispatchLocations.push({
          line,
          kind: 'instanceof',
          branchCount: 2,
        });
      }
      if (op === ts.SyntaxKind.InKeyword) {
        typeCheckingPatterns++;
        const line =
          sourceFile.getLineAndCharacterOfPosition(n.getStart(sourceFile))
            .line + 1;
        conditionalDispatchLocations.push({
          line,
          kind: 'in',
          branchCount: 2,
        });
      }
    }

    // typeof expressions used in comparisons
    if (ts.isTypeOfExpression(n)) {
      const parent = n.parent;
      if (parent && ts.isBinaryExpression(parent)) {
        typeCheckingPatterns++;
        const line =
          sourceFile.getLineAndCharacterOfPosition(n.getStart(sourceFile))
            .line + 1;
        conditionalDispatchLocations.push({
          line,
          kind: 'typeof',
          branchCount: 2,
        });
      }
    }

    // Type predicate in signatures
    if (
      (ts.isFunctionDeclaration(n) ||
        ts.isMethodDeclaration(n) ||
        ts.isArrowFunction(n)) &&
      n.type &&
      ts.isTypePredicateNode(n.type)
    ) {
      typeCheckingPatterns++;
    }

    // Return statements
    if (ts.isReturnStatement(n)) {
      returnStatements++;
    }

    // JSX element counting
    if (
      ts.isJsxElement(n) ||
      ts.isJsxSelfClosingElement(n) ||
      ts.isJsxFragment(n)
    ) {
      jsxElementCount++;
    }

    // Halstead — operators
    collectHalsteadOperator(n, sourceFile, operatorSet, () => operatorTotal++);
    operatorTotal = collectHalsteadOperatorCount(n, operatorSet, operatorTotal);

    // Halstead — operands
    collectHalsteadOperand(n, operandSet, () => operandTotal++);
    operandTotal = collectHalsteadOperandCount(n, operandSet, operandTotal);

    // Determine next nesting depth
    let nextDepth = depth;
    if (isNestingIncrement(n)) {
      nextDepth = depth + 1;
    }

    ts.forEachChild(n, (child) => walkForCounts(child, nextDepth));
  }

  // Walk the body, not the whole declaration
  const body = getFunctionBody(node);
  if (body) {
    walkForCounts(body, 0);
  }

  const operators: HalsteadCounts = {
    distinct: operatorSet.size,
    total: operatorTotal,
  };
  const operands: HalsteadCounts = {
    distinct: operandSet.size,
    total: operandTotal,
  };

  return {
    linesOfCode,
    parameterCount,
    returnStatements,
    branchPoints,
    nestingContributions:
      nestingContributions.length > 0 ? nestingContributions : null,
    operators,
    operands,
    typeCheckingPatterns,
    conditionalDispatchLocations:
      conditionalDispatchLocations.length > 0
        ? conditionalDispatchLocations
        : null,
    jsxElementCount: jsxElementCount > 0 ? jsxElementCount : null,
  };
}

function buildClassRawCounts(
  node: ts.ClassDeclaration | ts.ClassExpression,
  sourceFile: ts.SourceFile,
): RawCounts {
  const range = getSourceRange(node, sourceFile);
  let publicMethodCount = 0;
  let publicPropertyCount = 0;
  let extensionPoints = 0;

  for (const member of node.members) {
    const vis = getMemberVisibility(member);
    const isPublic = vis === 'public' || vis === null;

    if (
      ts.isMethodDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      if (isPublic) publicMethodCount++;
      if (hasModifier(member, ts.SyntaxKind.AbstractKeyword)) {
        extensionPoints++;
      }
      // Parameters that are function types → extension points
      if (ts.isMethodDeclaration(member)) {
        for (const param of member.parameters) {
          if (param.type && isFunctionOrInterfaceType(param.type)) {
            extensionPoints++;
          }
        }
      }
    }

    if (ts.isPropertyDeclaration(member)) {
      if (isPublic) publicPropertyCount++;
    }
  }

  return {
    linesOfCode: countLines(range),
    publicMethodCount,
    publicPropertyCount,
    extensionPoints: extensionPoints > 0 ? extensionPoints : null,
    jsxElementCount: null,
  };
}

function buildInterfaceRawCounts(
  node: ts.InterfaceDeclaration,
  sourceFile: ts.SourceFile,
): RawCounts {
  const range = getSourceRange(node, sourceFile);
  let publicMethodCount = 0;
  let publicPropertyCount = 0;

  for (const member of node.members) {
    if (ts.isMethodSignature(member)) {
      publicMethodCount++;
    } else if (ts.isPropertySignature(member)) {
      publicPropertyCount++;
    }
  }

  return {
    linesOfCode: countLines(range),
    publicMethodCount,
    publicPropertyCount,
    jsxElementCount: null,
  };
}

// ── Method-field access matrix ──────────────────────────────────────────────

function buildMethodFieldAccessMatrix(
  node: ts.ClassDeclaration | ts.ClassExpression,
  sourceFile: ts.SourceFile,
): MethodFieldAccess[] {
  const matrix: MethodFieldAccess[] = [];

  for (const member of node.members) {
    if (
      !ts.isMethodDeclaration(member) &&
      !ts.isConstructorDeclaration(member) &&
      !ts.isGetAccessorDeclaration(member) &&
      !ts.isSetAccessorDeclaration(member)
    ) {
      continue;
    }

    const methodName = ts.isConstructorDeclaration(member)
      ? 'constructor'
      : (member.name && ts.isIdentifier(member.name)
          ? member.name.text
          : member.name?.getText(sourceFile) ?? '<computed>');

    const accessedFields = new Set<string>();

    function walkForFieldAccess(n: ts.Node): void {
      if (
        ts.isPropertyAccessExpression(n) &&
        n.expression.kind === ts.SyntaxKind.ThisKeyword
      ) {
        accessedFields.add(n.name.text);
      }
      ts.forEachChild(n, walkForFieldAccess);
    }

    const body = getFunctionBody(member);
    if (body) {
      walkForFieldAccess(body);
    }

    matrix.push({
      methodName,
      accessedFields: [...accessedFields].sort(),
    });
  }

  return matrix;
}

// ── Override detection ───────────────────────────────────────────────────────

function detectOverriddenMethods(
  node: ts.ClassDeclaration | ts.ClassExpression,
  sourceFile: ts.SourceFile,
): OverriddenMethod[] {
  const result: OverriddenMethod[] = [];

  for (const member of node.members) {
    if (!ts.isMethodDeclaration(member)) continue;

    const hasOverride = hasModifier(member, ts.SyntaxKind.OverrideKeyword);
    if (!hasOverride) continue;

    const name =
      member.name && ts.isIdentifier(member.name)
        ? member.name.text
        : member.name?.getText(sourceFile) ?? '<computed>';

    const paramTypes = member.parameters.map((p) =>
      p.type ? p.type.getText(sourceFile) : 'unknown',
    );

    const returnType = member.type ? member.type.getText(sourceFile) : null;

    result.push({ name, paramTypes, returnType });
  }

  return result;
}

// ── Halstead helpers (simplified) ───────────────────────────────────────────

const OPERATOR_KEYWORDS = new Set([
  ts.SyntaxKind.IfKeyword,
  ts.SyntaxKind.ElseKeyword,
  ts.SyntaxKind.ForKeyword,
  ts.SyntaxKind.WhileKeyword,
  ts.SyntaxKind.DoKeyword,
  ts.SyntaxKind.ReturnKeyword,
  ts.SyntaxKind.SwitchKeyword,
  ts.SyntaxKind.CaseKeyword,
  ts.SyntaxKind.BreakKeyword,
  ts.SyntaxKind.ContinueKeyword,
  ts.SyntaxKind.ThrowKeyword,
  ts.SyntaxKind.TryKeyword,
  ts.SyntaxKind.CatchKeyword,
  ts.SyntaxKind.FinallyKeyword,
  ts.SyntaxKind.NewKeyword,
  ts.SyntaxKind.DeleteKeyword,
  ts.SyntaxKind.TypeOfKeyword,
  ts.SyntaxKind.VoidKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.ConstKeyword,
  ts.SyntaxKind.LetKeyword,
]);

function collectHalsteadOperatorCount(
  n: ts.Node,
  operatorSet: Set<string>,
  total: number,
): number {
  // Binary operators
  if (ts.isBinaryExpression(n)) {
    const opText = ts.tokenToString(n.operatorToken.kind) ?? '?';
    operatorSet.add(opText);
    return total + 1;
  }
  // Prefix/postfix unary
  if (ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) {
    const opText = ts.tokenToString(n.operator) ?? '?';
    operatorSet.add(opText);
    return total + 1;
  }
  // Call expressions
  if (ts.isCallExpression(n)) {
    operatorSet.add('()');
    return total + 1;
  }
  // Property access
  if (ts.isPropertyAccessExpression(n)) {
    operatorSet.add('.');
    return total + 1;
  }
  // Element access
  if (ts.isElementAccessExpression(n)) {
    operatorSet.add('[]');
    return total + 1;
  }
  return total;
}

function collectHalsteadOperator(
  n: ts.Node,
  _sf: ts.SourceFile,
  _set: Set<string>,
  _incr: () => void,
): void {
  // Keywords as operators
  if (ts.isIfStatement(n)) { _set.add('if'); _incr(); }
  if (ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n)) { _set.add('for'); _incr(); }
  if (ts.isWhileStatement(n)) { _set.add('while'); _incr(); }
  if (ts.isDoStatement(n)) { _set.add('do'); _incr(); }
  if (ts.isReturnStatement(n)) { _set.add('return'); _incr(); }
  if (ts.isSwitchStatement(n)) { _set.add('switch'); _incr(); }
  if (ts.isThrowStatement(n)) { _set.add('throw'); _incr(); }
  if (ts.isTryStatement(n)) { _set.add('try'); _incr(); }
}

function collectHalsteadOperandCount(
  n: ts.Node,
  operandSet: Set<string>,
  total: number,
): number {
  if (ts.isIdentifier(n)) {
    operandSet.add(n.text);
    return total + 1;
  }
  if (ts.isStringLiteral(n)) {
    operandSet.add(`"${n.text}"`);
    return total + 1;
  }
  if (ts.isNumericLiteral(n)) {
    operandSet.add(n.text);
    return total + 1;
  }
  if (n.kind === ts.SyntaxKind.TrueKeyword) {
    operandSet.add('true');
    return total + 1;
  }
  if (n.kind === ts.SyntaxKind.FalseKeyword) {
    operandSet.add('false');
    return total + 1;
  }
  if (n.kind === ts.SyntaxKind.NullKeyword) {
    operandSet.add('null');
    return total + 1;
  }
  return total;
}

function collectHalsteadOperand(
  _n: ts.Node,
  _set: Set<string>,
  _incr: () => void,
): void {
  // Main counting done in collectHalsteadOperandCount
}

// ── Utility helpers ─────────────────────────────────────────────────────────

export function normalizePath(filePath: string): string {
  let p = filePath.replace(/\\/g, '/');
  if (p.startsWith('./')) p = p.slice(2);
  return p;
}

function getSourceRange(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): SourceRange {
  const startPos = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  const endPos = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  return {
    startLine: startPos.line + 1,
    startColumn: startPos.character,
    endLine: endPos.line + 1,
    endColumn: endPos.character,
  };
}

function countLines(range: SourceRange): number {
  return range.endLine - range.startLine + 1;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  return modifiers?.some((m) => m.kind === kind) ?? false;
}

function getMemberVisibility(
  member: ts.ClassElement,
): 'public' | 'private' | 'protected' | null {
  if (hasModifier(member, ts.SyntaxKind.PrivateKeyword)) return 'private';
  if (hasModifier(member, ts.SyntaxKind.ProtectedKeyword)) return 'protected';
  if (hasModifier(member, ts.SyntaxKind.PublicKeyword)) return 'public';
  return null;
}

function isNestingIncrement(node: ts.Node): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.SwitchStatement:
    case ts.SyntaxKind.CatchClause:
    case ts.SyntaxKind.ConditionalExpression:
    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.FunctionExpression:
      return true;
    default:
      return false;
  }
}

function getFunctionBody(
  node: ts.Node,
): ts.Block | ts.Expression | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.body;
  }
  if (ts.isArrowFunction(node)) {
    return node.body;
  }
  return undefined;
}

function isFunctionOrInterfaceType(typeNode: ts.TypeNode): boolean {
  return (
    ts.isFunctionTypeNode(typeNode) ||
    ts.isTypeReferenceNode(typeNode) // might be an interface reference
  );
}

/**
 * Tokenize a class/function/method name on camelCase/PascalCase boundaries.
 */
export function tokenizeName(name: string): string[] {
  if (!name || name.startsWith('<')) return [name];

  const parts = name.split(/[-_.]+/);
  const tokens: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    const camelParts = part.split(
      /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/,
    );
    for (const t of camelParts) {
      if (t) tokens.push(t.toLowerCase());
    }
  }

  return tokens;
}

/**
 * Tokenize a file path's basename.
 */
function tokenizeFileName(filePath: string): string[] {
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  return tokenizeName(base);
}
