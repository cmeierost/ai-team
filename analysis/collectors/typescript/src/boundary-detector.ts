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

    let name: string | undefined;
    try {
      const json = JSON.parse(readFileSync(absPath, 'utf-8'));
      name = json.name;
    } catch {
      // unreadable / invalid JSON — skip
      return;
    }

    results.push({
      moduleId: name ?? modPath,
      modulePath: modPath,
      kind: 'package',
      isPackage: true,
    });
  }

  // Check rootDir itself for workspaces
  const rootPkg = join(rootDir, 'package.json');
  if (existsSync(rootPkg)) {
    try {
      const json = JSON.parse(readFileSync(rootPkg, 'utf-8'));
      if (Array.isArray(json.workspaces)) {
        for (const pattern of json.workspaces as string[]) {
          // Simple glob: only support trailing /* or /**
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
      }
    } catch {
      // skip
    }
  }

  // Walk each srcDir
  for (const srcDir of srcDirs) {
    const abs = resolveSrcDir(rootDir, srcDir);
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
