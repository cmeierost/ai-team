/**
 * @aspect/engine — Export analysis
 *
 * Analyses all exported symbols across the codebase:
 *  - Classifies each export as "logic" (functions, classes, enums) or "contract" (interfaces, type aliases)
 *  - Counts consumer files (how many files import from this file)
 *  - Identifies dead files (exported but never imported by any tracked file)
 *  - Tracks re-exports (files that re-export from other files)
 */

import type { Entity, Relationship } from '@aspect/contracts';
import type { ExportAnalysis, FileExportInfo, ExportedSymbol, BarrelViolation } from './types.js';

const CONTRACT_KINDS = new Set(['interface', 'type-alias']);
const IMPORT_KINDS = new Set(['import', 'use', 'reference', 're-export']);

/**
 * Build export analysis from raw collector data.
 */
export function analyseExports(
  entities: Entity[],
  relationships: Relationship[],
): ExportAnalysis {
  // Map child entities → parent file
  const entityToFile = new Map<string, string>();
  const fileEntities = new Map<string, Entity>();

  for (const e of entities) {
    if (e.kind === 'file') {
      entityToFile.set(e.id, e.id);
      fileEntities.set(e.id, e);
    }
  }
  for (const e of entities) {
    if (e.kind !== 'file' && e.parentEntityId) {
      entityToFile.set(e.id, e.parentEntityId);
    }
  }

  // Group child entities by parent file
  const fileChildMap = new Map<string, Entity[]>();
  for (const e of entities) {
    if (e.kind === 'file') continue;
    const fileId = entityToFile.get(e.id);
    if (!fileId) continue;
    let list = fileChildMap.get(fileId);
    if (!list) { list = []; fileChildMap.set(fileId, list); }
    list.push(e);
  }

  // Count how many distinct files import from each file (file-level consumer count)
  // Also track import targets per file for barrel/re-export detection
  const consumersByFile = new Map<string, Set<string>>();
  const importTargets = new Map<string, Set<string>>(); // sourceFile → files it imports from

  for (const rel of relationships) {
    if (!IMPORT_KINDS.has(rel.kind)) continue;
    const sourceFile = entityToFile.get(rel.sourceEntityId);
    const targetFile = entityToFile.get(rel.targetEntityId);
    if (!sourceFile || !targetFile || sourceFile === targetFile) continue;

    let consumers = consumersByFile.get(targetFile);
    if (!consumers) { consumers = new Set(); consumersByFile.set(targetFile, consumers); }
    consumers.add(sourceFile);

    let targets = importTargets.get(sourceFile);
    if (!targets) { targets = new Set(); importTargets.set(sourceFile, targets); }
    targets.add(targetFile);
  }

  // Detect barrel/re-export files: files with imports but few/no own child entities
  // These are typically index.ts files that just `export * from './foo'`
  const childCountByFile = new Map<string, number>();
  for (const e of entities) {
    if (e.kind !== 'file' && e.parentEntityId) {
      childCountByFile.set(e.parentEntityId, (childCountByFile.get(e.parentEntityId) ?? 0) + 1);
    }
  }

  function isBarrelFile(fileId: string): boolean {
    const targets = importTargets.get(fileId);
    if (!targets || targets.size === 0) return false;
    const childCount = childCountByFile.get(fileId) ?? 0;
    // Barrel = has imports but no own declarations (pure re-export)
    // or is named index.* with very few own declarations relative to imports
    const entity = fileEntities.get(fileId);
    const isIndex = entity?.name?.match(/^index\.[jt]sx?$/) != null;
    if (childCount === 0) return true;
    if (isIndex && childCount <= 2 && targets.size >= 2) return true;
    return false;
  }

  // Helper: resolve file path from entity
  function filePath(fileId: string): string {
    const e = fileEntities.get(fileId);
    return e?.filePath ?? e?.name ?? fileId;
  }

  // Helper: get the directory of a file path
  function dirOf(p: string): string {
    const norm = p.replace(/\\/g, '/');
    const idx = norm.lastIndexOf('/');
    return idx >= 0 ? norm.slice(0, idx) : '';
  }

  // Check if barrel and target are on the same branch/lineage.
  // Valid:
  //   - barrel ancestor of target (parent index re-exporting child)
  //   - barrel descendant of target (child index re-exporting parent)
  // Invalid:
  //   - cross-branch sibling re-export.
  function isSameBranch(barrelDir: string, targetPath: string): boolean {
    const normBarrel = barrelDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const targetDir = dirOf(targetPath).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (!normBarrel || !targetDir) return normBarrel === targetDir;
    return targetDir === normBarrel
      || targetDir.startsWith(normBarrel + '/')
      || normBarrel.startsWith(targetDir + '/');
  }

  // Build per-file export info
  const files: FileExportInfo[] = [];
  let totalExports = 0;
  let totalLogicExports = 0;
  let totalContractExports = 0;
  let deadFileCount = 0;
  let deadExportLoc = 0;

  for (const [fileId, fileEntity] of fileEntities) {
    const children = fileChildMap.get(fileId) ?? [];
    const exported = children.filter((c) => c.classification?.isExported);
    const barrel = isBarrelFile(fileId);

    // Skip files with no exports AND not a barrel
    if (exported.length === 0 && !barrel) continue;

    const consumerCount = consumersByFile.get(fileId)?.size ?? 0;
    const isDeadFile = consumerCount === 0 && !barrel;

    const exports: ExportedSymbol[] = exported.map((e) => {
      const kind = normalizeKind(e.kind);
      const nature: 'logic' | 'contract' = CONTRACT_KINDS.has(e.kind) ? 'contract' : 'logic';
      return {
        name: e.name,
        kind,
        nature,
        fileRefs: consumerCount,
        linesOfCode: e.rawCounts?.linesOfCode ?? undefined,
      };
    });

    const logicExports = exports.filter((e) => e.nature === 'logic').length;
    const contractExports = exports.filter((e) => e.nature === 'contract').length;

    // Re-export info: barrel files re-export from their import targets
    const reexportFrom = barrel ? importTargets.get(fileId) : undefined;
    const reexportSources = reexportFrom
      ? [...reexportFrom].map((tid) => filePath(tid))
      : undefined;

    // Branch violation check: barrels should only re-export within their lineage.
    const barrelPath = (fileEntity.filePath ?? fileEntity.name).replace(/\\/g, '/');
    const barrelDir = dirOf(barrelPath);
    let reexportViolations: BarrelViolation[] | undefined;
    if (barrel && reexportSources) {
      const violations: BarrelViolation[] = [];
      for (const src of reexportSources) {
        if (!isSameBranch(barrelDir, src)) {
          violations.push({ barrelPath, targetPath: src, barrelDir });
        }
      }
      if (violations.length > 0) reexportViolations = violations;
    }

    totalExports += exports.length;
    totalLogicExports += logicExports;
    totalContractExports += contractExports;

    if (isDeadFile) {
      deadFileCount++;
      deadExportLoc += exports.reduce((s, e) => s + (e.linesOfCode ?? 0), 0);
    }

    files.push({
      fileId,
      filePath: fileEntity.filePath ?? fileEntity.name,
      exports,
      totalExports: exports.length,
      logicExports,
      contractExports,
      consumerCount,
      isDeadFile,
      reexportSources,
      reexportViolations,
    });
  }

  // Sort: dead files first, then by export count descending
  files.sort((a, b) => {
    if (a.isDeadFile !== b.isDeadFile) return a.isDeadFile ? -1 : 1;
    return b.totalExports - a.totalExports;
  });

  // Collect all barrel violations across files
  const barrelViolations = files.flatMap((f) => f.reexportViolations ?? []);

  return {
    files,
    totalExports,
    totalLogicExports,
    totalContractExports,
    deadFileCount,
    deadExportLoc,
    barrelViolations,
  };
}

function normalizeKind(kind: string): ExportedSymbol['kind'] {
  switch (kind) {
    case 'function': return 'function';
    case 'class': return 'class';
    case 'interface': return 'interface';
    case 'type-alias': return 'type-alias';
    case 'enum': return 'enum';
    case 'namespace': return 'namespace';
    case 'field': return 'field';
    case 'method': return 'method';
    case 'property': return 'property';
    default: return 'other';
  }
}
