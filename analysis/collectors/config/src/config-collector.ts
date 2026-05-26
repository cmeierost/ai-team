/**
 * Config collector — discovers and analyses config/tooling files in a project.
 *
 * Produces entities and relationships for package.json, tsconfig.json, and
 * other config files. These are classified as "infrastructure" artifacts,
 * separate from runtime code.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import type { Entity, Relationship, FileInventoryEntry } from '@aspect/contracts';
import { parsePackageJson, parseTsConfig, parseGenericConfig } from './config-parser.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ConfigCollectorOptions {
  rootDir: string;
  srcDirs?: string[];
  excludeDirs?: string[];
}

export interface ConfigCollectionResult {
  entities: Entity[];
  relationships: Relationship[];
  fileInventory: FileInventoryEntry[];
}

// ── File routing ────────────────────────────────────────────────────────────

type ConfigKind = 'package-json' | 'tsconfig' | 'generic';

const CONFIG_PATTERNS: Array<{ test: (name: string) => boolean; kind: ConfigKind }> = [
  { test: (n) => n === 'package.json', kind: 'package-json' },
  { test: (n) => n.startsWith('tsconfig') && n.endsWith('.json'), kind: 'tsconfig' },
  { test: (n) => /^\.?(eslint|prettier|babel|jest|vitest|stylelint|postcss|tailwind)/i.test(n), kind: 'generic' },
  { test: (n) => n.endsWith('.config.json') || n.endsWith('.config.jsonc'), kind: 'generic' },
];

function classifyConfigFile(fileName: string): ConfigKind | null {
  for (const p of CONFIG_PATTERNS) {
    if (p.test(fileName)) return p.kind;
  }
  return null;
}

// ── Discovery ───────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'build', 'out', 'coverage', '.next', '.nuxt']);

function discoverConfigFiles(rootDir: string, srcDirs: string[], excludeDirs: Set<string>): string[] {
  const results: string[] = [];

  function walk(dir: string, depth: number): void {
    // Only walk 3 levels deep for config files (they're usually at root or one level down)
    if (depth > 3) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (!SKIP_DIRS.has(entry) && !excludeDirs.has(entry)) {
          walk(fullPath, depth + 1);
        }
      } else if (stat.isFile()) {
        const kind = classifyConfigFile(entry);
        if (kind != null) {
          results.push(fullPath);
        }
      }
    }
  }

  for (const srcDir of srcDirs) {
    walk(join(rootDir, srcDir), 0);
  }

  return results;
}

// ── Collector entry point ───────────────────────────────────────────────────

export function collectConfig(options: ConfigCollectorOptions): ConfigCollectionResult {
  const { rootDir, srcDirs = ['.'], excludeDirs = [] } = options;
  const excludeSet = new Set(excludeDirs);

  const configFiles = discoverConfigFiles(rootDir, srcDirs, excludeSet);

  const allEntities: Entity[] = [];
  const allRelationships: Relationship[] = [];
  const fileInventory: FileInventoryEntry[] = [];

  for (const absPath of configFiles) {
    const relativePath = relative(rootDir, absPath).replace(/\\/g, '/');
    const fileName = basename(absPath);
    const kind = classifyConfigFile(fileName);
    if (!kind) continue;

    let content: string;
    try {
      content = readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }

    let result;
    switch (kind) {
      case 'package-json':
        result = parsePackageJson(content, relativePath);
        break;
      case 'tsconfig':
        result = parseTsConfig(content, relativePath);
        break;
      case 'generic':
        result = parseGenericConfig(content, relativePath);
        break;
    }

    allEntities.push(...result.entities);
    allRelationships.push(...result.relationships);

    const lines = content.split('\n');
    fileInventory.push({
      filePath: relativePath,
      fileCategory: 'config',
      isAnalyzedLanguage: true,
      fileSizeBytes: Buffer.byteLength(content, 'utf-8'),
      totalLines: lines.length,
      blankLines: lines.filter(l => l.trim() === '').length,
      commentLines: null,
      importExportOnlyLines: null,
    });
  }

  return { entities: allEntities, relationships: allRelationships, fileInventory };
}
