import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

export type OneLineMethodKind =
  | 'single-statement'
  | 'forwarder'
  | 'passthrough-forwarder'
  | 'free-function-forwarder'
  | 'free-function-passthrough-forwarder';

export type OneLineCallType = 'this-call' | 'free-function-call';
export type TargetPackageRelation = 'same-file' | 'same-package' | 'other-package' | 'unknown';
export type InlineUrgency = 'high' | 'medium' | 'low' | 'avoid';
export type InterfaceRequirement = 'required' | 'not-required' | 'unknown';

export interface OneLineMethodFinding {
  filePath: string;
  line: number;
  methodName: string;
  visibility: 'public' | 'protected' | 'private' | 'implicit';
  isAsync: boolean;
  params: string[];
  statement: string;
  kind: OneLineMethodKind;
  forwardsTo?: string;
  callType?: OneLineCallType;
  callTarget?: string;
  forwardsParamsUnchanged?: boolean;
  targetUsageCount?: number;
  targetPackageRelation?: TargetPackageRelation;
  inlineUrgency?: InlineUrgency;
  inlineReason?: string;
  containingClass?: string;
  implementedInterfaces?: string[];
  interfaceRequirement?: InterfaceRequirement;
  requiredByInterfaces?: string[];
}

export interface OneLineMethodScanOptions {
  rootDir: string;
  includeExtensions?: string[];
  excludePathSubstrings?: string[];
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const DEFAULT_EXCLUDES = ['node_modules', '/dist/', '/build/', '/coverage/', '/.git/'];

interface MethodCandidate {
  methodName: string;
  visibility: 'public' | 'protected' | 'private' | 'implicit';
  isAsync: boolean;
  params: string[];
  singleStatement?: string;
  signatureIndex: number;
  containingClass?: string;
  implementedInterfaces?: string[];
}

export async function findOneLineMethodsAsync(
  options: OneLineMethodScanOptions
): Promise<OneLineMethodFinding[]> {
  const rootDir = path.resolve(options.rootDir);
  const includeExtensions = new Set(
    (options.includeExtensions ?? DEFAULT_EXTENSIONS).map((ext) =>
      ext.startsWith('.') ? ext : `.${ext}`
    )
  );
  const excludePathSubstrings = options.excludePathSubstrings ?? DEFAULT_EXCLUDES;

  const files = await collectFilesAsync(rootDir, includeExtensions, excludePathSubstrings);
  const sourceByFile = new Map<string, string>();
  for (const filePath of files) {
    sourceByFile.set(filePath, await fs.readFile(filePath, 'utf8'));
  }

  const findings: OneLineMethodFinding[] = [];
  for (const filePath of files) {
    const source = sourceByFile.get(filePath);
    if (!source) continue;
    findings.push(...findOneLineMethodsInSource(source, filePath));
  }

  const enriched = findings.map((finding) =>
    enrichFindingWithUsageAndOrigin(finding, sourceByFile, rootDir)
  );

  return enriched.sort((a, b) => {
    const byPath = a.filePath.localeCompare(b.filePath);
    if (byPath !== 0) return byPath;
    return a.line - b.line;
  });
}

export function findOneLineMethodsInSource(
  source: string,
  filePath: string
): OneLineMethodFinding[] {
  const findings: OneLineMethodFinding[] = [];
  const candidates = findMethodCandidates(source);

  for (const candidate of candidates) {
    const statement = candidate.singleStatement?.trim();
    if (!statement) continue;
    if (!isWrapperLikeStatement(statement)) continue;

    const params = candidate.params;
    const forwarded = parseForwardedCall(statement);
    const forwardsParamsUnchanged = forwarded
      ? arePassthroughArguments(params, forwarded.args)
      : false;

    let kind: OneLineMethodKind = 'single-statement';
    if (forwarded) {
      if (forwarded.callType === 'this-call') {
        kind = forwardsParamsUnchanged ? 'passthrough-forwarder' : 'forwarder';
      } else {
        kind = forwardsParamsUnchanged
          ? 'free-function-passthrough-forwarder'
          : 'free-function-forwarder';
      }
    }

    findings.push({
      filePath,
      line: toLineNumber(source, candidate.signatureIndex),
      methodName: candidate.methodName,
      visibility: candidate.visibility,
      isAsync: candidate.isAsync,
      params,
      statement,
      kind,
      forwardsTo: forwarded?.callType === 'this-call' ? forwarded.target : undefined,
      callType: forwarded?.callType,
      callTarget: forwarded?.target,
      forwardsParamsUnchanged: forwarded ? forwardsParamsUnchanged : undefined,
      containingClass: candidate.containingClass,
      implementedInterfaces: candidate.implementedInterfaces,
    });
  }

  return findings;
}

function findMethodCandidates(source: string): MethodCandidate[] {
  const out: MethodCandidate[] = [];
  const sourceFile = ts.createSourceFile(
    'one-line-method.candidates.ts',
    source,
    ts.ScriptTarget.Latest,
    true
  );

  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const className = node.name?.getText(sourceFile);
      const implementedInterfaces = getImplementedInterfacesFromClass(node, sourceFile);

      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        if (!member.body) continue;

        const methodName = getMethodName(member.name, sourceFile);
        if (!methodName) continue;
        if (CONTROL_KEYWORDS.has(methodName)) continue;
        if (EXCLUDED_METHOD_NAMES.has(methodName)) continue;

        out.push({
          methodName,
          visibility: getMethodVisibility(member),
          isAsync: hasModifier(member, ts.SyntaxKind.AsyncKeyword),
          params: extractSimpleParameterNames(member),
          singleStatement:
            member.body.statements.length === 1
              ? member.body.statements[0]?.getText(sourceFile)
              : undefined,
          signatureIndex: member.getStart(sourceFile),
          containingClass: className,
          implementedInterfaces,
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return out;
}

const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'do']);
const EXCLUDED_METHOD_NAMES = new Set(['constructor']);

function getImplementedInterfacesFromClass(
  node: ts.ClassDeclaration,
  sourceFile: ts.SourceFile
): string[] {
  const clauses = node.heritageClauses ?? [];
  const implementsClause = clauses.find((c) => c.token === ts.SyntaxKind.ImplementsKeyword);
  if (!implementsClause) return [];

  return implementsClause.types.map((t) => t.expression.getText(sourceFile).trim()).filter(Boolean);
}

function getMethodName(name: ts.PropertyName, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return name.expression.getText(sourceFile);
  return undefined;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const modifiers = ts.getModifiers(node);
  return (modifiers ?? []).some((m: ts.ModifierLike) => m.kind === kind);
}

function getMethodVisibility(node: ts.Node): MethodCandidate['visibility'] {
  if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) return 'private';
  if (hasModifier(node, ts.SyntaxKind.ProtectedKeyword)) return 'protected';
  if (hasModifier(node, ts.SyntaxKind.PublicKeyword)) return 'public';
  return 'implicit';
}

function extractSimpleParameterNames(method: ts.MethodDeclaration): string[] {
  return method.parameters
    .map((param) => (ts.isIdentifier(param.name) ? param.name.text : undefined))
    .filter((name): name is string => Boolean(name));
}

function parseForwardedCall(
  statement: string
): { callType: OneLineCallType; target: string; args: string[] } | undefined {
  const parsed = parseCallFromStatementWithTsAst(statement);
  if (!parsed) return undefined;

  if (parsed.callExpression.expression.kind === ts.SyntaxKind.Identifier) {
    const target = parsed.callExpression.expression.getText(parsed.sourceFile);
    const args = parsed.callExpression.arguments
      .map((x) => x.getText(parsed.sourceFile).trim())
      .filter(Boolean);
    return { callType: 'free-function-call', target, args };
  }

  if (parsed.callExpression.expression.kind === ts.SyntaxKind.PropertyAccessExpression) {
    const prop = parsed.callExpression.expression as ts.PropertyAccessExpression;
    if (prop.expression.kind !== ts.SyntaxKind.ThisKeyword) return undefined;

    const target = prop.name.getText(parsed.sourceFile);
    const args = parsed.callExpression.arguments
      .map((x) => x.getText(parsed.sourceFile).trim())
      .filter(Boolean);
    return { callType: 'this-call', target, args };
  }

  return undefined;
}

function parseCallFromStatementWithTsAst(
  statement: string
): { sourceFile: ts.SourceFile; callExpression: ts.CallExpression } | undefined {
  const parsed = parseStatementWithTsAst(statement);
  if (!parsed) return undefined;

  const expr = extractCallLikeExpression(parsed.statement);
  if (!expr) return undefined;

  return { sourceFile: parsed.sourceFile, callExpression: expr };
}

function parseStatementWithTsAst(
  statement: string
): { sourceFile: ts.SourceFile; statement: ts.Statement } | undefined {
  const normalized = statement.trim();
  const wrapped = `function __tmp__() {\n${normalized.endsWith(';') ? normalized : `${normalized};`}\n}`;
  const sourceFile = ts.createSourceFile('one-line-method.tmp.ts', wrapped, ts.ScriptTarget.Latest);

  const fn = sourceFile.statements.find(ts.isFunctionDeclaration);
  const first = fn?.body?.statements[0];
  if (!first) return undefined;

  return { sourceFile, statement: first };
}

function extractCallLikeExpression(statement: ts.Statement): ts.CallExpression | undefined {
  if (ts.isReturnStatement(statement) && statement.expression) {
    return unwrapAwaitedCall(statement.expression);
  }

  if (ts.isExpressionStatement(statement)) {
    return unwrapAwaitedCall(statement.expression);
  }

  return undefined;
}

function unwrapAwaitedCall(expression: ts.Expression): ts.CallExpression | undefined {
  if (ts.isAwaitExpression(expression)) {
    return ts.isCallExpression(expression.expression) ? expression.expression : undefined;
  }

  return ts.isCallExpression(expression) ? expression : undefined;
}

function isWrapperLikeStatement(statement: string): boolean {
  const parsed = parseStatementWithTsAst(statement);
  if (!parsed) return false;

  if (ts.isReturnStatement(parsed.statement)) return true;
  if (ts.isThrowStatement(parsed.statement)) return true;

  if (ts.isExpressionStatement(parsed.statement)) {
    return Boolean(unwrapAwaitedCall(parsed.statement.expression));
  }

  return false;
}

function arePassthroughArguments(params: string[], args: string[]): boolean {
  if (params.length !== args.length) return false;

  for (let i = 0; i < params.length; i++) {
    const paramName = params[i];
    const argName = toSimpleIdentifier(args[i]);
    if (!paramName || !argName || paramName !== argName) {
      return false;
    }
  }

  return true;
}

function toSimpleIdentifier(value: string): string | undefined {
  const normalized = value.trim().replace(/^\.\.\./, '');
  if (!/^[A-Za-z_$][\w$]*$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function enrichFindingWithUsageAndOrigin(
  finding: OneLineMethodFinding,
  sourceByFile: Map<string, string>,
  rootDir: string
): OneLineMethodFinding {
  const source = sourceByFile.get(finding.filePath) ?? '';

  const iface = evaluateInterfaceRequirement(finding, source, sourceByFile);

  if (!finding.callType || !finding.callTarget) {
    return {
      ...finding,
      interfaceRequirement: iface.requirement,
      requiredByInterfaces: iface.interfaces,
    };
  }

  const relation = resolveTargetPackageRelation(
    finding.callType,
    finding.callTarget,
    finding.filePath,
    source,
    rootDir
  );

  const usageCount = countTargetUsages(
    finding.callType,
    finding.callTarget,
    finding.filePath,
    sourceByFile
  );

  const { urgency, reason } = computeInlineUrgency(
    finding,
    relation,
    usageCount,
    iface.requirement,
    iface.interfaces
  );

  return {
    ...finding,
    targetPackageRelation: relation,
    targetUsageCount: usageCount,
    inlineUrgency: urgency,
    inlineReason: reason,
    interfaceRequirement: iface.requirement,
    requiredByInterfaces: iface.interfaces,
  };
}

function evaluateInterfaceRequirement(
  finding: OneLineMethodFinding,
  source: string,
  sourceByFile: Map<string, string>
): { requirement: InterfaceRequirement; interfaces: string[] } {
  const interfaces = finding.implementedInterfaces ?? [];
  if (!finding.containingClass || interfaces.length === 0) {
    return { requirement: 'not-required', interfaces: [] };
  }

  const requiredBy: string[] = [];
  let unknownCount = 0;

  for (const ifaceName of interfaces) {
    const localMatch = sourceDefinesInterfaceMethod(source, ifaceName, finding.methodName);
    if (localMatch !== undefined) {
      if (localMatch) {
        requiredBy.push(ifaceName);
      }
      continue;
    }

    const importedModule = resolveImportedModuleSpecifier(source, ifaceName);
    if (!importedModule) {
      unknownCount += 1;
      continue;
    }

    if (!isRelativeSpecifier(importedModule)) {
      unknownCount += 1;
      continue;
    }

    const maybeFile = resolveImportToFilePath(finding.filePath, importedModule, sourceByFile);
    if (!maybeFile) {
      unknownCount += 1;
      continue;
    }

    const importedSource = sourceByFile.get(maybeFile);
    if (!importedSource) {
      unknownCount += 1;
      continue;
    }

    const importedMatch = sourceDefinesInterfaceMethod(
      importedSource,
      ifaceName,
      finding.methodName
    );
    if (importedMatch === undefined) {
      unknownCount += 1;
      continue;
    }

    if (importedMatch) {
      requiredBy.push(ifaceName);
    }
  }

  if (requiredBy.length > 0) {
    return { requirement: 'required', interfaces: requiredBy };
  }

  if (unknownCount > 0) {
    return { requirement: 'unknown', interfaces: [] };
  }

  return { requirement: 'not-required', interfaces: [] };
}

function sourceDefinesInterfaceMethod(
  source: string,
  interfaceName: string,
  methodName: string
): boolean | undefined {
  const sourceFile = ts.createSourceFile(
    'one-line-method.interface.ts',
    source,
    ts.ScriptTarget.Latest,
    true
  );

  for (const stmt of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(stmt)) continue;
    if (stmt.name.text !== interfaceName) continue;

    for (const member of stmt.members) {
      if (!ts.isMethodSignature(member) || !member.name) continue;
      const memberName = getPropertyNameText(member.name, sourceFile);
      if (memberName === methodName) return true;
    }

    return false;
  }

  return undefined;
}

function resolveImportToFilePath(
  importerFilePath: string,
  importSpecifier: string,
  sourceByFile: Map<string, string>
): string | undefined {
  const base = path.resolve(path.dirname(importerFilePath), importSpecifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
    path.join(base, 'index.jsx'),
    path.join(base, 'index.mjs'),
    path.join(base, 'index.cjs'),
  ];

  for (const candidate of candidates) {
    if (sourceByFile.has(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function countTargetUsages(
  callType: OneLineCallType,
  target: string,
  filePath: string,
  sourceByFile: Map<string, string>
): number {
  if (callType === 'this-call') {
    const source = sourceByFile.get(filePath) ?? '';
    return countCallsInSource(source, callType, target);
  }

  let count = 0;
  for (const source of sourceByFile.values()) {
    count += countCallsInSource(source, callType, target);
  }
  return count;
}

function countCallsInSource(source: string, callType: OneLineCallType, target: string): number {
  const sourceFile = ts.createSourceFile(
    'one-line-method.usages.ts',
    source,
    ts.ScriptTarget.Latest,
    true
  );
  let count = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      if (
        callType === 'this-call' &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
        node.expression.name.text === target
      ) {
        count += 1;
      }

      if (
        callType === 'free-function-call' &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === target
      ) {
        count += 1;
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return count;
}

function resolveTargetPackageRelation(
  callType: OneLineCallType,
  target: string,
  filePath: string,
  source: string,
  rootDir: string
): TargetPackageRelation {
  if (callType === 'this-call') {
    return 'same-file';
  }

  const importedFrom = resolveImportedModuleSpecifier(source, target);
  if (importedFrom) {
    if (!isRelativeSpecifier(importedFrom)) {
      return 'other-package';
    }

    const resolved = path.resolve(path.dirname(filePath), importedFrom);
    const normalizedRoot = normalizePathForCompare(rootDir);
    const normalizedResolved = normalizePathForCompare(resolved);
    return normalizedResolved.startsWith(normalizedRoot) ? 'same-package' : 'other-package';
  }

  if (isLocalDeclaration(source, target)) {
    return 'same-file';
  }

  return 'unknown';
}

function resolveImportedModuleSpecifier(source: string, localName: string): string | undefined {
  const sourceFile = ts.createSourceFile(
    'one-line-method.imports.ts',
    source,
    ts.ScriptTarget.Latest,
    true
  );

  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;

    const clause = stmt.importClause;
    if (!clause) continue;

    if (clause.name?.text === localName) {
      return stmt.moduleSpecifier.text;
    }

    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        if (clause.namedBindings.name.text === localName) {
          return stmt.moduleSpecifier.text;
        }
      }

      if (ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const importedAs = element.name.text;
          if (importedAs === localName) {
            return stmt.moduleSpecifier.text;
          }
        }
      }
    }
  }

  return undefined;
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith('.') || specifier.startsWith('/');
}

function isLocalDeclaration(source: string, name: string): boolean {
  const sourceFile = ts.createSourceFile(
    'one-line-method.locals.ts',
    source,
    ts.ScriptTarget.Latest,
    true
  );

  const visit = (node: ts.Node): boolean => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      return true;
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      return true;
    }

    return ts.forEachChild(node, visit) ?? false;
  };

  return visit(sourceFile);
}

function getPropertyNameText(name: ts.PropertyName, sourceFile: ts.SourceFile): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return name.expression.getText(sourceFile);
  return undefined;
}

function normalizePathForCompare(input: string): string {
  return path.resolve(input).replaceAll('\\', '/').replace(/\/+$/, '');
}

function computeInlineUrgency(
  finding: OneLineMethodFinding,
  relation: TargetPackageRelation,
  usageCount: number,
  interfaceRequirement: InterfaceRequirement,
  requiredByInterfaces: string[]
): { urgency: InlineUrgency; reason: string } {
  if (relation === 'other-package') {
    return {
      urgency: 'avoid',
      reason:
        'Target is from another package; inlining is not recommended across package boundaries.',
    };
  }

  if (interfaceRequirement === 'required') {
    if (
      finding.forwardsParamsUnchanged &&
      usageCount <= 1 &&
      (relation === 'same-file' || relation === 'same-package')
    ) {
      return {
        urgency: 'medium',
        reason: `Outer method is contract-required (${requiredByInterfaces.join(', ')}), but inner target is single-use passthrough. Consider contract-preserving inline (keep outer method, inline/remove inner callee).`,
      };
    }

    if (
      finding.forwardsParamsUnchanged &&
      usageCount > 1 &&
      (relation === 'same-file' || relation === 'same-package')
    ) {
      return {
        urgency: 'low',
        reason: `Outer method is contract-required (${requiredByInterfaces.join(', ')}). Inner target has multiple same-package usages; consider calling the concrete implementation behind the interface directly where appropriate if dependency-cycle constraints allow it.`,
      };
    }

    return {
      urgency: 'low',
      reason: `Method appears required by interface (${requiredByInterfaces.join(', ')}). Adapter boundary may be intentional.`,
    };
  }

  if (interfaceRequirement === 'unknown') {
    if (finding.forwardsParamsUnchanged && usageCount <= 1) {
      return {
        urgency: 'medium',
        reason:
          'Possible interface-driven wrapper, but target looks single-use. Verify contract; then consider contract-preserving inline.',
      };
    }

    return {
      urgency: 'low',
      reason:
        'Method may be interface-driven (interface source unresolved). Verify contract before inlining.',
    };
  }

  if (!finding.forwardsParamsUnchanged) {
    return {
      urgency: 'low',
      reason: 'Arguments are transformed or non-trivial; this wrapper may encode intent.',
    };
  }

  if (usageCount <= 1 && (relation === 'same-file' || relation === 'same-package')) {
    return {
      urgency: 'high',
      reason:
        'Passthrough wrapper with target used once in the same package — strongest inline candidate.',
    };
  }

  if (usageCount <= 3 && (relation === 'same-file' || relation === 'same-package')) {
    return {
      urgency: 'medium',
      reason: 'Passthrough wrapper in same package with few call sites — likely inline candidate.',
    };
  }

  return {
    urgency: 'low',
    reason:
      'Target has multiple usages or unknown origin; keep unless broader refactor is planned.',
  };
}

function toLineNumber(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

async function collectFilesAsync(
  rootDir: string,
  includeExtensions: Set<string>,
  excludePathSubstrings: string[]
): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      const normalized = absPath.replaceAll('\\', '/');

      if (excludePathSubstrings.some((needle) => normalized.includes(needle))) {
        continue;
      }

      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!includeExtensions.has(path.extname(entry.name))) continue;
      if (entry.name.endsWith('.d.ts')) continue;

      files.push(absPath);
    }
  }

  await walk(rootDir);
  return files;
}
