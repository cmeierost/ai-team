import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Entity, Relationship, FileInventoryEntry } from '@aspect/contracts';
import { parseStylesheet } from './css-parser.js';

export interface CssCollectorOptions {
  /** Directories to scan for CSS/SCSS/LESS files (absolute paths). */
  directories: string[];
  /** Root directory of the repository (for computing relative paths). */
  rootDir: string;
  /** File extensions to include. Defaults to ['.css', '.scss', '.less']. */
  extensions?: string[];
}

export interface CssCollectionResult {
  entities: Entity[];
  relationships: Relationship[];
  fileInventory: FileInventoryEntry[];
}

const DEFAULT_EXTENSIONS = ['.css', '.scss', '.less'];

/**
 * Collect CSS/SCSS/LESS entities and relationships from the given directories.
 */
export function collectCss(options: CssCollectorOptions): CssCollectionResult {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const allEntities: Entity[] = [];
  const allRelationships: Relationship[] = [];
  const fileInventory: FileInventoryEntry[] = [];

  const files = discoverFiles(options.directories, extensions);

  for (const absPath of files) {
    const relativePath = path.relative(options.rootDir, absPath).replace(/\\/g, '/');
    const content = fs.readFileSync(absPath, 'utf-8');
    const stats = fs.statSync(absPath);

    const { entities, relationships } = parseStylesheet(absPath, content, relativePath);
    allEntities.push(...entities);
    allRelationships.push(...relationships);

    const lines = content.split('\n');
    const blankLines = lines.filter((l) => l.trim() === '').length;
    const commentLines = lines.filter((l) => {
      const t = l.trim();
      return t.startsWith('/*') || t.startsWith('*') || t.startsWith('//') || t.endsWith('*/');
    }).length;
    const importLines = lines.filter((l) => {
      const t = l.trim();
      return t.startsWith('@import') || t.startsWith('@use');
    }).length;

    fileInventory.push({
      filePath: relativePath,
      fileCategory: 'style',
      isAnalyzedLanguage: true,
      fileSizeBytes: stats.size,
      totalLines: lines.length,
      blankLines,
      commentLines,
      importExportOnlyLines: importLines,
    });
  }

  return { entities: allEntities, relationships: allRelationships, fileInventory };
}

function discoverFiles(directories: string[], extensions: string[]): string[] {
  const results: string[] = [];

  function walkDir(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walkDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  for (const dir of directories) {
    walkDir(dir);
  }
  return results.sort();
}
