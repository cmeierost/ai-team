import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import type { Entity, Relationship, FileInventoryEntry } from '@aspect/contracts';
import { parseMarkdownFile } from './md-parser.js';

// ── Public types ────────────────────────────────────────────────────────────

export interface MarkdownCollectorOptions {
  rootDir: string;
  srcDirs?: string[];
  includePatterns?: string[];
  excludePatterns?: string[];
}

export interface MarkdownCollectionResult {
  entities: Entity[];
  relationships: Relationship[];
  fileInventory: FileInventoryEntry[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function matchesGlob(filePath: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '[^/\\\\]*')
    .replace(/<<GLOBSTAR>>/g, '.*');
  return new RegExp(`^${regexStr}$`).test(filePath.replace(/\\/g, '/'));
}

function discoverFiles(
  rootDir: string,
  srcDirs: string[],
  includePatterns: string[],
  excludePatterns: string[],
): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      const rel = relative(rootDir, full).replace(/\\/g, '/');
      const excluded = excludePatterns.some((p) => matchesGlob(rel, p));
      if (excluded) continue;

      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        const included = includePatterns.some((p) => matchesGlob(rel, p));
        if (included) results.push(rel);
      }
    }
  }

  for (const srcDir of srcDirs) {
    walk(join(rootDir, srcDir));
  }
  return results;
}

// ── Main collector ──────────────────────────────────────────────────────────

export function collectMarkdown(options: MarkdownCollectorOptions): MarkdownCollectionResult {
  const {
    rootDir,
    srcDirs = ['.'],
    includePatterns = ['**/*.md', '**/*.mdx'],
    excludePatterns = ['node_modules/**', 'dist/**', '.git/**'],
  } = options;

  const filePaths = discoverFiles(rootDir, srcDirs, includePatterns, excludePatterns);

  const allEntities: Entity[] = [];
  const allRelationships: Relationship[] = [];
  const fileInventory: FileInventoryEntry[] = [];

  for (const relPath of filePaths) {
    const absPath = join(rootDir, relPath);
    const content = readFileSync(absPath, 'utf-8');
    const stat = statSync(absPath);

    const { entities, relationships } = parseMarkdownFile(content, relPath);
    allEntities.push(...entities);
    allRelationships.push(...relationships);

    const lines = content.split('\n');
    const totalLines = lines.length;
    const blankLines = lines.filter((l) => l.trim() === '').length;

    fileInventory.push({
      filePath: relPath,
      fileCategory: 'docs',
      isAnalyzedLanguage: true,
      fileSizeBytes: stat.size,
      totalLines,
      blankLines,
      commentLines: null,
      importExportOnlyLines: null,
    });
  }

  return { entities: allEntities, relationships: allRelationships, fileInventory };
}
