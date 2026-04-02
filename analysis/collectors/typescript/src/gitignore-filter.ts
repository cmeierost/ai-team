import { readFileSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import ignore, { type Ignore } from 'ignore';

export interface PathFilter {
  /** Returns true if the path should be EXCLUDED (is ignored) */
  isIgnored(filePath: string): boolean;
  /** Filter an array of paths, returning only non-ignored ones */
  filter(filePaths: string[]): string[];
}

/**
 * Build a path filter from .gitignore files.
 * Reads .gitignore from rootDir and optionally from nested directories.
 * Also adds default exclusions that should always be filtered.
 */
export function buildPathFilter(rootDir: string): PathFilter {
  const ig: Ignore = ignore();

  // Default exclusions — always filter these even if not in .gitignore
  ig.add([
    'node_modules/',
    '**/node_modules/',
    'dist/',
    '**/dist/',
    'build/',
    '**/build/',
    'out/',
    '**/out/',
    '.git/',
    '**/*.js.map',
  ]);

  // Read .gitignore from rootDir
  const gitignorePath = join(rootDir, '.gitignore');
  if (existsSync(gitignorePath)) {
    try {
      const content = readFileSync(gitignorePath, 'utf-8');
      ig.add(content);
    } catch {
      // ignore read errors
    }
  }

  // Also check for nested .gitignore files in common locations
  for (const subdir of ['packages', 'analysis']) {
    const subGitignore = join(rootDir, subdir, '.gitignore');
    if (existsSync(subGitignore)) {
      try {
        const content = readFileSync(subGitignore, 'utf-8');
        // Prefix patterns with the subdirectory
        const prefixed = content
          .split('\n')
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return line;
            return `${subdir}/${trimmed}`;
          })
          .join('\n');
        ig.add(prefixed);
      } catch {
        // ignore
      }
    }
  }

  return {
    isIgnored(filePath: string): boolean {
      // Normalize: resolve to relative path from rootDir, use forward slashes
      let normalized = filePath.replace(/\\/g, '/');

      // If absolute, make relative to rootDir
      if (isAbsolute(filePath)) {
        normalized = relative(rootDir, filePath).replace(/\\/g, '/');
      }

      // Skip empty or current-dir paths
      if (!normalized || normalized === '.') return false;

      // Paths starting with ../ are outside rootDir — always exclude
      if (normalized.startsWith('../')) return true;

      // Bare names without '/' or '.' (e.g., 'path', 'fs') are Node builtins — exclude
      if (!normalized.includes('/') && !normalized.includes('.')) return true;

      return ig.ignores(normalized);
    },

    filter(filePaths: string[]): string[] {
      return filePaths.filter((p) => !this.isIgnored(p));
    },
  };
}
