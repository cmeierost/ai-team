/**
 * Production/test file classification — shared utilities for the reference-graph collector.
 *
 * Decides which files participate in reference counting. Files that import dev
 * dependencies (vitest, jest, etc.) are classified as test files and excluded.
 */

import * as path from 'node:path';
import * as ts from 'typescript';

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
export function collectDevDeps(rootDir: string): Set<string> {
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

/**
 * Check if a source file imports from any dev dependency package.
 * Detects top-level `import` / `export` statements, dynamic `import('foo')`,
 * and `require('foo')` with literal arguments.
 */
export function importsDevDeps(sourceFile: ts.SourceFile, devDeps: Set<string>): boolean {
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

  function checkDynamicImport(node: ts.Node): boolean {
    // Dynamic import: `import('foo')` — CallExpression with identifier 'import'
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'import') {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        const mod = arg.text;
        for (const dep of devDeps) {
          if (mod === dep || mod.startsWith(dep + '/')) return true;
        }
      }
    }
    // require('foo') — CallExpression with identifier 'require'
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        const mod = arg.text;
        for (const dep of devDeps) {
          if (mod === dep || mod.startsWith(dep + '/')) return true;
        }
      }
    }
    return false;
  }

  let found = false;
  function visit(n: ts.Node): void {
    if (found) return;
    if (checkImportClause(n) || checkDynamicImport(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(sourceFile);
  return found;
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