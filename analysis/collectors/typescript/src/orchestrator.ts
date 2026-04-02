/**
 * Orchestrator — main entry point that runs all adapters and produces
 * CollectedCodeData conforming to the @aspect/contracts intermediate schema.
 */

import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import type {
  CollectedCodeData,
  Entity,
  Relationship,
  ModuleBoundary,
  ToolRun,
  DuplicationSignal as ContractDuplicationSignal,
  CoverageSignal as ContractCoverageSignal,
  LintSignal as ContractLintSignal,
  SourceRange,
} from '@aspect/contracts';

import { runAstVisitor } from './adapters/ast-visitor.js';
import { runDepCruiserAdapter } from './adapters/dep-cruiser.js';
import { runJscpdAdapter } from './adapters/jscpd.js';
import { runEslintAdapter } from './adapters/eslint.js';
import { runCoverageAdapter } from './adapters/coverage.js';
import { detectModuleBoundaries } from './boundary-detector.js';
import type { BoundaryDetectionOptions } from './boundary-detector.js';
import { buildPathFilter } from './gitignore-filter.js';

// ── Public types ────────────────────────────────────────────────────────────

export type CollectionAspect =
  | 'dependencyGraph'
  | 'entityExtraction'
  | 'duplication'
  | 'lint'
  | 'coverage';

export interface CollectorOptions {
  /** Root directory of the project to analyze. */
  rootDir: string;
  /** Source directories relative to rootDir (default: ['src']). */
  srcDirs?: string[];
  /** Which aspects to collect (default: all). */
  includeAspects?: CollectionAspect[];
  /** Which aspects to skip. */
  excludeAspects?: CollectionAspect[];
  /** Module boundary definitions (manual). When omitted, boundaries are auto-detected. */
  moduleBoundaries?: Array<{ moduleId: string; modulePath: string }>;
  /**
   * Auto-detect module boundaries when no manual boundaries are supplied.
   * Set to `false` to disable auto-detection entirely. Default: `true`.
   */
  autoDetectBoundaries?: boolean;
  /** Options for boundary auto-detection. */
  boundaryDetection?: Partial<Omit<BoundaryDetectionOptions, 'rootDir' | 'srcDirs'>>;
  /** File patterns to include (default: ['**\/*.ts', '**\/*.tsx']). */
  include?: string[];
  /** File patterns to exclude (default: ['**\/node_modules\/**', '**\/dist\/**']). */
  exclude?: string[];
  /** Coverage report file path (optional). */
  coveragePath?: string;
  /** Coverage format (default: auto-detect). */
  coverageFormat?: 'lcov' | 'istanbul';
  /** jscpd options. */
  jscpd?: { minTokens?: number; minLines?: number };
  /** eslint options. */
  eslint?: { configPath?: string; extraArgs?: string[] };
  /** dependency-cruiser options. */
  depCruiser?: { extraOptions?: Record<string, unknown> };
}

export interface CollectionResult {
  data: CollectedCodeData;
  timing: {
    totalMs: number;
    perAspect: Record<string, number>;
  };
  warnings: string[];
}

// ── Constants ───────────────────────────────────────────────────────────────

const ALL_ASPECTS: CollectionAspect[] = [
  'dependencyGraph',
  'entityExtraction',
  'duplication',
  'lint',
  'coverage',
];

const UNKNOWN_RANGE: SourceRange = {
  startLine: 0,
  startColumn: 0,
  endLine: 0,
  endColumn: 0,
};

const COLLECTOR_ID = '@aspect/collector-typescript';
const COLLECTOR_VERSION = '0.1.0';
const DEFAULT_SRC_DIRS = ['src'];

// ── Helpers (exported for testability) ──────────────────────────────────────

/**
 * Determine which collection aspects to run based on include/exclude lists.
 */
export function resolveAspects(
  include?: CollectionAspect[],
  exclude?: CollectionAspect[],
): Set<CollectionAspect> {
  const aspects = new Set<CollectionAspect>(include ?? ALL_ASPECTS);
  if (exclude) {
    for (const e of exclude) aspects.delete(e);
  }
  return aspects;
}

/**
 * Walk srcDirs under rootDir and return relative file paths matching
 * the include/exclude patterns.
 */
export async function discoverFiles(
  options: CollectorOptions,
): Promise<string[]> {
  const {
    rootDir,
    srcDirs = ['src'],
    include = ['**/*.ts', '**/*.tsx'],
    exclude = ['**/node_modules/**', '**/dist/**'],
  } = options;

  // Extract file extensions from include patterns (e.g. '**/*.ts' → '.ts')
  const extensions = new Set<string>();
  for (const pattern of include) {
    const ext = extname(pattern);
    if (ext) extensions.add(ext);
  }
  if (extensions.size === 0) {
    extensions.add('.ts');
    extensions.add('.tsx');
  }

  // Extract directory names to exclude from patterns like '**/node_modules/**'
  const excludeDirs: string[] = [];
  for (const pattern of exclude) {
    const match = pattern.match(/^(?:\*\*\/)?([^*]+?)(?:\/\*\*)?$/);
    if (match) {
      excludeDirs.push(match[1].replace(/\/$/, ''));
    }
  }

  const results: string[] = [];

  for (const srcDir of srcDirs) {
    const absDir = join(rootDir, srcDir);
    try {
      const entries = await readdir(absDir, { recursive: true });
      for (const entry of entries) {
        const normalized = String(entry).replace(/\\/g, '/');

        if (!extensions.has(extname(normalized))) continue;

        const segments = normalized.split('/');
        if (segments.some((seg) => excludeDirs.includes(seg))) continue;

        const srcDirNorm = srcDir.replace(/\\/g, '/');
        const relPath =
          srcDirNorm === '.' ? normalized : `${srcDirNorm}/${normalized}`;
        results.push(relPath);
      }
    } catch {
      // Directory doesn't exist or can't be read — skip silently
    }
  }

  return results;
}

/**
 * Merge incoming entities into an existing array, skipping duplicates by ID.
 * When duplicates exist the earlier (richer) entity is kept.
 */
export function mergeEntities(
  existing: Entity[],
  incoming: Entity[],
): void {
  const ids = new Set(existing.map((e) => e.id));
  for (const entity of incoming) {
    if (!ids.has(entity.id)) {
      existing.push(entity);
      ids.add(entity.id);
    }
  }
}

/**
 * Convert module boundary definitions + discovered entities into the
 * contract's ModuleBoundary format, assigning matching file entities.
 */
export function buildModuleBoundaries(
  definitions:
    | Array<{ moduleId: string; modulePath: string }>
    | undefined,
  entities: Entity[],
): ModuleBoundary[] {
  if (!definitions || definitions.length === 0) return [];

  const fileEntities = entities.filter((e) => e.kind === 'file');

  return definitions.map((def) => {
    const normalizedBoundary = def.modulePath
      .replace(/\\/g, '/')
      .replace(/\/$/, '');

    const files = fileEntities
      .filter((e) => {
        const fp = e.filePath.replace(/\\/g, '/');
        return (
          fp === normalizedBoundary ||
          fp.startsWith(normalizedBoundary + '/')
        );
      })
      .map((e) => e.filePath);

    return {
      moduleId: def.moduleId,
      modulePath: def.modulePath,
      files,
      declaredLayer: null,
      isPackage: false,
      kind: 'manual' as const,
    };
  });
}

// ── Adapter output → contract type helpers ──────────────────────────────────

/**
 * Convert dep-cruiser's local Entity (sourceRange nullable, rawCounts null)
 * into the contract Entity type.
 */
function adaptDepCruiserEntity(e: {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  sourceRange: SourceRange | null;
  parentEntityId: string | null;
  classification: Entity['classification'];
  nameTokens: string[];
}): Entity {
  return {
    id: e.id,
    kind: e.kind as Entity['kind'],
    name: e.name,
    filePath: e.filePath,
    sourceRange: e.sourceRange ?? UNKNOWN_RANGE,
    classification: e.classification,
    parentEntityId: e.parentEntityId,
    nameTokens: e.nameTokens,
  };
}

/**
 * Convert dep-cruiser's local Relationship (sourceRange nullable)
 * into the contract Relationship type.
 */
function adaptDepCruiserRelationship(r: {
  sourceEntityId: string;
  targetEntityId: string;
  kind: string;
  sourceRange: SourceRange | null;
  targetClassification: string;
  targetIsAbstraction: boolean;
  consumedMembers: string[] | null;
  targetTotalMembers: number | null;
  crossModule: boolean;
  crossPackage: boolean;
  thirdParty: boolean;
  typeOnly: boolean;
  dynamic: boolean;
}): Relationship {
  return {
    sourceEntityId: r.sourceEntityId,
    targetEntityId: r.targetEntityId,
    kind: r.kind as Relationship['kind'],
    sourceRange: r.sourceRange ?? UNKNOWN_RANGE,
    targetClassification:
      r.targetClassification as Relationship['targetClassification'],
    targetIsAbstraction: r.targetIsAbstraction,
    consumedMembers: r.consumedMembers,
    targetTotalMembers: r.targetTotalMembers,
    crossModule: r.crossModule,
    crossPackage: r.crossPackage,
    thirdParty: r.thirdParty,
    typeOnly: r.typeOnly,
    dynamic: r.dynamic,
  };
}

/**
 * Map jscpd adapter DuplicationSignal to contract DuplicationSignal.
 * Field renames: startCol → startColumn, endCol → endColumn.
 */
function adaptDuplicationSignals(
  adapterSignals: Array<{
    source: { tool: string; version: string };
    clones: Array<{
      id: string;
      format: string;
      tokenCount: number;
      lineCount: number;
      fragment: string | null;
      firstFile: {
        filePath: string;
        startLine: number;
        endLine: number;
        startCol: number | null;
        endCol: number | null;
      };
      secondFile: {
        filePath: string;
        startLine: number;
        endLine: number;
        startCol: number | null;
        endCol: number | null;
      };
    }>;
    statistics: {
      totalLines: number;
      totalTokens: number;
      totalSources: number;
      duplicatedLines: number;
      duplicatedTokens: number;
    };
  }>,
): ContractDuplicationSignal[] {
  return adapterSignals.map((signal) => ({
    source: signal.source,
    clones: signal.clones.map((clone) => ({
      id: clone.id,
      format: clone.format,
      tokenCount: clone.tokenCount,
      lineCount: clone.lineCount,
      fragment: clone.fragment,
      firstFile: {
        filePath: clone.firstFile.filePath,
        startLine: clone.firstFile.startLine,
        endLine: clone.firstFile.endLine,
        startColumn: clone.firstFile.startCol,
        endColumn: clone.firstFile.endCol,
      },
      secondFile: {
        filePath: clone.secondFile.filePath,
        startLine: clone.secondFile.startLine,
        endLine: clone.secondFile.endLine,
        startColumn: clone.secondFile.startCol,
        endColumn: clone.secondFile.endCol,
      },
    })),
    statistics: signal.statistics,
  }));
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Run all requested adapters and merge their outputs into a single
 * CollectedCodeData object conforming to the intermediate schema.
 */
export async function collect(
  options: CollectorOptions,
): Promise<CollectionResult> {
  const start = performance.now();
  const warnings: string[] = [];
  const timing: Record<string, number> = {};
  const toolRuns: ToolRun[] = [];
  const usedTools: string[] = [];

  const aspects = resolveAspects(
    options.includeAspects,
    options.excludeAspects,
  );

  // Phase 1 — Discover source files
  const sourceFiles = await discoverFiles(options);

  // Build gitignore-aware path filter
  const pathFilter = buildPathFilter(options.rootDir);

  // Phase 2 — Run adapters
  let entities: Entity[] = [];
  let relationships: Relationship[] = [];
  let duplicationSignals: ContractDuplicationSignal[] | undefined;
  let coverageSignals: ContractCoverageSignal[] | undefined;
  let lintSignals: ContractLintSignal[] | undefined;

  // 2a. Entity extraction (AST visitor)
  if (aspects.has('entityExtraction')) {
    const t0 = performance.now();
    try {
      const result = await runAstVisitor({
        rootDir: options.rootDir,
        files: sourceFiles,
      });
      entities.push(...result.entities);
      toolRuns.push(result.toolRun);
      usedTools.push('typescript-ast');
    } catch (err) {
      warnings.push(`AST visitor failed: ${formatError(err)}`);
    }
    timing.entityExtraction = Math.round(performance.now() - t0);
  }

  // 2b. Dependency graph (dependency-cruiser)
  if (aspects.has('dependencyGraph')) {
    const t0 = performance.now();
    try {
      const result = await runDepCruiserAdapter({
        rootDir: options.rootDir,
        srcDirs: options.srcDirs,
        cruiseOptions: options.depCruiser?.extraOptions,
        moduleBoundaries: options.moduleBoundaries?.map((mb) => ({
          moduleId: mb.moduleId,
          modulePath: mb.modulePath,
        })),
      });

      const adapted = result.entities.map(adaptDepCruiserEntity);
      mergeEntities(entities, adapted);

      relationships.push(
        ...result.relationships.map(adaptDepCruiserRelationship),
      );

      toolRuns.push(result.toolRun);
      usedTools.push('dependency-cruiser');
    } catch (err) {
      warnings.push(`dependency-cruiser failed: ${formatError(err)}`);
    }
    timing.dependencyGraph = Math.round(performance.now() - t0);
  }

  // 2c. Duplication (jscpd)
  if (aspects.has('duplication')) {
    const t0 = performance.now();
    try {
      const result = await runJscpdAdapter({
        rootDir: options.rootDir,
        srcDirs: options.srcDirs,
        include: options.include,
        exclude: options.exclude,
        minTokens: options.jscpd?.minTokens,
        minLines: options.jscpd?.minLines,
      });

      duplicationSignals = adaptDuplicationSignals(result.duplicationSignals);
      toolRuns.push(result.toolRun);
      usedTools.push('jscpd');
    } catch (err) {
      warnings.push(`jscpd failed: ${formatError(err)}`);
    }
    timing.duplication = Math.round(performance.now() - t0);
  }

  // 2d. Lint (eslint)
  if (aspects.has('lint')) {
    const t0 = performance.now();
    try {
      const result = await runEslintAdapter({
        rootDir: options.rootDir,
        configPath: options.eslint?.configPath,
        extraArgs: options.eslint?.extraArgs,
      });

      lintSignals = result.lintSignals as ContractLintSignal[];
      toolRuns.push(result.toolRun);
      usedTools.push('eslint');
    } catch (err) {
      warnings.push(`eslint failed: ${formatError(err)}`);
    }
    timing.lint = Math.round(performance.now() - t0);
  }

  // 2e. Coverage
  if (aspects.has('coverage') && options.coveragePath) {
    const t0 = performance.now();
    try {
      const result = await runCoverageAdapter({
        rootDir: options.rootDir,
        coveragePath: options.coveragePath,
        format: options.coverageFormat,
      });

      coverageSignals = result.coverageSignals as ContractCoverageSignal[];
      toolRuns.push(result.toolRun);
      usedTools.push(result.toolRun.tool);
    } catch (err) {
      warnings.push(`coverage adapter failed: ${formatError(err)}`);
    }
    timing.coverage = Math.round(performance.now() - t0);
  }

  // Phase 2.5 — Filter out gitignored/external entities and their relationships
  const preFilterCount = entities.length;
  const allowedEntityIds = new Set<string>();

  const filteredEntities: Entity[] = [];
  for (const entity of entities) {
    if (!pathFilter.isIgnored(entity.filePath)) {
      filteredEntities.push(entity);
      allowedEntityIds.add(entity.id);
    }
  }
  entities = filteredEntities;

  relationships = relationships.filter(
    (r) => allowedEntityIds.has(r.sourceEntityId) && allowedEntityIds.has(r.targetEntityId),
  );

  if (preFilterCount !== entities.length) {
    warnings.push(
      `Filtered ${preFilterCount - entities.length} gitignored/external entities (${entities.length} remaining)`,
    );
  }

  // Phase 3 — Build module boundaries
  let moduleBoundaries: ModuleBoundary[];

  if (options.moduleBoundaries && options.moduleBoundaries.length > 0) {
    // Manual boundaries supplied — use them
    moduleBoundaries = buildModuleBoundaries(options.moduleBoundaries, entities);
  } else if (options.autoDetectBoundaries !== false) {
    // Auto-detect boundaries from codebase structure
    const resolvedSrcDirs = (options.srcDirs ?? DEFAULT_SRC_DIRS).map((d) =>
      join(options.rootDir, d),
    );
    const detected = detectModuleBoundaries({
      rootDir: options.rootDir,
      srcDirs: resolvedSrcDirs,
      detectPackages: true,
      detectFacades: true,
      detectDirectories: true,
      directoryDepth: 1,
      ...options.boundaryDetection,
    });

    // Convert DetectedBoundary → contract ModuleBoundary (enriching with file lists)
    const fileEntities = entities.filter((e) => e.kind === 'file');
    moduleBoundaries = detected.map((det) => {
      const normalizedBoundary = det.modulePath
        .replace(/\\/g, '/')
        .replace(/\/$/, '');

      const files = fileEntities
        .filter((e) => {
          const fp = e.filePath.replace(/\\/g, '/');
          return (
            fp === normalizedBoundary ||
            fp.startsWith(normalizedBoundary + '/')
          );
        })
        .map((e) => e.filePath);

      return {
        moduleId: det.moduleId,
        modulePath: det.modulePath,
        files,
        declaredLayer: null,
        isPackage: det.isPackage,
        kind: det.kind,
      };
    });
  } else {
    moduleBoundaries = [];
  }

  // Phase 4 — Assemble CollectedCodeData
  const totalMs = performance.now() - start;

  const data: CollectedCodeData = {
    schemaVersion: '1.0',
    collectedAt: new Date().toISOString(),
    collector: {
      id: COLLECTOR_ID,
      version: COLLECTOR_VERSION,
      language: 'typescript',
      tools: usedTools,
    },
    entities,
    relationships,
    moduleBoundaries,
    ...(duplicationSignals && duplicationSignals.length > 0
      ? { duplicationSignals }
      : {}),
    ...(coverageSignals && coverageSignals.length > 0
      ? { coverageSignals }
      : {}),
    ...(lintSignals && lintSignals.length > 0 ? { lintSignals } : {}),
    provenance: {
      collectionDuration: Math.round(totalMs),
      toolRuns,
    },
  };

  return {
    data,
    timing: { totalMs, perAspect: timing },
    warnings,
  };
}
