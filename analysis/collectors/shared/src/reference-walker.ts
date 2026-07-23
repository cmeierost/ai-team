/**
 * Symbol-level reference walker — shared utilities for the reference-graph collector.
 *
 * Wraps the TypeScript compiler API to walk all production source files and build
 * a scored, weighted reference map. Used by the reference-graph collector adapter
 * and the standalone dead-code CLI.
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

export const SCORE_MATRIX: Record<ReferenceKind, Record<ScopeLevel, number>> = {
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

// ── Symbol helpers ───────────────────────────────────────────────────────────

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

export function getSymbolKind(symbol: ts.Symbol): string {
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

export function getSymbolLine(symbol: ts.Symbol): number {
  const decl = symbol.declarations?.[0];
  if (!decl) return 0;
  const file = decl.getSourceFile();
  const pos = decl.getStart(file);
  return file.getLineAndCharacterOfPosition(pos).line + 1;
}

// ── Reference classification ─────────────────────────────────────────────────

export function classifyReferenceKind(node: ts.Node): ReferenceKind {
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

// ── Declaration detection ────────────────────────────────────────────────────

/**
 * Check if an identifier is part of a declaration (not a reference).
 * This filters out `function foo()`, `class Bar`, `const baz`, etc.
 * Import/export specifiers are NOT declarations — they're references of kind 'import'/'export'.
 */
export function isDeclarationIdentifier(node: ts.Identifier): boolean {
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

// ── Scope level determination ────────────────────────────────────────────────

const BARREL_BASENAMES = new Set(['index.ts', 'index.tsx', 'index.js', 'index.mjs']);

export function isBarrelFile(filePath: string): boolean {
  return BARREL_BASENAMES.has(path.basename(filePath));
}

export function getPackageName(filePath: string, rootDir: string): string {
  const rel = path.relative(rootDir, filePath).replaceAll('\\', '/');
  const parts = rel.split('/');
  if (parts[0] === 'packages' && parts.length >= 2) return parts[0] + '/' + parts[1];
  if (parts[0] === 'analysis' && parts.length >= 2) return parts[0] + '/' + parts[1];
  return parts[0] || '.';
}

export function determineScope(
  refFile: string,
  targetFile: string,
  rootDir: string
): ScopeLevel {
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
    const isBarrel = isBarrelFile(targetFile);
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
  const isBarrel = remaining !== '' && isBarrelFile(remaining);

  if (upLevels === 1) {
    if (!remaining || remaining === '') return 'parent_barrel';
    if (isBarrel) return 'sibling_barrel';
    return 'sibling_deep';
  }

  if (isBarrel) return 'sibling_barrel';
  return 'sibling_deep';
}

// ── Reference counting (single-pass) ─────────────────────────────────────────

/**
 * Walk all prod files once and build a symbol → references map.
 * O(n+m) — replaces the old O(n×m) approach (walk all files per symbol).
 */
export function collectAllReferencesOnce(
  checker: ts.TypeChecker,
  prodFiles: Map<string, ts.SourceFile>,
  rootDir: string,
  progressEvery: number = 50,
  onProgress?: (fileIdx: number, total: number) => void
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
        const isBarrel = isBarrelFile(targetFile);
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
    if (onProgress && (fileIdx % progressEvery === 0 || fileIdx === prodFiles.size)) {
      onProgress(fileIdx, prodFiles.size);
    }
  }

  return allRefs;
}

// ── Legacy: kept for member-level collection (smaller scale) ──────────────────

/**
 * Per-symbol reference walker. Used for class/interface members where the
 * single-pass collector's symbol identity doesn't always match.
 */
export function findAllReferences(
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
          const isBarrel = isBarrelFile(targetFile);
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

// ── tsconfig helpers ─────────────────────────────────────────────────────────

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