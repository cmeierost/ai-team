/**
 * File ignore patterns — mirrors OpenCode's file/ignore.ts.
 * Used to skip irrelevant paths during workspace scans, file search,
 * and the @parcel/watcher subscription.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import ignore from 'ignore';

export namespace FileIgnore {
  const FOLDERS = new Set([
    'node_modules',
    'bower_components',
    '.pnpm-store',
    'vendor',
    '.npm',
    'dist',
    'build',
    'out',
    '.next',
    'target',
    'bin',
    'obj',
    '.git',
    '.svn',
    '.hg',
    '.vscode',
    '.idea',
    '.turbo',
    '.output',
    '.sst',
    '.cache',
    '.webkit-cache',
    '__pycache__',
    '.pytest_cache',
    'mypy_cache',
    '.history',
    '.gradle',
  ]);

  const FILES = [
    '**/*.swp',
    '**/*.swo',
    '**/*.pyc',
    '**/.DS_Store',
    '**/Thumbs.db',
    '**/logs/**',
    '**/tmp/**',
    '**/temp/**',
    '**/*.log',
    '**/coverage/**',
    '**/.nyc_output/**',
  ];

  /** Combined pattern list suitable for @parcel/watcher `ignore:` option */
  export const PATTERNS = [...FILES, ...FOLDERS];

  /**
   * Returns true if the given filepath should be ignored.
   * Checks folder segments first, then glob patterns.
   */
  export function match(
    filepath: string,
    opts?: {
      extra?: string[];
      whitelist?: string[];
    },
  ): boolean {
    for (const pattern of opts?.whitelist ?? []) {
      const { minimatch } = require('minimatch') as typeof import('minimatch');
      if (minimatch(filepath, pattern)) return false;
    }

    const parts = filepath.split(/[/\\]/);
    for (const part of parts) {
      if (FOLDERS.has(part)) return true;
    }

    const extra = opts?.extra ?? [];
    const { minimatch } = require('minimatch') as typeof import('minimatch');
    for (const pattern of [...FILES, ...extra]) {
      if (minimatch(filepath, pattern)) return true;
    }

    return false;
  }

  /**
   * Build a programmatic ignore checker from the .gitignore (and .ignore)
   * file in the given workspace root.
   * Returns a function that takes a workspace-relative path and returns
   * true if the path should be ignored.
   */
  export async function fromGitignore(
    workspaceRoot: string,
  ): Promise<(relPath: string) => boolean> {
    const ig = ignore();

    for (const filename of ['.gitignore', '.ignore']) {
      const filePath = path.join(workspaceRoot, filename);
      try {
        const contents = await fs.readFile(filePath, 'utf8');
        ig.add(contents);
      } catch {
        // file doesn't exist — that's fine
      }
    }

    return (relPath: string) => ig.ignores(relPath);
  }
}
