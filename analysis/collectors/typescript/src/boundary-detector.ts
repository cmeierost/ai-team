/**
 * Auto-detect module boundaries from TypeScript/JavaScript codebase structure.
 *
 * Three detection strategies:
 *   1. **package** — package.json files (including monorepo workspaces)
 *   2. **facade**  — index.ts / index.tsx files that re-export symbols
 *   3. **directory** — directories at a configurable depth
 */

import { type Dirent, readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative, dirname, basename, isAbsolute } from 'node:path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DetectedBoundary {
  moduleId: string;
  modulePath: string;
  kind: 'package' | 'directory' | 'facade';
  isPackage: boolean;
  /** True when package.json signals this is a runnable application, not a library. */
  isApp?: boolean;
  /** Why this package is classified as an app. Only set when isApp is true. */
  appKind?: 'cli' | 'server' | 'extension' | 'web-app';
  /** Entry points resolved from package.json manifest fields. */
  entryPoints?: DetectedEntryPoint[];
}

export interface DetectedEntryPoint {
  /** Source file path (relative to repo root). */
  file: string;
  /** How this entry point was declared. */
  kind: 'bin' | 'main' | 'exports' | 'browser';
  /** True when this entry point is an app root (not a library export). */
  isAppEntry: boolean;
  /** Optional name (bin command name or exports subpath). */
  name?: string;
}

export interface PackageDetectionOptions {
  rootDir: string;
  srcDirs: string[];
}

export interface FacadeDetectionOptions {
  rootDir: string;
  srcDirs: string[];
  /** Minimum number of re-exports to qualify as a facade (default: 1) */
  minExports?: number;
}

export interface DirectoryDetectionOptions {
  rootDir: string;
  srcDirs: string[];
  /** Directory depth from each srcDir root to use as boundaries (default: 1) */
  depth?: number;
}

export interface BoundaryDetectionOptions {
  rootDir: string;
  srcDirs: string[];
  /** Enable package.json detection (default: true) */
  detectPackages?: boolean;
  /** Enable index.ts facade detection (default: true) */
  detectFacades?: boolean;
  /** Enable directory depth detection (default: false) */
  detectDirectories?: boolean;
  /** Directory depth for directory detection (default: 1) */
  directoryDepth?: number;
  /** Minimum re-exports for facade detection (default: 1) */
  minFacadeExports?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'dist']);

function toForwardSlash(p: string): string {
  return p.replace(/\\/g, '/');
}

function isHidden(name: string): boolean {
  return name.startsWith('.');
}

function shouldSkipDir(name: string): boolean {
  return isHidden(name) || SKIP_DIRS.has(name);
}

/** Resolve a srcDir to an absolute path.  Handles both absolute and relative-to-root. */
function resolveSrcDir(rootDir: string, srcDir: string): string {
  return isAbsolute(srcDir) ? srcDir : resolve(rootDir, srcDir);
}

function relFromRoot(rootDir: string, absPath: string): string {
  const r = toForwardSlash(relative(rootDir, absPath));
  return r === '' ? '.' : r;
}

/**
 * Recursively walk a directory, calling `visitor` on every file / directory.
 * Skips hidden dirs, node_modules, and dist.
 */
function walk(dir: string, visitor: (absPath: string, isDir: boolean) => void): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf-8' }) as Dirent<string>[];
  } catch {
    return; // unreadable directory — skip silently
  }

  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDir(entry.name)) continue;
      visitor(abs, true);
      walk(abs, visitor);
    } else if (entry.isFile()) {
      visitor(abs, false);
    }
  }
}

// ---------------------------------------------------------------------------
// 1. Package boundaries
// ---------------------------------------------------------------------------

export function detectPackageBoundaries(options: PackageDetectionOptions): DetectedBoundary[] {
  const { rootDir, srcDirs } = options;
  const seen = new Set<string>();
  const results: DetectedBoundary[] = [];

  function processPackageJson(absPath: string): void {
    const dir = dirname(absPath);
    const modPath = relFromRoot(rootDir, dir);
    if (seen.has(modPath)) return;
    seen.add(modPath);

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(readFileSync(absPath, 'utf-8'));
    } catch {
      return;
    }

    const name = typeof json.name === 'string' ? json.name : undefined;
    const appKind = detectAppKind(json);
    const isApp = appKind !== undefined;
    const entryPoints = extractEntryPoints(json, dir, rootDir, isApp);

    results.push({
      moduleId: name ?? modPath,
      modulePath: modPath,
      kind: 'package',
      isPackage: true,
      isApp: isApp || undefined,
      appKind,
      entryPoints: entryPoints.length > 0 ? entryPoints : undefined,
    });
  }

  // Check rootDir for workspace definitions (npm/yarn workspaces + pnpm)
  const workspacePatterns: string[] = [];

  const rootPkg = join(rootDir, 'package.json');
  if (existsSync(rootPkg)) {
    try {
      const json = JSON.parse(readFileSync(rootPkg, 'utf-8'));
      if (Array.isArray(json.workspaces)) {
        workspacePatterns.push(...json.workspaces as string[]);
      }
    } catch { /* skip */ }
  }

  // pnpm-workspace.yaml support
  const pnpmWs = join(rootDir, 'pnpm-workspace.yaml');
  if (existsSync(pnpmWs)) {
    try {
      const yaml = readFileSync(pnpmWs, 'utf-8');
      // Simple YAML list parser: lines starting with "  - " under "packages:"
      let inPackages = false;
      for (const line of yaml.split('\n')) {
        if (/^packages\s*:/.test(line)) { inPackages = true; continue; }
        if (inPackages && /^\s+-\s+/.test(line)) {
          const val = line.replace(/^\s+-\s+/, '').replace(/['"]/g, '').trim();
          if (val) workspacePatterns.push(val);
        } else if (inPackages && /^\S/.test(line)) {
          inPackages = false;
        }
      }
    } catch { /* skip */ }
  }

  for (const pattern of workspacePatterns) {
    const clean = pattern.replace(/\/?\*\*?$/, '').replace(/\/?\*$/, '');
    const wsDir = join(rootDir, clean);
    if (!existsSync(wsDir)) continue;
    try {
      const children = readdirSync(wsDir, { withFileTypes: true, encoding: 'utf-8' }) as Dirent<string>[];
      for (const child of children) {
        if (!child.isDirectory() || shouldSkipDir(child.name)) continue;
        const candidatePkg = join(wsDir, child.name, 'package.json');
        if (existsSync(candidatePkg)) {
          processPackageJson(candidatePkg);
        }
      }
    } catch {
      // skip unreadable workspace dir
    }
  }

  // Walk each srcDir
  for (const srcDir of srcDirs) {
    const abs = resolveSrcDir(rootDir, srcDir);

    // Check parent dir — handles srcDirs like "packages/cli/src" where
    // package.json is at "packages/cli/package.json"
    const parentCandidate = join(dirname(abs), 'package.json');
    if (existsSync(parentCandidate)) {
      processPackageJson(parentCandidate);
    }

    // Check srcDir root itself
    const rootCandidate = join(abs, 'package.json');
    if (existsSync(rootCandidate)) {
      processPackageJson(rootCandidate);
    }

    walk(abs, (path, isDir) => {
      if (!isDir && basename(path) === 'package.json') {
        processPackageJson(path);
      }
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// 2. Facade boundaries
// ---------------------------------------------------------------------------

const RE_EXPORT_PATTERNS = [
  /export\s+\*\s+from\s+['"][^'"]+['"]/g,
  /export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"]/g,
];

function countReExports(content: string): number {
  let count = 0;
  for (const pattern of RE_EXPORT_PATTERNS) {
    // Reset lastIndex for global regex reuse
    pattern.lastIndex = 0;
    const matches = content.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

export function detectFacadeBoundaries(options: FacadeDetectionOptions): DetectedBoundary[] {
  const { rootDir, srcDirs, minExports = 1 } = options;
  const seen = new Set<string>();
  const results: DetectedBoundary[] = [];

  for (const srcDir of srcDirs) {
    const absSrc = resolveSrcDir(rootDir, srcDir);

    walk(absSrc, (absPath, isDir) => {
      if (isDir) return;
      const name = basename(absPath);
      if (name !== 'index.ts' && name !== 'index.tsx') return;

      const dir = dirname(absPath);

      // Skip root index (direct child of a srcDir)
      if (toForwardSlash(dir) === toForwardSlash(absSrc)) return;

      const modPath = relFromRoot(rootDir, dir);
      if (seen.has(modPath)) return;

      let content: string;
      try {
        content = readFileSync(absPath, 'utf-8');
      } catch {
        return;
      }

      const reExportCount = countReExports(content);
      if (reExportCount >= minExports) {
        seen.add(modPath);
        results.push({
          moduleId: modPath,
          modulePath: modPath,
          kind: 'facade',
          isPackage: false,
        });
      }
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// 3. Directory boundaries
// ---------------------------------------------------------------------------

export function detectDirectoryBoundaries(options: DirectoryDetectionOptions): DetectedBoundary[] {
  const { rootDir, srcDirs, depth = 1 } = options;
  const seen = new Set<string>();
  const results: DetectedBoundary[] = [];

  for (const srcDir of srcDirs) {
    const absSrc = resolveSrcDir(rootDir, srcDir);
    collectAtDepth(absSrc, depth, (absDir) => {
      const modPath = relFromRoot(rootDir, absDir);
      if (seen.has(modPath)) return;
      seen.add(modPath);
      results.push({
        moduleId: modPath,
        modulePath: modPath,
        kind: 'directory',
        isPackage: false,
      });
    });
  }

  return results;
}

function collectAtDepth(
  dir: string,
  remaining: number,
  cb: (absDir: string) => void,
): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf-8' }) as Dirent<string>[];
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || shouldSkipDir(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (remaining <= 1) {
      cb(abs);
    } else {
      collectAtDepth(abs, remaining - 1, cb);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Combined entry point
// ---------------------------------------------------------------------------

export function detectModuleBoundaries(options: BoundaryDetectionOptions): DetectedBoundary[] {
  const {
    rootDir,
    srcDirs,
    detectPackages = true,
    detectFacades = true,
    detectDirectories = false,
    directoryDepth = 1,
    minFacadeExports = 1,
  } = options;

  // Collect in priority order: package > facade > directory
  const byPath = new Map<string, DetectedBoundary>();

  if (detectPackages) {
    for (const b of detectPackageBoundaries({ rootDir, srcDirs })) {
      byPath.set(b.modulePath, b);
    }
  }

  if (detectFacades) {
    for (const b of detectFacadeBoundaries({ rootDir, srcDirs, minExports: minFacadeExports })) {
      if (!byPath.has(b.modulePath)) {
        byPath.set(b.modulePath, b);
      }
    }
  }

  if (detectDirectories) {
    for (const b of detectDirectoryBoundaries({ rootDir, srcDirs, depth: directoryDepth })) {
      if (!byPath.has(b.modulePath)) {
        byPath.set(b.modulePath, b);
      }
    }
  }

  return [...byPath.values()];
}

// ---------------------------------------------------------------------------
// 5. Entry point extraction from package.json
// ---------------------------------------------------------------------------

/** Source extensions to try when resolving a dist path back to source. */
const SRC_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/**
 * Resolve a manifest path (often pointing to dist/) back to its source file.
 * Returns the repo-relative source path, or undefined if not found.
 */
function resolveManifestPath(
  rawPath: string,
  pkgDir: string,
  rootDir: string,
): string | undefined {
  const clean = rawPath.replace(/^\.\//, '');

  // Try source remap first — manifest paths typically point to dist/
  const remaps: Array<[RegExp, string]> = [
    [/^dist\//, 'src/'],
    [/^build\//, 'src/'],
    [/^out\//, 'src/'],
    [/^lib\//, 'src/'],
  ];

  for (const [pattern, replacement] of remaps) {
    if (!pattern.test(clean)) continue;
    const srcRelative = clean.replace(pattern, replacement);

    // Strip .js/.cjs/.mjs and try each source extension
    const stripped = srcRelative.replace(/\.(js|cjs|mjs|d\.ts|d\.cts|d\.mts)$/, '');
    for (const ext of SRC_EXTENSIONS) {
      const candidate = join(pkgDir, stripped + ext);
      if (existsSync(candidate)) {
        return relFromRoot(rootDir, candidate);
      }
    }
    // Try the exact remapped path
    const exact = join(pkgDir, srcRelative);
    if (existsSync(exact) && !statSync(exact).isDirectory()) {
      return relFromRoot(rootDir, exact);
    }
  }

  // Fallback: try stripping extension and probing source extensions
  const strippedOriginal = clean.replace(/\.(js|cjs|mjs|d\.ts|d\.cts|d\.mts)$/, '');
  for (const ext of SRC_EXTENSIONS) {
    const candidate = join(pkgDir, strippedOriginal + ext);
    if (existsSync(candidate)) {
      return relFromRoot(rootDir, candidate);
    }
  }

  // Last resort: try path as-is (might already point to source)
  const asIs = join(pkgDir, clean);
  if (existsSync(asIs) && !statSync(asIs).isDirectory()) {
    return relFromRoot(rootDir, asIs);
  }

  return undefined;
}

type AppKind = 'cli' | 'server' | 'extension' | 'web-app';

/**
 * Detect whether a package.json describes an application (not a library).
 * Uses manifest signals only — no heuristics, no import graph.
 * Returns the app kind or undefined for libraries.
 */
function detectAppKind(json: Record<string, unknown>): AppKind | undefined {
  // Has bin → CLI application
  if (json.bin) return 'cli';

  // VS Code extension (has engines.vscode) — check before server-script
  const engines = json.engines as Record<string, string> | undefined;
  if (engines?.vscode) return 'extension';

  // Has scripts.start that runs a file → server application
  const scripts = json.scripts as Record<string, string> | undefined;
  if (scripts?.start && /\b(node|tsx?|ts-node)\b/.test(scripts.start)) return 'server';
  if (scripts?.serve && /\b(node|tsx?|ts-node)\b/.test(scripts.serve)) return 'server';

  // Bundled frontend app (vite, webpack, next, nuxt, angular in devDeps/deps + build script)
  const allDeps = {
    ...json.dependencies as Record<string, string> | undefined,
    ...json.devDependencies as Record<string, string> | undefined,
  };
  const bundlers = ['vite', 'webpack', 'next', 'nuxt', '@angular/cli', 'parcel', 'esbuild'];
  const hasBundler = bundlers.some((b) => b in allDeps);
  // Only if there's no main/exports (pure app, not a library that happens to use vite)
  if (hasBundler && !json.main && !json.exports) return 'web-app';

  return undefined;
}

/**
 * Extract entry points from a parsed package.json.
 * Generic — works on any Node.js/TypeScript package.
 * When isApp=true, main/exports entries are marked as app entries too.
 */
function extractEntryPoints(
  json: Record<string, unknown>,
  pkgDir: string,
  rootDir: string,
  isApp: boolean,
): DetectedEntryPoint[] {
  const result: DetectedEntryPoint[] = [];
  const seen = new Set<string>();

  // CLI packages: only bin entries are app entry points.
  // Other app kinds: main/exports/browser are the actual app entries.
  const hasBin = !!json.bin;
  const nonBinIsApp = isApp && !hasBin;

  function add(
    file: string | undefined,
    kind: DetectedEntryPoint['kind'],
    isAppEntry: boolean,
    name?: string,
  ): void {
    if (!file || seen.has(file)) return;
    seen.add(file);
    result.push({ file: file.replace(/\\/g, '/'), kind, isAppEntry, name });
  }

  // bin — always app entry points
  if (typeof json.bin === 'string') {
    add(resolveManifestPath(json.bin, pkgDir, rootDir), 'bin', true);
  } else if (json.bin && typeof json.bin === 'object') {
    for (const [cmd, target] of Object.entries(json.bin as Record<string, string>)) {
      add(resolveManifestPath(target, pkgDir, rootDir), 'bin', true, cmd);
    }
  }

  // main — app entry for non-CLI apps, library entry for CLIs/libraries
  if (typeof json.main === 'string') {
    add(resolveManifestPath(json.main, pkgDir, rootDir), 'main', nonBinIsApp);
  }

  // browser — browser-specific entry
  if (typeof json.browser === 'string') {
    add(resolveManifestPath(json.browser, pkgDir, rootDir), 'browser', nonBinIsApp);
  }

  // exports — conditional exports
  if (json.exports) {
    extractExportsEntries(json.exports, pkgDir, rootDir, seen, nonBinIsApp).forEach((ep) => result.push(ep));
  }

  // Web app heuristic: if it's a bundled app with no manifest entry points,
  // probe for common Vite/webpack/CRA entry files
  if (isApp && !hasBin && result.length === 0) {
    const webEntryNames = ['main.tsx', 'main.ts', 'main.jsx', 'main.js', 'index.tsx', 'index.ts', 'index.jsx', 'index.js'];
    for (const name of webEntryNames) {
      const candidate = join(pkgDir, 'src', name);
      if (existsSync(candidate)) {
        add(relFromRoot(rootDir, candidate), 'browser', true);
        break;
      }
    }
  }

  return result;
}

/**
 * Recursively extract file paths from package.json "exports" field.
 * Handles: string, {".":{...}}, {import, require, default, ...}
 */
function extractExportsEntries(
  exports: unknown,
  pkgDir: string,
  rootDir: string,
  seen: Set<string>,
  isApp: boolean,
  subpath?: string,
): DetectedEntryPoint[] {
  const result: DetectedEntryPoint[] = [];

  if (typeof exports === 'string') {
    const file = resolveManifestPath(exports, pkgDir, rootDir);
    if (file && !seen.has(file)) {
      seen.add(file);
      result.push({ file: file.replace(/\\/g, '/'), kind: 'exports', isAppEntry: isApp, name: subpath });
    }
    return result;
  }

  if (exports && typeof exports === 'object' && !Array.isArray(exports)) {
    for (const [key, value] of Object.entries(exports as Record<string, unknown>)) {
      if (key.startsWith('.')) {
        result.push(...extractExportsEntries(value, pkgDir, rootDir, seen, isApp, key));
      } else {
        if (key !== 'types') {
          result.push(...extractExportsEntries(value, pkgDir, rootDir, seen, isApp, subpath));
        }
      }
    }
  }

  return result;
}
