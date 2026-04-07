/**
 * Orchestrator — main entry point that runs all adapters and produces
 * CollectedCodeData conforming to the @aspect/contracts intermediate schema.
 */

import { readdir } from 'node:fs/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname, basename, relative } from 'node:path';
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
  FileInventoryEntry,
} from '@aspect/contracts';

import { runAstVisitor } from './adapters/ast-visitor.js';
import { runDepCruiserAdapter } from './adapters/dep-cruiser.js';
import { runJscpdAdapter } from './adapters/jscpd.js';
import { runEslintAdapter } from './adapters/eslint.js';
import { runCoverageAdapter } from './adapters/coverage.js';
import { detectModuleBoundaries } from './boundary-detector.js';
import type { BoundaryDetectionOptions } from './boundary-detector.js';
import { buildPathFilter } from '@aspect/collector-shared';

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
  /** Path to tsconfig.json — auto-detected if not provided. */
  tsConfigPath?: string;
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

// ── File discovery constants ────────────────────────────────────────────────

const EXTENSION_LANGUAGES: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
  '.html': 'html', '.htm': 'html',
  '.md': 'markdown', '.mdx': 'markdown',
  '.json': 'json', '.jsonc': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml', '.svg': 'xml',
  '.sh': 'shell', '.bash': 'shell',
  '.py': 'python', '.cs': 'csharp', '.java': 'java', '.go': 'go', '.rs': 'rust',
};

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.zip', '.tar', '.gz', '.br',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm',
  '.wasm', '.node', '.dll', '.so', '.dylib',
]);

const WALK_SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', 'build', 'out',
  'storybook-static', 'coverage', '__snapshots__',
]);

function shouldSkipDir(name: string): boolean {
  if (name === '.ai-team') return false; // always include AI config
  return name.startsWith('.') || WALK_SKIP_DIRS.has(name);
}

function detectLanguage(ext: string): string {
  if (BINARY_EXTENSIONS.has(ext)) return 'binary';
  return EXTENSION_LANGUAGES[ext] ?? 'unknown';
}

function countLines(filePath: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').length;
  } catch {
    return 0;
  }
}

/**
 * Walk the repository and create minimal file entities for every file
 * that passes the gitignore filter. Non-code files get basic metadata
 * (path, line count) but no AST analysis.
 */
export async function discoverAllFiles(
  rootDir: string,
  pathFilter: (path: string) => boolean,
): Promise<Entity[]> {
  const entities: Entity[] = [];
  const defaultClassification: Entity['classification'] = {
    isExported: false,
    isAbstract: false,
    isInterface: false,
    isConcrete: true,
    isTypeOnly: false,
    visibility: null,
  };

  function walkDir(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip silently
    }

    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name)) continue;
        walkDir(abs);
      } else if (entry.isFile()) {
        const relPath = relative(rootDir, abs).replace(/\\/g, '/');

        // Apply gitignore filter (returns true if ignored)
        if (pathFilter(relPath)) continue;

        const ext = extname(entry.name).toLowerCase();
        const language = detectLanguage(ext);
        const isBinary = language === 'binary';

        const lineCount = isBinary ? 0 : countLines(abs);
        const sourceRange: SourceRange = isBinary
          ? { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 }
          : { startLine: 1, startColumn: 0, endLine: lineCount, endColumn: 0 };

        entities.push({
          id: `file:${relPath}`,
          kind: 'file',
          name: entry.name,
          filePath: relPath,
          sourceRange,
          parentEntityId: null,
          childEntityIds: [],
          entityDepth: 0,
          hierarchyKind: 'root' as const,
          classification: { ...defaultClassification },
          nameTokens: [basename(entry.name, ext)],
        });
      }
    }
  }

  walkDir(rootDir);
  return entities;
}

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
    childEntityIds: [],
    entityDepth: 0,
    hierarchyKind: 'root' as const,
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
    sourceFilePath: r.sourceEntityId.replace(/^file:/, ''),
    targetFilePath: null,
    sourceRange: r.sourceRange ?? UNKNOWN_RANGE,
    targetRange: null,
    resolutionKind: 'proxy' as const,
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
        tsConfigPath: options.tsConfigPath,
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

  // Phase 2.6 — Remap short .js entity references to their full .ts counterparts.
  // dep-cruiser resolves imports to .js paths (e.g., 'agent/index.js') but we have
  // the real .ts entities (e.g., 'packages/core/src/agent/index.ts'). Build a lookup
  // from short basename to full entity ID so relationships stay connected.
  const jsRemapTable = new Map<string, string>();
  const filteredIds = new Set(
    entities.filter((e) => !allowedEntityIds.has(e.id)).map((e) => e.id),
  );
  if (filteredIds.size > 0) {
    // Build basename→fullId map from kept entities
    const baseToFull = new Map<string, string>();
    for (const e of filteredEntities) {
      if (e.kind !== 'file') continue;
      const fp = e.filePath.replace(/\\/g, '/');
      // Extract the short name: 'packages/core/src/agent/index.ts' → 'agent/index.ts'
      // Also: 'packages/core/src/utils/str.ts' → 'utils/str.ts', 'str.ts'
      const parts = fp.split('/');
      for (let i = 1; i < parts.length; i++) {
        const suffix = parts.slice(i).join('/');
        if (!baseToFull.has(suffix)) {
          baseToFull.set(suffix, e.id);
        }
        // Also the .js variant
        const jsSuffix = suffix.replace(/\.tsx?$/, '.js');
        if (!baseToFull.has(jsSuffix)) {
          baseToFull.set(jsSuffix, e.id);
        }
      }
    }

    // For each filtered entity, try to find a remap
    for (const e of entities) {
      if (allowedEntityIds.has(e.id)) continue;
      const fp = e.filePath.replace(/\\/g, '/');
      const fullId = baseToFull.get(fp);
      if (fullId) {
        jsRemapTable.set(e.id, fullId);
      }
    }
  }

  entities = filteredEntities;

  // Remap and filter relationships
  relationships = relationships
    .map((r) => {
      const src = jsRemapTable.get(r.sourceEntityId) ?? r.sourceEntityId;
      const tgt = r.targetEntityId == null ? null : (jsRemapTable.get(r.targetEntityId) ?? r.targetEntityId);
      if (src === r.sourceEntityId && tgt === r.targetEntityId) return r;
      return { ...r, sourceEntityId: src, targetEntityId: tgt };
    })
    .filter(
      (r) =>
        allowedEntityIds.has(r.sourceEntityId) &&
        (r.targetEntityId == null || allowedEntityIds.has(r.targetEntityId)),
    );

  if (preFilterCount !== entities.length) {
    warnings.push(
      `Filtered ${preFilterCount - entities.length} gitignored/external entities (${entities.length} remaining), remapped ${jsRemapTable.size} short paths`,
    );
  }

  // Phase 2.7 — Discover ALL files (non-code included) and merge with existing entities
  try {
    const discoveredFiles = await discoverAllFiles(
      options.rootDir,
      (p) => pathFilter.isIgnored(p),
    );
    const existingFileIds = new Set(
      entities.filter((e) => e.kind === 'file').map((e) => e.id),
    );
    const newFiles = discoveredFiles.filter((f) => !existingFileIds.has(f.id));
    entities.push(...newFiles);
  } catch (err) {
    warnings.push(`File discovery failed: ${formatError(err)}`);
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
        entryPoints: det.entryPoints,
        isApp: det.isApp,
        appKind: det.appKind,
      };
    });
  } else {
    moduleBoundaries = [];
  }

  // Phase 4 — Build file inventory from file entities
  const fileInventory: FileInventoryEntry[] = entities
    .filter((e) => e.kind === 'file')
    .map((e) => {
      const absPath = join(options.rootDir, e.filePath);
      let fileSizeBytes = 0;
      try { fileSizeBytes = statSync(absPath).size; } catch { /* missing file */ }
      const ext = extname(e.filePath).toLowerCase();
      const isCode = ['.ts', '.tsx', '.js', '.jsx', '.css'].includes(ext);
      const isTest = e.filePath.includes('.test.') || e.filePath.includes('.spec.') || e.filePath.includes('__tests__');
      const isConfig = ['.json', '.yaml', '.yml', '.toml', '.env'].includes(ext) || basename(e.filePath).startsWith('.');
      const isStyle = ['.css', '.scss', '.less'].includes(ext);
      const isDoc = ['.md', '.txt', '.rst'].includes(ext);
      const fileCategory: FileInventoryEntry['fileCategory'] =
        isTest ? 'test' : isStyle ? 'style' : isDoc ? 'docs' : isConfig ? 'config' : isCode ? 'source_code' : 'other';
      return {
        filePath: e.filePath,
        fileCategory,
        isAnalyzedLanguage: isCode && !isStyle,
        fileSizeBytes,
        totalLines: e.sourceRange?.endLine ?? null,
        blankLines: null,
        commentLines: null,
        importExportOnlyLines: null,
      };
    });

  // Phase 5 — Assemble CollectedCodeData
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
    fileInventory,
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
