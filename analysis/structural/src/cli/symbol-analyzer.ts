#!/usr/bin/env node
/**
 * Symbol-level dead code analyzer — monorepo-wide, TypeChecker-based.
 *
 * Collects ALL reference data for every exported entity:
 *  - Reference kind (type, value, implements, extends, export, import)
 *  - Scope level (same_file → cross_package, with barrel awareness)
 *  - Score (weighted by scope × kind matrix)
 *  - Dead parameters (constructor/method params never used in body)
 *  - Interface implementers
 *  - Fan-in / fan-out (for future centrality/clustering)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

// ── Types ────────────────────────────────────────────────────────────────────

export type ReferenceKind =
  | 'value'
  | 'type'
  | 'implements'
  | 'extends'
  | 'export'
  | 'import'
  | 'other';

export type ScopeLevel =
  | 'same_file'
  | 'same_folder'
  | 'sub_dir_barrel'
  | 'sub_dir_deep'
  | 'parent_barrel'
  | 'sibling_barrel'
  | 'sibling_deep'
  | 'cross_package';

const SCORE_MATRIX: Record<ReferenceKind, Record<ScopeLevel, number>> = {
  value: {
    same_file: 2,
    same_folder: 2,
    sub_dir_barrel: 3,
    sub_dir_deep: 3,
    parent_barrel: 3,
    sibling_barrel: 4,
    sibling_deep: 4,
    cross_package: 5,
  },
  type: {
    same_file: 1,
    same_folder: 1,
    sub_dir_barrel: 1,
    sub_dir_deep: 1,
    parent_barrel: 1,
    sibling_barrel: 1,
    sibling_deep: 1,
    cross_package: 2,
  },
  implements: {
    same_file: 1,
    same_folder: 1,
    sub_dir_barrel: 2,
    sub_dir_deep: 2,
    parent_barrel: 2,
    sibling_barrel: 3,
    sibling_deep: 3,
    cross_package: 4,
  },
  extends: {
    same_file: 1,
    same_folder: 1,
    sub_dir_barrel: 2,
    sub_dir_deep: 2,
    parent_barrel: 2,
    sibling_barrel: 3,
    sibling_deep: 3,
    cross_package: 4,
  },
  export: {
    same_file: 1,
    same_folder: 1,
    sub_dir_barrel: 1,
    sub_dir_deep: 1,
    parent_barrel: 1,
    sibling_barrel: 1,
    sibling_deep: 1,
    cross_package: 1,
  },
  import: {
    same_file: 1,
    same_folder: 1,
    sub_dir_barrel: 1,
    sub_dir_deep: 1,
    parent_barrel: 1,
    sibling_barrel: 1,
    sibling_deep: 1,
    cross_package: 1,
  },
  other: {
    same_file: 1,
    same_folder: 1,
    sub_dir_barrel: 1,
    sub_dir_deep: 1,
    parent_barrel: 1,
    sibling_barrel: 1,
    sibling_deep: 1,
    cross_package: 1,
  },
};

export interface SymbolReference {
  filePath: string;
  line: number;
  kind: ReferenceKind;
  scope: ScopeLevel;
  score: number;
  isBarrel: boolean;
}

export interface SymbolMember {
  memberId: string;
  parentEntityId: string;
  parentName: string;
  filePath: string;
  name: string;
  kind: 'method' | 'property' | 'field';
  line: number;
  isExported: boolean;
  references: SymbolReference[];
  refCount: number;
}

export interface SymbolEntity {
  entityId: string;
  filePath: string;
  packageName: string;
  folder: string;
  name: string;
  kind: string;
  line: number;
  isExported: boolean;
  isReExport: boolean;
  references: SymbolReference[];
  refCount: number;
  score: number;
  scoreBreakdown: {
    byScope: Record<ScopeLevel, number>;
    byKind: Record<ReferenceKind, number>;
  };
  fanIn: number;
  fanOut: number;
  implementers: { entityId: string; name: string; filePath: string }[];
  implementsInterfaces: { entityId: string; name: string; filePath: string }[];
  deadParameters: { paramName: string; parentName: string; line: number }[];
  members: SymbolMember[];
  deadMembers: SymbolMember[];
}

export type RecommendationType =
  | 'remove_dead_export'
  | 'make_package_internal'
  | 'make_private'
  | 'remove_dead_parameter'
  | 'remove_dead_reexport'
  | 'remove_dead_interface_method'
  | 'introduce_barrel'
  | 'route_through_barrel';

export interface Recommendation {
  type: RecommendationType;
  filePath: string;
  line: number;
  entityName: string;
  message: string;
}

export interface AnalysisResult {
  rootDir: string;
  tsconfig: string;
  prodFileCount: number;
  testFileCount: number;
  entities: SymbolEntity[];
  deadEntities: SymbolEntity[];
  recommendations: Recommendation[];
  summary: {
    total: number;
    dead: number;
    exported: number;
    deadExported: number;
    byKind: Record<string, { total: number; dead: number }>;
    byPackage: Record<string, { total: number; dead: number }>;
    byScope: {
      same_file_only: number;
      same_folder_only: number;
      same_package_only: number;
      cross_package: number;
    };
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function findTsconfig(dir: string): string | null {
  let current = dir;
  const root = path.parse(current).root;
  while (current !== root) {
    const candidate = path.join(current, 'tsconfig.json');
    if (fs.existsSync(candidate)) return candidate;
    current = path.dirname(current);
  }
  return null;
}

export function loadTsconfig(tsconfigPath: string): {
  options: ts.CompilerOptions;
  excludePatterns: string[];
  fileNames: string[];
} {
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    const msg = ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n');
    throw new Error(`Failed to read tsconfig: ${msg}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(tsconfigPath),
    undefined,
    tsconfigPath
  );
  return {
    options: parsed.options,
    excludePatterns: (parsed.raw.exclude ?? []) as string[],
    fileNames: parsed.fileNames,
  };
}

function findPackageTsconfigs(rootDir: string): string[] {
  const results: string[] = [];
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'storybook-static']);
  function walk(dir: string): void {
    try {
      for (const entry of ts.sys.getDirectories?.(dir) ?? []) {
        if (skipDirs.has(entry)) continue;
        const sub = path.join(dir, entry);
        const candidate = path.join(sub, 'tsconfig.json');
        if (ts.sys.fileExists(candidate)) results.push(candidate);
        else walk(sub);
      }
    } catch {
      /* ignore */
    }
  }
  walk(rootDir);
  return results;
}

export function buildProgram(rootTsconfigPath: string): ts.Program {
  const configFile = ts.readConfigFile(rootTsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `Failed to read tsconfig: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`
    );
  }
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(rootTsconfigPath),
    undefined,
    rootTsconfigPath
  );

  let fileNames = parsed.fileNames;
  if (fileNames.length === 0) {
    const rootDir = path.dirname(rootTsconfigPath);
    process.stderr.write(`Root tsconfig has no files, scanning packages in ${rootDir}...\n`);
    const packageTsconfigs = findPackageTsconfigs(rootDir);
    process.stderr.write(`Found ${packageTsconfigs.length} package tsconfigs\n`);
    const allFiles = new Set<string>();
    for (const pkgTsconfig of packageTsconfigs) {
      try {
        const pkgConfig = ts.readConfigFile(pkgTsconfig, ts.sys.readFile);
        if (pkgConfig.error) continue;
        const pkgParsed = ts.parseJsonConfigFileContent(
          pkgConfig.config,
          ts.sys,
          path.dirname(pkgTsconfig),
          { extends: undefined },
          pkgTsconfig
        );
        for (const fn of pkgParsed.fileNames) allFiles.add(fn);
      } catch {
        /* skip */
      }
    }
    fileNames = [...allFiles];
    process.stderr.write(`Collected ${fileNames.length} source files from all packages\n`);
  }

  return ts.createProgram({
    rootNames: fileNames.length > 0 ? fileNames : [rootTsconfigPath],
    options: parsed.options,
  });
}

function matchesExclude(filePath: string, excludePatterns: string[]): boolean {
  const normalized = filePath.replaceAll('\\', '/');
  for (const pattern of excludePatterns) {
    if (matchesSinglePattern(normalized, pattern)) return true;
  }
  return false;
}

function matchesSinglePattern(normalized: string, pattern: string): boolean {
  const clean = pattern.replaceAll('\\', '/');
  if (clean.includes('**')) return matchesGlobPattern(normalized, clean);
  if (clean.startsWith('*.')) return normalized.endsWith(clean.substring(1));
  if (!clean.includes('/') && !clean.includes('*'))
    return normalized.includes(`/${clean}/`) || normalized.endsWith(`/${clean}`);
  return normalized.includes(clean.replaceAll('*', ''));
}

function matchesGlobPattern(normalized: string, pattern: string): boolean {
  const parts = pattern.split('**').filter(Boolean);
  if (parts.length !== 2) return false;
  const prefix = parts[0].replace(/^\//, '').replace(/\/$/, '');
  const suffix = parts[1].replace(/^\//, '').replace(/\/$/, '');
  if (prefix && !normalized.includes(prefix)) return false;
  if (suffix && !normalized.endsWith(suffix)) return false;
  return true;
}

export const DEFAULT_SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.output',
  'storybook-static',
  'coverage',
]);

/** Collect dev dependency package names from all package.json files in the workspace. */
function collectDevDeps(rootDir: string): Set<string> {
  const devDeps = new Set<string>();
  function walk(dir: string): void {
    try {
      for (const entry of ts.sys.getDirectories?.(dir) ?? []) {
        if (entry.startsWith('.') || entry === 'node_modules') continue;
        const pkgJson = path.join(dir, entry, 'package.json');
        if (ts.sys.fileExists(pkgJson)) {
          try {
            const raw = ts.sys.readFile(pkgJson);
            if (raw) {
              const pkg = JSON.parse(raw);
              for (const dep of Object.keys(pkg.devDependencies ?? {})) devDeps.add(dep);
            }
          } catch {
            /* ignore */
          }
        }
        walk(path.join(dir, entry));
      }
    } catch {
      /* ignore */
    }
  }
  walk(rootDir);
  return devDeps;
}

/** Check if a source file imports from any dev dependency package. */
function importsDevDeps(sourceFile: ts.SourceFile, devDeps: Set<string>): boolean {
  function checkImportClause(node: ts.Node): boolean {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const mod = node.moduleSpecifier.text;
      for (const dep of devDeps) {
        if (mod === dep || mod.startsWith(dep + '/')) return true;
      }
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const mod = node.moduleSpecifier.text;
      for (const dep of devDeps) {
        if (mod === dep || mod.startsWith(dep + '/')) return true;
      }
    }
    return false;
  }
  let found = false;
  function visit(n: ts.Node): void {
    if (found) return;
    if (checkImportClause(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(sourceFile);
  return found;
}

export function getProdSourceFiles(
  program: ts.Program,
  excludePatterns: string[],
  skipDirs: Set<string> = DEFAULT_SKIP_DIRS,
  devDeps: Set<string> = new Set()
): { prodFiles: Map<string, ts.SourceFile>; testFiles: Set<string> } {
  const prodFiles = new Map<string, ts.SourceFile>();
  const testFiles = new Set<string>();
  for (const sourceFile of program.getSourceFiles()) {
    const filePath = sourceFile.fileName;
    if (sourceFile.isDeclarationFile) continue;
    // Skip compiled/output directories
    const normalized = filePath.replaceAll('\\', '/');
    let shouldSkip = false;
    for (const skipDir of skipDirs) {
      if (normalized.includes(`/${skipDir}/`) || normalized.endsWith(`/${skipDir}`)) {
        shouldSkip = true;
        break;
      }
    }
    if (shouldSkip) continue;
    // Skip files that import dev dependencies (test files, config files, etc.)
    if (devDeps.size > 0 && importsDevDeps(sourceFile, devDeps)) {
      testFiles.add(filePath);
      continue;
    }
    if (matchesExclude(filePath, excludePatterns)) testFiles.add(filePath);
    else prodFiles.set(filePath, sourceFile);
  }
  return { prodFiles, testFiles };
}

function getPackageName(filePath: string, rootDir: string): string {
  const rel = path.relative(rootDir, filePath).replaceAll('\\', '/');
  const parts = rel.split('/');
  if (parts[0] === 'packages' && parts.length >= 2) return parts[0] + '/' + parts[1];
  if (parts[0] === 'analysis' && parts.length >= 2) return parts[0] + '/' + parts[1];
  return parts[0] || '.';
}

function getFolder(filePath: string): string {
  return path.dirname(filePath);
}

// ── Scope level determination ────────────────────────────────────────────────

function determineScope(refFile: string, targetFile: string, rootDir: string): ScopeLevel {
  if (targetFile === refFile) return 'same_file';

  // Check cross-package first
  const refPackage = getPackageName(refFile, rootDir);
  const targetPackage = getPackageName(targetFile, rootDir);
  if (refPackage !== targetPackage) return 'cross_package';

  const refFolder = path.dirname(refFile);
  const targetFolder = path.dirname(targetFile);

  if (refFolder === targetFolder) return 'same_folder';

  const relPath = path.relative(refFolder, targetFile);
  const relParts = relPath.replaceAll('\\', '/').split('/');
  const goesUp = relParts[0].startsWith('..');

  if (!goesUp) {
    const isBarrel =
      path.basename(targetFile) === 'index.ts' || path.basename(targetFile) === 'index.tsx';
    if (isBarrel) return 'sub_dir_barrel';
    return 'sub_dir_deep';
  }

  let upLevels = 0;
  let i = 0;
  while (i < relParts.length && relParts[i] === '..') {
    upLevels++;
    i++;
  }
  const remaining = relParts.slice(i).join('/');
  const isBarrel =
    remaining &&
    (path.basename(remaining) === 'index.ts' || path.basename(remaining) === 'index.tsx');

  if (upLevels === 1) {
    if (!remaining || remaining === '') return 'parent_barrel';
    if (isBarrel) return 'sibling_barrel';
    return 'sibling_deep';
  }

  if (isBarrel) return 'sibling_barrel';
  return 'sibling_deep';
}

// ── Symbol helpers ───────────────────────────────────────────────────────────

function getSymbolKind(symbol: ts.Symbol): string {
  const flags = symbol.flags;
  if (ts.SymbolFlags.Class & flags) return 'class';
  if (ts.SymbolFlags.Function & flags) return 'function';
  if (ts.SymbolFlags.Method & flags) return 'method';
  if (ts.SymbolFlags.Property & flags) return 'property';
  if (ts.SymbolFlags.GetAccessor & flags) return 'getter';
  if (ts.SymbolFlags.SetAccessor & flags) return 'setter';
  if (ts.SymbolFlags.Interface & flags) return 'interface';
  if (ts.SymbolFlags.TypeLiteral & flags) return 'type';
  if (ts.SymbolFlags.TypeParameter & flags) return 'type_parameter';
  if (ts.SymbolFlags.TypeAlias & flags) return 'type_alias';
  if (ts.SymbolFlags.Enum & flags) return 'enum';
  if (ts.SymbolFlags.EnumMember & flags) return 'enum_member';
  if (ts.SymbolFlags.Namespace & flags) return 'namespace';
  if (ts.SymbolFlags.Module & flags) return 'module';
  if (ts.SymbolFlags.Variable & flags) return 'variable';
  return 'other';
}

function getSymbolLine(symbol: ts.Symbol): number {
  const decl = symbol.declarations?.[0];
  if (!decl) return 0;
  const file = decl.getSourceFile();
  const pos = decl.getStart(file);
  return file.getLineAndCharacterOfPosition(pos).line + 1;
}

export function resolveAlias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol {
  let current = symbol;
  for (let i = 0; i < 10; i++) {
    if (!(ts.SymbolFlags.Alias & current.flags)) break;
    const resolved = checker.getAliasedSymbol(current);
    if (resolved === current) break;
    current = resolved;
  }
  return current;
}

function getModuleSymbol(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): ts.Symbol | undefined {
  return checker.getSymbolAtLocation(sourceFile);
}

// ── Reference classification ─────────────────────────────────────────────────

function classifyReferenceKind(node: ts.Node): ReferenceKind {
  const parent = node.parent;
  if (!parent) return 'other';

  if (ts.isTypeReferenceNode(parent)) return 'type';
  if (ts.isTypeAliasDeclaration(parent) && parent.name === node) return 'other';
  if (ts.isTypeLiteralNode(parent)) return 'type';
  if (ts.isTypeQueryNode(parent)) return 'type';

  if (ts.isHeritageClause(parent)) {
    if (parent.token === ts.SyntaxKind.ExtendsKeyword) return 'extends';
    if (parent.token === ts.SyntaxKind.ImplementsKeyword) return 'implements';
  }

  if (ts.isNamedExports(parent)) return 'export';
  if (ts.isExportSpecifier(parent)) return 'export';
  if (ts.isNamespaceExport(parent)) return 'export';

  if (ts.isImportClause(parent)) return 'import';
  if (ts.isNamedImports(parent)) return 'import';
  if (ts.isImportSpecifier(parent)) return 'import';
  if (ts.isImportEqualsDeclaration(parent)) return 'import';

  if (ts.isParameter(parent) && ts.isIdentifier(node) && parent.type?.pos === node.pos)
    return 'type';
  if (ts.isPropertyDeclaration(parent) && parent.type === node) return 'type';
  if (ts.isVariableDeclaration(parent) && parent.type === node) return 'type';
  if (ts.isFunctionLike(parent) && (parent as ts.FunctionLikeDeclaration).type === node)
    return 'type';
  if (ts.isTypeReferenceNode(parent.parent) || ts.isIndexedAccessTypeNode(parent)) return 'type';

  return 'value';
}

// ── Reference counting ───────────────────────────────────────────────────────

// ── Declaration detection ────────────────────────────────────────────────────

/**
 * Check if an identifier is part of a declaration (not a reference).
 * This filters out `function foo()`, `class Bar`, `const baz`, etc.
 * Import/export specifiers are NOT declarations — they're references of kind 'import'/'export'.
 */
function isDeclarationIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;

  // Variable, function, class, interface, enum, type alias, parameter declarations
  if (
    ts.isVariableDeclaration(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isEnumDeclaration(parent) ||
    ts.isTypeAliasDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isEnumMember(parent)
  )
    return true;

  return false;
}

// ── Reference counting (single-pass) ─────────────────────────────────────────

/**
 * Walk all prod files once and build a symbol → references map.
 * Replaces the old O(n×m) approach (walk all files per symbol) with O(n+m).
 */
export function collectAllReferencesOnce(
  checker: ts.TypeChecker,
  prodFiles: Map<string, ts.SourceFile>,
  rootDir: string,
  progressEvery: number = 50
): Map<ts.Symbol, SymbolReference[]> {
  const allRefs = new Map<ts.Symbol, SymbolReference[]>();
  let fileIdx = 0;

  for (const [filePath, sourceFile] of prodFiles) {
    function walk(node: ts.Node): void {
      if (ts.isIdentifier(node)) {
        // Skip identifiers that are part of declarations — these are not references
        if (isDeclarationIdentifier(node)) return;

        const sym = checker.getSymbolAtLocation(node);
        if (!sym) return;
        const resolved = resolveAlias(sym, checker);

        const sf = node.getSourceFile();
        const pos = node.getStart(sf);
        const line = sf.getLineAndCharacterOfPosition(pos).line + 1;
        const kind = classifyReferenceKind(node);

        // Get the declaration file for scope determination
        const decl = resolved.declarations?.[0];
        if (!decl) return;
        const targetFile = decl.getSourceFile().fileName;
        const scope = determineScope(filePath, targetFile, rootDir);
        const isBarrel =
          path.basename(targetFile) === 'index.ts' || path.basename(targetFile) === 'index.tsx';
        const score = SCORE_MATRIX[kind]?.[scope] ?? 1;

        const refs = allRefs.get(resolved);
        if (refs) {
          refs.push({ filePath, line, kind, scope, score, isBarrel });
        } else {
          allRefs.set(resolved, [{ filePath, line, kind, scope, score, isBarrel }]);
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(sourceFile);

    fileIdx++;
    if (fileIdx % progressEvery === 0 || fileIdx === prodFiles.size) {
      const pct = ((fileIdx / prodFiles.size) * 100).toFixed(0);
      process.stderr.write(`    \r    Scanned ${fileIdx}/${prodFiles.size} files (${pct}%)`);
    }
  }
  process.stderr.write('\n');

  return allRefs;
}

/**
 * Filter a symbol's references to exclude declaration positions.
 * The single-pass collector doesn't store raw positions, so we skip this filter.
 * Declaration self-references are minimal noise and don't affect dead code detection.
 */
function filterDeclarationPositions(
  refs: SymbolReference[],
  _symbol: ts.Symbol
): SymbolReference[] {
  return refs;
}

// ── Legacy: kept for member-level collection (smaller scale) ──────────────────

function findAllReferences(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  prodFiles: Map<string, ts.SourceFile>,
  rootDir: string
): SymbolReference[] {
  const targetFile = symbol.declarations?.[0]?.getSourceFile().fileName ?? '';

  const declPositions = new Set<string>();
  if (symbol.declarations) {
    for (const decl of symbol.declarations) {
      const sf = decl.getSourceFile();
      const pos = decl.getStart(sf);
      declPositions.add(`${sf.fileName}:${pos}`);
    }
  }

  const refs: SymbolReference[] = [];

  for (const [filePath] of prodFiles) {
    const sourceFile = prodFiles.get(filePath);
    if (!sourceFile) continue;

    function walk(node: ts.Node): void {
      if (ts.isIdentifier(node)) {
        const sym = checker.getSymbolAtLocation(node);
        if (!sym) return;
        const resolved = resolveAlias(sym, checker);
        if (resolved === symbol) {
          const sf = node.getSourceFile();
          const pos = node.getStart(sf);
          if (declPositions.has(`${sf.fileName}:${pos}`)) return;

          const line = sf.getLineAndCharacterOfPosition(pos).line + 1;
          const kind = classifyReferenceKind(node);
          const scope = determineScope(filePath, targetFile, rootDir);
          const isBarrel =
            path.basename(targetFile) === 'index.ts' || path.basename(targetFile) === 'index.tsx';
          const score = SCORE_MATRIX[kind]?.[scope] ?? 1;

          refs.push({ filePath, line, kind, scope, score, isBarrel });
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(sourceFile);
  }

  return refs;
}

// ── Member-level reference counting ──────────────────────────────────────────

function collectMembers(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  prodFiles: Map<string, ts.SourceFile>,
  rootDir: string
): SymbolMember[] {
  const members: SymbolMember[] = [];
  const parentName = symbol.escapedName.toString();
  const parentEntityId = `${symbol.declarations![0].getSourceFile().fileName}#${parentName}`;

  // Get members via type
  const decl = symbol.declarations?.[0];
  if (!decl) return members;
  const parentType = checker.getTypeOfSymbolAtLocation(symbol, decl);
  const properties = parentType.getProperties();

  for (const prop of properties) {
    const propDecl = prop.declarations?.[0];
    if (!propDecl) continue;
    const propFile = propDecl.getSourceFile();
    if (!prodFiles.has(propFile.fileName)) continue;

    const propName = prop.escapedName.toString();
    const propLine = propFile.getLineAndCharacterOfPosition(propDecl.getStart(propFile)).line + 1;

    // Determine member kind
    let memberKind: SymbolMember['kind'] = 'property';
    if (ts.isMethodDeclaration(propDecl) || ts.isMethodSignature(propDecl)) {
      memberKind = 'method';
    } else if (ts.isPropertyDeclaration(propDecl) || ts.isPropertySignature(propDecl)) {
      memberKind = 'field';
    }

    // Count references to this member
    const memberRefs = findAllReferences(prop, checker, prodFiles, rootDir);

    members.push({
      memberId: `${propFile.fileName}#${propName}`,
      parentEntityId,
      parentName,
      filePath: propFile.fileName,
      name: propName,
      kind: memberKind,
      line: propLine,
      isExported: true,
      references: memberRefs,
      refCount: memberRefs.length,
    });
  }

  return members;
}

// ── Parameter-level dead code ────────────────────────────────────────────────

function findDeadParameters(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): { paramName: string; parentName: string; line: number }[] {
  const dead: { paramName: string; parentName: string; line: number }[] = [];

  function visitNode(node: ts.Node): void {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      const fn = node as ts.FunctionLikeDeclaration;
      const params = fn.parameters;
      const body = fn.body;
      if (!body || params.length === 0) {
        ts.forEachChild(node, visitNode);
        return;
      }

      let parentName = 'anonymous';
      if (ts.isFunctionDeclaration(node) && node.name) parentName = node.name.getText(sourceFile);
      else if (ts.isMethodDeclaration(node) && node.name)
        parentName = node.name.getText(sourceFile);
      else if (ts.isConstructorDeclaration(node)) {
        const classDecl = node.parent;
        if (ts.isClassDeclaration(classDecl) && classDecl.name)
          parentName = classDecl.name.getText(sourceFile) + '.constructor';
      }

      for (const param of params) {
        if (!ts.isIdentifier(param.name)) continue;
        const paramName = param.name.getText(sourceFile);
        const paramSymbol = checker.getSymbolAtLocation(param.name);
        if (!paramSymbol) continue;

        let used = false;
        function checkBody(n: ts.Node): void {
          if (used) return;
          if (ts.isIdentifier(n) && checker.getSymbolAtLocation(n) === paramSymbol) {
            used = true;
            return;
          }
          ts.forEachChild(n, checkBody);
        }
        checkBody(body);

        if (!used) {
          const line = sourceFile.getLineAndCharacterOfPosition(param.name.getStart()).line + 1;
          dead.push({ paramName, parentName, line });
        }
      }
    }
    ts.forEachChild(node, visitNode);
  }

  visitNode(sourceFile);
  return dead;
}

// ── Recommendations ──────────────────────────────────────────────────────────

function generateRecommendations(
  entities: SymbolEntity[],
  deadEntities: SymbolEntity[],
  rootDir: string
): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const e of deadEntities) {
    recs.push({
      type: 'remove_dead_export',
      filePath: e.filePath,
      line: e.line,
      entityName: e.name,
      message: `${e.kind} '${e.name}' is exported but has zero references (score: 0)`,
    });
  }

  for (const e of entities) {
    if (e.refCount === 0) continue;
    if (e.references.every((r) => r.scope === 'same_file')) {
      recs.push({
        type: 'make_private',
        filePath: e.filePath,
        line: e.line,
        entityName: e.name,
        message: `${e.kind} '${e.name}' is exported but only referenced within the same file — remove export`,
      });
    }
  }

  for (const e of entities) {
    if (e.refCount === 0) continue;
    const hasCrossPackage = e.references.some((r) => r.scope === 'cross_package');
    if (
      !hasCrossPackage &&
      e.references.some(
        (r) =>
          r.scope === 'same_folder' ||
          r.scope === 'sub_dir_barrel' ||
          r.scope === 'sub_dir_deep' ||
          r.scope === 'parent_barrel' ||
          r.scope === 'sibling_barrel' ||
          r.scope === 'sibling_deep'
      )
    ) {
      recs.push({
        type: 'make_package_internal',
        filePath: e.filePath,
        line: e.line,
        entityName: e.name,
        message: `${e.kind} '${e.name}' is only referenced within ${e.packageName} — could be package-internal`,
      });
    }
  }

  for (const e of entities) {
    for (const dp of e.deadParameters) {
      recs.push({
        type: 'remove_dead_parameter',
        filePath: e.filePath,
        line: dp.line,
        entityName: `${dp.parentName}(${dp.paramName})`,
        message: `Parameter '${dp.paramName}' in ${dp.parentName} is never used in the function body`,
      });
    }
  }

  for (const e of entities) {
    if (!e.isReExport) continue;
    const hasExternalImport = e.references.some(
      (r) => r.kind === 'import' && r.scope === 'cross_package'
    );
    if (!hasExternalImport) {
      recs.push({
        type: 'remove_dead_reexport',
        filePath: e.filePath,
        line: e.line,
        entityName: e.name,
        message: `Re-export of '${e.name}' has no external consumers — consider removing`,
      });
    }
  }

  const folders = new Map<string, SymbolEntity[]>();
  for (const e of entities) {
    const list = folders.get(e.folder) ?? [];
    list.push(e);
    folders.set(e.folder, list);
  }

  for (const [folder, folderEntities] of folders) {
    const indexPath = path.join(folder, 'index.ts');
    const hasBarrel = fs.existsSync(indexPath);

    // Files that are imported from by other files (not just same file)
    const filesWithExternalImports = new Set<string>();
    for (const e of folderEntities) {
      if (e.references.some((r) => r.scope !== 'same_file')) {
        filesWithExternalImports.add(e.filePath);
      }
    }

    // Count exported symbols in this folder
    const exportedCount = folderEntities.filter((e) => e.isExported).length;

    // 1. Suggest barrel for folders with multiple exported symbols but no index.ts
    if (!hasBarrel && exportedCount >= 3) {
      recs.push({
        type: 'introduce_barrel',
        filePath: indexPath,
        line: 0,
        entityName: path.basename(folder),
        message: `Folder '${path.basename(folder)}' has ${exportedCount} exported symbols across ${filesWithExternalImports.size} files but no index.ts — consider creating a barrel file to define a clean public API`,
      });
    }

    // 2. Suggest barrel for folders where multiple files are imported from externally
    if (!hasBarrel && filesWithExternalImports.size >= 2) {
      recs.push({
        type: 'introduce_barrel',
        filePath: indexPath,
        line: 0,
        entityName: path.basename(folder),
        message: `Folder '${path.basename(folder)}' has ${filesWithExternalImports.size} files imported from outside — an index.ts would consolidate the public API surface`,
      });
    }

    // 3. Suggest routing through existing barrel for deep imports
    if (hasBarrel) {
      for (const e of folderEntities) {
        const hasDeepImports = e.references.some(
          (r) =>
            r.scope === 'sub_dir_deep' ||
            r.scope === 'sibling_deep' ||
            (r.kind === 'import' && !r.isBarrel)
        );
        if (hasDeepImports && e.refCount > 0) {
          recs.push({
            type: 'route_through_barrel',
            filePath: e.filePath,
            line: e.line,
            entityName: e.name,
            message: `${e.kind} '${e.name}' in '${path.basename(folder)}' is imported via deep path — consider re-exporting from index.ts and routing imports through the barrel`,
          });
        }
      }
    }
  }

  return recs;
}

// ── Main analysis ────────────────────────────────────────────────────────────

export async function analyzeDeadCodeAsync(
  tsconfigPath: string,
  skipDirs: Set<string> = DEFAULT_SKIP_DIRS
): Promise<AnalysisResult> {
  const rootDir = path.dirname(tsconfigPath);

  process.stderr.write(`Loading tsconfig: ${tsconfigPath}\n`);
  const { excludePatterns } = loadTsconfig(tsconfigPath);

  process.stderr.write('Building TypeScript program...\n');
  const program = buildProgram(tsconfigPath);

  const allDiagnostics = ts.getPreEmitDiagnostics(program);
  const errors = allDiagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    process.stderr.write(`\n⚠ ${errors.length} compile error(s) found in program:\n`);
    for (const diag of errors.slice(0, 20)) {
      const msg = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
      const file = diag.file;
      const loc = file
        ? `${file.fileName}:${file.getLineAndCharacterOfPosition(diag.start!).line + 1}`
        : 'unknown';
      process.stderr.write(`  ${loc}: ${msg}\n`);
    }
    if (errors.length > 20) process.stderr.write(`  ... and ${errors.length - 20} more\n`);
    process.stderr.write('\n');
  }

  process.stderr.write('Collecting dev dependencies...\n');
  const devDeps = collectDevDeps(rootDir);
  process.stderr.write(`Found ${devDeps.size} dev dependency packages\n`);

  process.stderr.write('Classifying source files...\n');
  const { prodFiles, testFiles } = getProdSourceFiles(program, excludePatterns, skipDirs, devDeps);
  const checker = program.getTypeChecker();

  process.stderr.write(
    `Analyzing ${prodFiles.size} prod files (${testFiles.size} test files excluded)...\n`
  );

  const symbolMap = new Map<
    ts.Symbol,
    { exportFile: string; exportName: string; isReExport: boolean }
  >();

  process.stderr.write('  Collecting exported symbols...\n');
  for (const [filePath, sourceFile] of prodFiles) {
    const moduleSymbol = getModuleSymbol(sourceFile, checker);
    if (!moduleSymbol) continue;
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const resolved = resolveAlias(symbol, checker);
      const isReExport = resolved !== symbol;
      if (!symbolMap.has(resolved)) {
        symbolMap.set(resolved, {
          exportFile: filePath,
          exportName: symbol.escapedName.toString(),
          isReExport,
        });
      }
    }
  }

  process.stderr.write(`  Found ${symbolMap.size} unique exported symbols\n`);

  // Single-pass: walk all files once, collect all symbol→references
  process.stderr.write('  Scanning all files for references...\n');
  const allRefs = collectAllReferencesOnce(checker, prodFiles, rootDir);

  process.stderr.write('  Building entities...\n');
  const entities: SymbolEntity[] = [];
  let idx = 0;

  for (const [symbol, exportInfo] of symbolMap) {
    const decl = symbol.declarations?.[0];
    if (!decl) continue;
    const declFile = decl.getSourceFile();
    const declFilePath = declFile.fileName;
    const declLine = declFile.getLineAndCharacterOfPosition(decl.getStart(declFile)).line + 1;

    const rawRefs = allRefs.get(symbol) ?? [];
    const refs = filterDeclarationPositions(rawRefs, symbol);

    let score = 0;
    const byScope: Record<ScopeLevel, number> = {
      same_file: 0,
      same_folder: 0,
      sub_dir_barrel: 0,
      sub_dir_deep: 0,
      parent_barrel: 0,
      sibling_barrel: 0,
      sibling_deep: 0,
      cross_package: 0,
    };
    const byKind: Record<ReferenceKind, number> = {
      value: 0,
      type: 0,
      implements: 0,
      extends: 0,
      export: 0,
      import: 0,
      other: 0,
    };

    for (const ref of refs) {
      score += ref.score;
      byScope[ref.scope]++;
      byKind[ref.kind]++;
    }

    const fanInFiles = new Set(refs.map((r) => r.filePath));

    entities.push({
      entityId: `${declFilePath}#${symbol.escapedName}`,
      filePath: declFilePath,
      packageName: getPackageName(declFilePath, rootDir),
      folder: getFolder(declFilePath),
      name: symbol.escapedName.toString(),
      kind: getSymbolKind(symbol),
      line: declLine,
      isExported: true,
      isReExport: exportInfo.isReExport,
      references: refs,
      refCount: refs.length,
      score,
      scoreBreakdown: { byScope, byKind },
      fanIn: fanInFiles.size,
      fanOut: 0,
      implementers: [],
      implementsInterfaces: [],
      deadParameters: [],
      members: [],
      deadMembers: [],
    });

    idx++;
    if (idx % 100 === 0 || idx === symbolMap.size) {
      const pct = ((idx / symbolMap.size) * 100).toFixed(0);
      process.stderr.write(`    \r    ${idx}/${symbolMap.size} symbols processed (${pct}%)`);
    }
  }
  process.stderr.write('\n');

  // Post-processing
  process.stderr.write('  Post-processing: members, interfaces, dead params, fan-out...\n');

  // Collect members for interfaces, classes, and type aliases
  let totalMembersCollected = 0;
  let totalDeadMembers = 0;
  for (const entity of entities) {
    if (entity.kind !== 'interface' && entity.kind !== 'class' && entity.kind !== 'type_alias')
      continue;
    // Find the original symbol from symbolMap by matching name + file
    let targetSymbol: ts.Symbol | undefined;
    for (const [s, info] of symbolMap) {
      if (info.exportName === entity.name && info.exportFile === entity.filePath) {
        targetSymbol = s;
        break;
      }
    }
    if (!targetSymbol) continue;
    const members = collectMembers(targetSymbol, checker, prodFiles, rootDir);
    entity.members = members;
    entity.deadMembers = members.filter((m) => m.refCount === 0);
    totalMembersCollected += members.length;
    totalDeadMembers += entity.deadMembers.length;
  }

  process.stderr.write(`  Collected ${totalMembersCollected} members (${totalDeadMembers} dead)\n`);

  // Interface implementers — scan all class declarations for `implements InterfaceName`
  for (const entity of entities) {
    if (entity.kind !== 'interface') continue;
    for (const sourceFile of program.getSourceFiles()) {
      if (!prodFiles.has(sourceFile.fileName)) continue;
      ts.forEachChild(sourceFile, function visit(node: ts.Node) {
        if (ts.isClassDeclaration(node) && node.heritageClauses) {
          for (const clause of node.heritageClauses) {
            if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
              for (const expr of clause.types) {
                if (ts.isIdentifier(expr.expression) && expr.expression.text === entity.name) {
                  const implEntity = entities.find(
                    (e) =>
                      e.filePath === sourceFile.fileName &&
                      e.name === node.name?.text &&
                      e.kind === 'class'
                  );
                  if (implEntity) {
                    entity.implementers.push({
                      entityId: implEntity.entityId,
                      name: implEntity.name,
                      filePath: implEntity.filePath,
                    });
                  }
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      });
    }
  }

  // Implements interfaces
  const entityBySymbol = new Map<ts.Symbol, SymbolEntity>();
  for (const entity of entities) {
    const declFile = prodFiles.get(entity.filePath);
    if (!declFile) continue;
    const moduleSymbol = getModuleSymbol(declFile, checker);
    if (!moduleSymbol) continue;
    for (const sym of checker.getExportsOfModule(moduleSymbol)) {
      const resolved = resolveAlias(sym, checker);
      if (resolved.escapedName === entity.name) {
        entityBySymbol.set(resolved, entity);
        break;
      }
    }
  }

  for (const entity of entities) {
    if (entity.kind !== 'class') continue;
    const declFile = prodFiles.get(entity.filePath);
    if (!declFile) continue;
    const moduleSymbol = getModuleSymbol(declFile, checker);
    if (!moduleSymbol) continue;
    for (const sym of checker.getExportsOfModule(moduleSymbol)) {
      const resolved = resolveAlias(sym, checker);
      if (resolved.escapedName !== entity.name || !(ts.SymbolFlags.Class & resolved.flags))
        continue;
      const classType = checker.getTypeOfSymbolAtLocation(resolved, resolved.declarations![0]);
      const classTypeFlags = classType.flags;
      if (classTypeFlags & ts.TypeFlags.Object) {
        const objType = classType as ts.ObjectType;
        const baseTypes = objType.getBaseTypes?.();
        if (!baseTypes) continue;
        for (const baseType of baseTypes) {
          const baseSymbol = baseType.symbol;
          if (!baseSymbol) continue;
          const baseEntity = entityBySymbol.get(baseSymbol);
          if (baseEntity) {
            entity.implementsInterfaces.push({
              entityId: baseEntity.entityId,
              name: baseEntity.name,
              filePath: baseEntity.filePath,
            });
          }
        }
      }
    }
  }

  // Dead parameters
  for (const [filePath, sourceFile] of prodFiles) {
    const deadParams = findDeadParameters(sourceFile, checker);
    if (deadParams.length === 0) continue;
    const entity = entities.find((e) => e.filePath === filePath);
    if (entity) entity.deadParameters.push(...deadParams);
  }

  // Fan-out
  for (const entity of entities) {
    const referencedEntityIds = new Set<string>();
    for (const other of entities) {
      for (const ref of other.references) {
        if (ref.filePath === entity.filePath) referencedEntityIds.add(other.entityId);
      }
    }
    entity.fanOut = referencedEntityIds.size;
  }

  const deadEntities = entities.filter((e) => e.isExported && e.refCount === 0);

  process.stderr.write('  Generating recommendations...\n');
  const recommendations = generateRecommendations(entities, deadEntities, rootDir);

  // Summary
  const byKind: Record<string, { total: number; dead: number }> = {};
  const byPackage: Record<string, { total: number; dead: number }> = {};
  for (const e of entities) {
    byKind[e.kind] = byKind[e.kind] || { total: 0, dead: 0 };
    byKind[e.kind].total++;
    byPackage[e.packageName] = byPackage[e.packageName] || { total: 0, dead: 0 };
    byPackage[e.packageName].total++;
  }
  for (const e of deadEntities) {
    byKind[e.kind].dead++;
    byPackage[e.packageName].dead++;
  }

  const sameFileOnly = entities.filter(
    (e) => e.refCount > 0 && e.references.every((r) => r.scope === 'same_file')
  ).length;
  const sameFolderOnly =
    entities.filter(
      (e) =>
        e.refCount > 0 &&
        e.references.every((r) => r.scope === 'same_file' || r.scope === 'same_folder')
    ).length - sameFileOnly;
  const samePackageOnly =
    entities.filter((e) => e.refCount > 0 && !e.references.some((r) => r.scope === 'cross_package'))
      .length -
    sameFileOnly -
    sameFolderOnly;
  const crossPackage = entities.filter((e) =>
    e.references.some((r) => r.scope === 'cross_package')
  ).length;

  return {
    rootDir,
    tsconfig: tsconfigPath,
    prodFileCount: prodFiles.size,
    testFileCount: testFiles.size,
    entities,
    deadEntities,
    recommendations,
    summary: {
      total: entities.length,
      dead: deadEntities.length,
      exported: entities.filter((e) => e.isExported).length,
      deadExported: deadEntities.length,
      byKind,
      byPackage,
      byScope: {
        same_file_only: sameFileOnly,
        same_folder_only: sameFolderOnly,
        same_package_only: samePackageOnly,
        cross_package: crossPackage,
      },
    },
  };
}
