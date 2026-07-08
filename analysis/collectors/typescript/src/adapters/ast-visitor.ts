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
import type {
  Entity,
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
    collectEntities(stmt, sourceFile, filePath, fileEntity.id, entities);
  }

  finalizeHierarchy(entities);
  return entities;
}

// ── AST walking ─────────────────────────────────────────────────────────────

function collectEntities(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  filePath: string,
  parentId: string,
  entities: Entity[],
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
      childEntityIds: [],
      entityDepth: 1,
      hierarchyKind: 'root',
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
          childEntityIds: [],
          entityDepth: 2,
          hierarchyKind: 'member',
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
          childEntityIds: [],
          entityDepth: 2,
          hierarchyKind: 'member',
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
      childEntityIds: [],
      entityDepth: 1,
      hierarchyKind: 'root',
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
    const signatureSurface = measureTypeComplexity(node.type);
    const narrowing = detectNarrowingPattern(node.type);

    entities.push({
      id,
      kind: 'type-alias',
      name,
      filePath,
      sourceRange: range,
      parentEntityId: parentId,
      childEntityIds: [],
      entityDepth: 1,
      hierarchyKind: 'root',
      classification: {
        isAbstract: false,
        isInterface: false,
        isConcrete: false,
        isTypeOnly: true,
        isExported,
        visibility: null,
      },
      nameTokens: tokenizeName(name),
      rawCounts: {
        linesOfCode: countLines(range),
        signatureSurface: signatureSurface > 0 ? signatureSurface : null,
        narrowingKind: narrowing?.kind ?? null,
        narrowedFieldCount: narrowing?.fieldCount ?? null,
      },
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
      childEntityIds: [],
      entityDepth: 1,
      hierarchyKind: 'root',
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
        signatureSurface: node.members.length > 0 ? node.members.length : null,
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
      childEntityIds: [],
      entityDepth: 1,
      hierarchyKind: 'root',
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
      if (!decl.initializer || !ts.isIdentifier(decl.name)) continue;
      const name = decl.name.text;

      // Direct arrow / function expression
      const innerFn = unwrapToFunction(decl.initializer);
      if (innerFn) {
        const id = `function:${filePath}:${name}`;
        const range = getSourceRange(decl, sourceFile);

        entities.push({
          id,
          kind: 'function',
          name,
          filePath,
          sourceRange: range,
          parentEntityId: parentId,
          childEntityIds: [],
          entityDepth: 1,
          hierarchyKind: 'root',
          classification: {
            isAbstract: false,
            isInterface: false,
            isConcrete: true,
            isTypeOnly: false,
            isExported,
            visibility: null,
          },
          nameTokens: tokenizeName(name),
          rawCounts: buildFunctionRawCounts(decl, sourceFile),
        });
        continue;
      }

      // Standalone exported constant/variable (non-function value)
      if (isExported) {
        const id = `field:${filePath}:${name}`;
        const range = getSourceRange(decl, sourceFile);
        entities.push({
          id,
          kind: 'field',
          name,
          filePath,
          sourceRange: range,
          parentEntityId: parentId,
          childEntityIds: [],
          entityDepth: 1,
          hierarchyKind: 'root',
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
            linesOfCode: countLines(getSourceRange(decl, sourceFile)),
          },
        });
      }
    }
    return;
  }

  // Export default function / class
  if (ts.isExportAssignment(node)) return;
}

// ── Hierarchy finalization ──────────────────────────────────────────────────

/**
 * Post-process entities to compute `childEntityIds` from `parentEntityId`
 * references and promote any entity with children to `hierarchyKind: 'container'`.
 */
function finalizeHierarchy(entities: Entity[]): void {
  const parentToChildren = new Map<string, string[]>();
  for (const e of entities) {
    if (e.parentEntityId != null) {
      let children = parentToChildren.get(e.parentEntityId);
      if (!children) {
        children = [];
        parentToChildren.set(e.parentEntityId, children);
      }
      children.push(e.id);
    }
  }
  for (const e of entities) {
    const children = parentToChildren.get(e.id);
    if (children && children.length > 0) {
      e.childEntityIds = children;
      e.hierarchyKind = 'container';
    }
  }
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
    childEntityIds: [],
    entityDepth: 0,
    hierarchyKind: 'root',
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

// ── Type complexity measurement ─────────────────────────────────────────────

/**
 * Recursively count the number of type nodes in a type annotation.
 * Each distinct type reference, union/intersection member, generic argument,
 * object property, tuple element, or function-type parameter adds 1.
 * Returns 0 for undefined/missing type annotations.
 */
function measureTypeComplexity(typeNode: ts.TypeNode | undefined): number {
  if (!typeNode) return 0;

  switch (typeNode.kind) {
    // Leaf types: 1 each
    case ts.SyntaxKind.StringKeyword:
    case ts.SyntaxKind.NumberKeyword:
    case ts.SyntaxKind.BooleanKeyword:
    case ts.SyntaxKind.VoidKeyword:
    case ts.SyntaxKind.UndefinedKeyword:
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.NeverKeyword:
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
    case ts.SyntaxKind.BigIntKeyword:
    case ts.SyntaxKind.SymbolKeyword:
    case ts.SyntaxKind.ObjectKeyword:
    case ts.SyntaxKind.LiteralType:
    case ts.SyntaxKind.ThisType:
    case ts.SyntaxKind.TemplateLiteralType:
      return 1;

    // Simple type reference (e.g. `Foo`): 1 + sum of generic args
    case ts.SyntaxKind.TypeReference: {
      const ref = typeNode as ts.TypeReferenceNode;
      let c = 1;
      for (const arg of ref.typeArguments ?? []) c += measureTypeComplexity(arg);
      return c;
    }

    // Union / intersection: sum of members
    case ts.SyntaxKind.UnionType: {
      const union = typeNode as ts.UnionTypeNode;
      let c = 0;
      for (const t of union.types) c += measureTypeComplexity(t);
      return c;
    }
    case ts.SyntaxKind.IntersectionType: {
      const inter = typeNode as ts.IntersectionTypeNode;
      let c = 0;
      for (const t of inter.types) c += measureTypeComplexity(t);
      return c;
    }

    // Array: 1 + element
    case ts.SyntaxKind.ArrayType:
      return 1 + measureTypeComplexity((typeNode as ts.ArrayTypeNode).elementType);

    // Tuple: sum of elements
    case ts.SyntaxKind.TupleType: {
      const tuple = typeNode as ts.TupleTypeNode;
      let c = 0;
      for (const el of tuple.elements) c += measureTypeComplexity(el as ts.TypeNode);
      return c;
    }

    // Object literal type: sum of member type complexities
    case ts.SyntaxKind.TypeLiteral: {
      const lit = typeNode as ts.TypeLiteralNode;
      let c = 0;
      for (const member of lit.members) {
        if (ts.isPropertySignature(member) && member.type) {
          c += measureTypeComplexity(member.type);
        } else if (ts.isMethodSignature(member)) {
          c += measureCallSignatureComplexity(member);
        } else if (ts.isIndexSignatureDeclaration(member)) {
          c += 1 + measureTypeComplexity(member.type);
        } else {
          c += 1;
        }
      }
      return c;
    }

    // Function type: params + return
    case ts.SyntaxKind.FunctionType:
    case ts.SyntaxKind.ConstructorType: {
      const fn = typeNode as ts.FunctionOrConstructorTypeNode;
      return measureCallSignatureComplexity(fn);
    }

    // Parenthesized: unwrap
    case ts.SyntaxKind.ParenthesizedType:
      return measureTypeComplexity((typeNode as ts.ParenthesizedTypeNode).type);

    // Conditional type: check + extends + true + false
    case ts.SyntaxKind.ConditionalType: {
      const cond = typeNode as ts.ConditionalTypeNode;
      return measureTypeComplexity(cond.checkType) + measureTypeComplexity(cond.extendsType)
        + measureTypeComplexity(cond.trueType) + measureTypeComplexity(cond.falseType);
    }

    // Mapped type: 1 + constraint + value
    case ts.SyntaxKind.MappedType: {
      const mapped = typeNode as ts.MappedTypeNode;
      return 1 + measureTypeComplexity(mapped.type);
    }

    // Indexed access: object + index
    case ts.SyntaxKind.IndexedAccessType: {
      const indexed = typeNode as ts.IndexedAccessTypeNode;
      return measureTypeComplexity(indexed.objectType) + measureTypeComplexity(indexed.indexType);
    }

    // Keyof / typeof / readonly: 1 + inner
    case ts.SyntaxKind.TypeOperator:
      return 1 + measureTypeComplexity((typeNode as ts.TypeOperatorNode).type);

    // Infer: 1
    case ts.SyntaxKind.InferType:
      return 1;

    // Rest type: inner
    case ts.SyntaxKind.RestType:
      return measureTypeComplexity((typeNode as ts.RestTypeNode).type);

    // Named tuple member: inner
    case ts.SyntaxKind.NamedTupleMember:
      return measureTypeComplexity((typeNode as ts.NamedTupleMember).type);

    // Fallback
    default:
      return 1;
  }
}

/**
 * Measure the surface complexity of a callable signature:
 * parameterCount + sum of parameter type complexities + return type complexity.
 */
function measureCallSignatureComplexity(
  sig: ts.SignatureDeclarationBase | ts.MethodSignature | ts.CallSignatureDeclaration,
): number {
  let c = 0;
  for (const param of sig.parameters) {
    c += 1; // the parameter itself
    c += measureTypeComplexity(param.type);
  }
  c += measureTypeComplexity(sig.type); // return type
  return c;
}

/**
 * Build signature surface for a function-like node:
 * paramCount + paramTypeComplexity + returnTypeComplexity.
 */
function measureFunctionSignatureSurface(node: ts.FunctionLikeDeclaration): {
  parameterTypeComplexity: number;
  returnTypeComplexity: number;
  signatureSurface: number;
} {
  let parameterTypeComplexity = 0;
  for (const param of node.parameters) {
    parameterTypeComplexity += measureTypeComplexity(param.type);
  }
  const returnTypeComplexity = measureTypeComplexity(node.type);
  const signatureSurface = node.parameters.length + parameterTypeComplexity + returnTypeComplexity;
  return { parameterTypeComplexity, returnTypeComplexity, signatureSurface };
}

// ── Type narrowing detection ────────────────────────────────────────────────

type NarrowingKind = 'pick' | 'omit' | 'extract' | 'exclude' | 'partial' | 'required' | 'readonly' | 'record';

const NARROWING_UTILITIES: Record<string, NarrowingKind> = {
  Pick: 'pick',
  Omit: 'omit',
  Extract: 'extract',
  Exclude: 'exclude',
  Partial: 'partial',
  Required: 'required',
  Readonly: 'readonly',
  Record: 'record',
};

interface NarrowingInfo {
  kind: NarrowingKind;
  /** For Pick/Omit: number of keys selected/excluded. Null if not determinable. */
  fieldCount: number | null;
}

/**
 * Detect if a type-alias body uses a TypeScript utility type that narrows
 * an imported type. E.g. `type X = Pick<Config, 'host' | 'port'>`.
 *
 * Returns narrowing info if detected, null otherwise.
 */
function detectNarrowingPattern(typeNode: ts.TypeNode): NarrowingInfo | null {
  if (!ts.isTypeReferenceNode(typeNode)) return null;

  const typeName = typeNode.typeName;
  let name: string | undefined;
  if (ts.isIdentifier(typeName)) {
    name = typeName.text;
  }
  if (!name) return null;

  const narrowingKind = NARROWING_UTILITIES[name];
  if (!narrowingKind) return null;

  const typeArgs = typeNode.typeArguments;

  // For Pick<T, K> and Omit<T, K>: count keys in K (second type arg)
  if ((narrowingKind === 'pick' || narrowingKind === 'omit') && typeArgs && typeArgs.length >= 2) {
    const keysArg = typeArgs[1];
    const fieldCount = countUnionLiteralMembers(keysArg);
    return { kind: narrowingKind, fieldCount };
  }

  // For Extract<T, U> and Exclude<T, U>: count members of U (second type arg)
  if ((narrowingKind === 'extract' || narrowingKind === 'exclude') && typeArgs && typeArgs.length >= 2) {
    const filterArg = typeArgs[1];
    const fieldCount = countUnionLiteralMembers(filterArg);
    return { kind: narrowingKind, fieldCount };
  }

  // For Partial, Required, Readonly: they wrap the full type but weaken coupling
  if (narrowingKind === 'partial' || narrowingKind === 'required' || narrowingKind === 'readonly') {
    return { kind: narrowingKind, fieldCount: null };
  }

  // Record<K, V>: not really narrowing but marks a structural pattern
  if (narrowingKind === 'record') {
    return { kind: narrowingKind, fieldCount: null };
  }

  return { kind: narrowingKind, fieldCount: null };
}

/**
 * Count the number of members in a union of literal types.
 * `'a' | 'b' | 'c'` → 3, `string` → 1, `'a'` → 1.
 */
function countUnionLiteralMembers(typeNode: ts.TypeNode): number {
  if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types.length;
  }
  if (ts.isLiteralTypeNode(typeNode)) {
    return 1;
  }
  // Single non-union type reference — we can't count fields
  return 1;
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

  // Signature surface measurement
  let parameterTypeComplexity: number | null = null;
  let returnTypeComplexity: number | null = null;
  let signatureSurface: number | null = null;

  const fnLike = node as ts.FunctionLikeDeclaration;
  if (fnLike.parameters) {
    const surf = measureFunctionSignatureSurface(fnLike);
    parameterTypeComplexity = surf.parameterTypeComplexity;
    returnTypeComplexity = surf.returnTypeComplexity;
    signatureSurface = surf.signatureSurface;
  }

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
    parameterTypeComplexity,
    returnTypeComplexity,
    signatureSurface,
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
  let signatureSurface = 0;

  for (const member of node.members) {
    const vis = getMemberVisibility(member);
    const isPublic = vis === 'public' || vis === null;

    if (ts.isConstructorDeclaration(member)) {
      // Constructor always contributes to class surface
      const surf = measureFunctionSignatureSurface(member);
      signatureSurface += surf.signatureSurface;
    }

    if (
      ts.isMethodDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      if (isPublic) {
        publicMethodCount++;
        const surf = measureFunctionSignatureSurface(member as ts.FunctionLikeDeclaration);
        signatureSurface += surf.signatureSurface;
      }
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
      if (isPublic) {
        publicPropertyCount++;
        signatureSurface += measureTypeComplexity(member.type);
      }
    }
  }

  return {
    linesOfCode: countLines(range),
    publicMethodCount,
    publicPropertyCount,
    extensionPoints: extensionPoints > 0 ? extensionPoints : null,
    signatureSurface: signatureSurface > 0 ? signatureSurface : null,
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
  let signatureSurface = 0;

  for (const member of node.members) {
    if (ts.isMethodSignature(member)) {
      publicMethodCount++;
      signatureSurface += measureCallSignatureComplexity(member);
    } else if (ts.isPropertySignature(member)) {
      publicPropertyCount++;
      signatureSurface += measureTypeComplexity(member.type);
    } else if (ts.isCallSignatureDeclaration(member)) {
      signatureSurface += measureCallSignatureComplexity(member);
    } else if (ts.isIndexSignatureDeclaration(member)) {
      signatureSurface += 1 + measureTypeComplexity(member.type);
    }
  }

  return {
    linesOfCode: countLines(range),
    publicMethodCount,
    publicPropertyCount,
    signatureSurface: signatureSurface > 0 ? signatureSurface : null,
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
 * Unwrap HOC / wrapper call patterns to find the inner arrow or function expression.
 * Handles: memo(() => ...), forwardRef((p,r) => ...), memo(forwardRef(...)), etc.
 * Returns the inner function node or undefined if no function found.
 */
function unwrapToFunction(node: ts.Expression): ts.ArrowFunction | ts.FunctionExpression | undefined {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
  if (ts.isCallExpression(node)) {
    for (const arg of node.arguments) {
      const inner = unwrapToFunction(arg);
      if (inner) return inner;
    }
  }
  if (ts.isParenthesizedExpression(node)) {
    return unwrapToFunction(node.expression);
  }
  return undefined;
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
