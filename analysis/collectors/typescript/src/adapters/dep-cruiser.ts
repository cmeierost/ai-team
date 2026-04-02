/**
 * dependency-cruiser adapter for @aspect/collector-typescript.
 *
 * Runs dependency-cruiser on a target directory and normalizes the output into
 * the intermediate schema (entities + relationships).
 */

import * as path from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

// ── Local types ─────────────────────────────────────────────────────────────
// TODO: Import Entity, Relationship, ToolRun from @aspect/contracts once the
//       build pipeline is stable. These local definitions mirror the contract
//       schemas but allow nullable sourceRange (dep-cruiser doesn't provide it).

export interface SourceRange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface Entity {
  id: string;
  kind: 'file';
  name: string;
  filePath: string;
  sourceRange: SourceRange | null;
  parentEntityId: string | null;
  classification: {
    isAbstract: boolean;
    isInterface: boolean;
    isConcrete: boolean;
    isTypeOnly: boolean;
    isExported: boolean;
    visibility: 'public' | 'private' | 'protected' | 'internal' | null;
  };
  nameTokens: string[];
  rawCounts: null;
  methodFieldAccessMatrix: null;
}

export interface Relationship {
  sourceEntityId: string;
  targetEntityId: string;
  kind: 'import';
  sourceRange: SourceRange | null;
  targetClassification: 'unknown';
  targetIsAbstraction: false;
  consumedMembers: null;
  targetTotalMembers: null;
  crossModule: boolean;
  crossPackage: boolean;
  thirdParty: boolean;
  typeOnly: boolean;
  dynamic: boolean;
}

// ── Raw dependency-cruiser output types ─────────────────────────────────────

export interface DepCruiserRawDependency {
  module: string;
  resolved: string;
  coreModule: boolean;
  dependencyTypes: string[];
  moduleSystem: string;
  dynamic: boolean;
  exoticallyRequired: boolean;
  circular: boolean;
  valid: boolean;
  followable: boolean;
  typeOnly?: boolean;
}

export interface DepCruiserRawModule {
  source: string;
  dependencies: DepCruiserRawDependency[];
  orphan?: boolean;
  valid?: boolean;
}

export interface DepCruiserRawViolation {
  type: string;
  from: string;
  to: string;
  rule: { severity: string; name: string };
}

export interface DepCruiserRawOutput {
  modules: DepCruiserRawModule[];
  summary: {
    violations: DepCruiserRawViolation[];
    totalCruised: number;
    totalDependenciesCruised: number;
  };
}

// ── Options & result ────────────────────────────────────────────────────────

export interface ModuleBoundaryDef {
  moduleId: string;
  modulePath: string;
}

export interface DepCruiserAdapterOptions {
  /** Root directory to analyze. */
  rootDir: string;
  /** Source directories relative to rootDir (default: ['src']). */
  srcDirs?: string[];
  /** Extra dependency-cruiser options forwarded to cruise(). */
  cruiseOptions?: Record<string, unknown>;
  /** Module boundary definitions for crossModule detection. */
  moduleBoundaries?: ModuleBoundaryDef[];
  /** Path to tsconfig.json — enables proper .js→.ts resolution. Auto-detected if not provided. */
  tsConfigPath?: string;
}

export interface DepCruiserToolRun {
  tool: 'dependency-cruiser';
  version: string;
  aspect: 'dependencyGraph';
  exitCode: number;
  duration: number;
  warnings: string[];
}

export interface DepCruiserResult {
  entities: Entity[];
  relationships: Relationship[];
  toolRun: DepCruiserToolRun;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Normalize a file path to a deterministic entity ID (`file:<forward-slash path>`). */
export function makeEntityId(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return `file:${normalized}`;
}

/**
 * Tokenize a filename into lowercase word tokens.
 *
 * Splits on `-`, `_`, `.`, and camelCase / PascalCase boundaries.
 * Strips the file extension first.
 *
 * @example tokenizeName('user-service.ts')  // ['user', 'service']
 * @example tokenizeName('ApiController.ts') // ['api', 'controller']
 */
export function tokenizeName(filename: string): string[] {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);

  const parts = base.split(/[-_.]+/);
  const tokens: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    // Split on camelCase / PascalCase boundaries:
    //   "fooBar"   → ["foo", "Bar"]
    //   "XMLParser" → ["XML", "Parser"]
    const camelParts = part.split(
      /(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/,
    );
    for (const t of camelParts) {
      if (t) tokens.push(t.toLowerCase());
    }
  }

  return tokens;
}

/** Find which module boundary (if any) a file belongs to. Returns null if unassigned. */
function findModuleId(
  filePath: string,
  boundaries: ModuleBoundaryDef[],
): string | null {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  let bestMatch: ModuleBoundaryDef | null = null;
  let bestLength = 0;

  for (const boundary of boundaries) {
    const bp = boundary.modulePath
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/\/$/, '');
    if (normalized === bp || normalized.startsWith(bp + '/')) {
      if (bp.length > bestLength) {
        bestMatch = boundary;
        bestLength = bp.length;
      }
    }
  }

  return bestMatch?.moduleId ?? null;
}

function isCrossModule(
  sourcePath: string,
  targetPath: string,
  boundaries: ModuleBoundaryDef[],
): boolean {
  if (boundaries.length === 0) return false;
  const sourceModule = findModuleId(sourcePath, boundaries);
  const targetModule = findModuleId(targetPath, boundaries);
  if (sourceModule === null && targetModule === null) return false;
  return sourceModule !== targetModule;
}

function isCrossPackage(resolvedPath: string): boolean {
  const normalized = resolvedPath.replace(/\\/g, '/');
  return normalized.includes('node_modules/');
}

function isThirdParty(dep: DepCruiserRawDependency): boolean {
  if (dep.coreModule) return true;
  const npmTypes = ['npm', 'npm-dev', 'npm-peer', 'npm-optional', 'npm-bundled'];
  return dep.dependencyTypes.some((t) => npmTypes.includes(t));
}

function isTypeOnly(dep: DepCruiserRawDependency): boolean {
  return dep.typeOnly === true || dep.dependencyTypes.includes('type-only');
}

// ── Normalization ───────────────────────────────────────────────────────────

/**
 * Normalize raw dependency-cruiser JSON output into the intermediate schema.
 *
 * This is the pure-function entry point, useful for testing without running
 * dependency-cruiser.
 */
export function normalizeDepCruiserOutput(
  rawOutput: DepCruiserRawOutput,
  options: { moduleBoundaries?: ModuleBoundaryDef[] } = {},
): { entities: Entity[]; relationships: Relationship[] } {
  const boundaries = options.moduleBoundaries ?? [];
  const entities: Entity[] = [];
  const relationships: Relationship[] = [];

  // Phase 1: Collect all source paths (these are the .ts files we fed to cruise).
  // Build a lookup to remap .js resolved paths back to their .ts source.
  const knownSources = new Set<string>();
  for (const mod of rawOutput.modules) {
    const fp = mod.source.replace(/\\/g, '/').replace(/^\.\//, '');
    knownSources.add(fp);
  }

  // Build .js → .ts remap table.
  // 'packages/core/src/agent/index.ts' produces entries for:
  //   'agent/index.js' → 'packages/core/src/agent/index.ts'
  //   'packages/core/src/agent/index.js' → 'packages/core/src/agent/index.ts'
  const jsToTs = new Map<string, string>();
  for (const tsPath of knownSources) {
    const jsVariant = tsPath.replace(/\.tsx?$/, '.js');
    jsToTs.set(jsVariant, tsPath);
    // Also map short suffixes (dep-cruiser sometimes gives paths relative to srcDir)
    const parts = tsPath.split('/');
    for (let i = 1; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/');
      const jsSuffix = suffix.replace(/\.tsx?$/, '.js');
      if (!jsToTs.has(jsSuffix)) jsToTs.set(jsSuffix, tsPath);
      if (!jsToTs.has(suffix)) jsToTs.set(suffix, tsPath);
    }
  }

  /** Resolve a dep target path: remap .js → .ts when possible. */
  function resolveTargetPath(raw: string): string {
    const normalized = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    // If it's already a known source, use it directly
    if (knownSources.has(normalized)) return normalized;
    // Try .js → .ts remap
    return jsToTs.get(normalized) ?? normalized;
  }

  // Phase 2: Build entities and relationships.
  // Only create entities for known source files — skip third-party/external modules.
  const seenEntities = new Set<string>();

  for (const mod of rawOutput.modules) {
    const filePath = mod.source.replace(/\\/g, '/').replace(/^\.\//, '');
    const entityId = makeEntityId(filePath);

    if (!seenEntities.has(entityId)) {
      seenEntities.add(entityId);
      entities.push({
        id: entityId,
        kind: 'file',
        name: path.basename(filePath),
        filePath,
        sourceRange: null,
        parentEntityId: null,
        classification: {
          isAbstract: false,
          isInterface: false,
          isConcrete: true,
          isTypeOnly: false,
          isExported: false,
          visibility: null,
        },
        nameTokens: tokenizeName(filePath),
        rawCounts: null,
        methodFieldAccessMatrix: null,
      });
    }

    for (const dep of mod.dependencies) {
      // Skip third-party / core-module dependencies entirely
      if (isThirdParty(dep)) continue;

      const resolvedPath = resolveTargetPath(dep.resolved);
      const targetId = makeEntityId(resolvedPath);

      relationships.push({
        sourceEntityId: entityId,
        targetEntityId: targetId,
        kind: 'import',
        sourceRange: null,
        targetClassification: 'unknown',
        targetIsAbstraction: false,
        consumedMembers: null,
        targetTotalMembers: null,
        crossModule: isCrossModule(filePath, resolvedPath, boundaries),
        crossPackage: isCrossPackage(dep.resolved),
        thirdParty: false,
        typeOnly: isTypeOnly(dep),
        dynamic: dep.dynamic,
      });
    }
  }

  return { entities, relationships };
}

// ── Warning extraction ──────────────────────────────────────────────────────

function extractWarnings(rawOutput: DepCruiserRawOutput): string[] {
  const warnings: string[] = [];

  // Circular dependency warnings detected from dependency-level flags
  for (const mod of rawOutput.modules) {
    for (const dep of mod.dependencies) {
      if (dep.circular) {
        warnings.push(
          `circular dependency detected: ${mod.source} → ${dep.resolved}`,
        );
      }
    }
  }

  // Rule violation warnings from summary (skip cycles — already captured above)
  for (const violation of rawOutput.summary.violations) {
    if (violation.type !== 'cycle') {
      warnings.push(
        `${violation.rule.name}: ${violation.from} → ${violation.to} (${violation.type})`,
      );
    }
  }

  return warnings;
}

// ── Version detection ───────────────────────────────────────────────────────

function getDepCruiserVersion(): string {
  try {
    const req = createRequire(import.meta.url);
    const pkg = req('dependency-cruiser/package.json') as { version: string };
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

// ── tsconfig detection ──────────────────────────────────────────────────────

/**
 * Find a tsconfig.json for dependency-cruiser's TypeScript resolution.
 * Checks: explicit path → srcDir-specific → rootDir → rootDir/tsconfig.base.json
 */
function findTsConfig(explicitPath: string | undefined, rootDir: string, srcDirs: string[]): string | undefined {
  if (explicitPath) return explicitPath;

  // Check srcDir-specific tsconfig (e.g., packages/core/tsconfig.json)
  for (const srcDir of srcDirs) {
    // Walk up from srcDir to find tsconfig closest to source
    const parts = srcDir.replace(/\\/g, '/').split('/');
    for (let i = parts.length; i >= 1; i--) {
      const dir = parts.slice(0, i).join('/');
      const candidate = path.resolve(rootDir, dir, 'tsconfig.json');
      if (existsSync(candidate)) return candidate;
    }
  }

  // Fall back to rootDir tsconfig
  const rootTsConfig = path.resolve(rootDir, 'tsconfig.json');
  if (existsSync(rootTsConfig)) return rootTsConfig;

  const baseTsConfig = path.resolve(rootDir, 'tsconfig.base.json');
  if (existsSync(baseTsConfig)) return baseTsConfig;

  return undefined;
}

// ── File collection ─────────────────────────────────────────────────────────

/**
 * Recursively collect TypeScript source files from a directory, excluding
 * test files, declaration files, and build output.
 */
export function collectTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { recursive: true, encoding: 'utf-8' });

  return entries.filter((entry) => {
    const normalized = entry.replace(/\\/g, '/');
    if (!/\.tsx?$/.test(normalized)) return false;
    if (/\.d\.tsx?$/.test(normalized)) return false;
    if (/\.(?:test|spec)\.tsx?$/.test(normalized)) return false;
    if (/(^|\/)(__tests__|__fixtures__|node_modules|dist)(\/|$)/.test(normalized)) return false;
    return true;
  });
}

// ── Runner ──────────────────────────────────────────────────────────────────

/**
 * Run dependency-cruiser programmatically on a target directory and return
 * normalized entities + relationships.
 */
export async function runDepCruiserAdapter(
  options: DepCruiserAdapterOptions,
): Promise<DepCruiserResult> {
  const { rootDir, srcDirs = ['src'], cruiseOptions = {} } = options;

  const startTime = performance.now();

  // Lazy-load dependency-cruiser so normalizeDepCruiserOutput can be imported
  // without requiring the dep-cruiser binary to be resolvable.
  const { cruise } = await import('dependency-cruiser');

  // Collect actual TypeScript file paths instead of directories.
  // cruise() expects file paths — passing directories silently returns 0 modules.
  const filePaths: string[] = [];
  for (const srcDir of srcDirs) {
    const absDir = path.resolve(rootDir, srcDir);
    const tsFiles = collectTsFiles(absDir);
    filePaths.push(...tsFiles.map((f) => path.join(srcDir, f).replace(/\\/g, '/')));
  }

  // Auto-detect tsconfig.json for proper .js → .ts resolution.
  // Check srcDir-specific tsconfigs first, then fall back to rootDir.
  const tsConfigPath = findTsConfig(options.tsConfigPath, rootDir, srcDirs);

  // Load and parse tsconfig using TypeScript compiler for proper extends resolution.
  let extractedTsConfig: unknown;
  if (tsConfigPath) {
    try {
      const ts = await import('typescript');
      const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
      if (!configFile.error) {
        extractedTsConfig = ts.parseJsonConfigFileContent(
          configFile.config,
          ts.sys,
          path.dirname(path.resolve(tsConfigPath)),
          {},
          tsConfigPath,
        );
      }
    } catch {
      // TypeScript not available — dep-cruiser will use basic resolution
      extractedTsConfig = undefined;
    }
  }
  const transpileOptions = extractedTsConfig ? { tsConfig: extractedTsConfig } : undefined;

  const result = await cruise(filePaths, {
    outputType: 'json',
    baseDir: rootDir,
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    },
    doNotFollow: {
      path: ['node_modules', '\\.pnpm'],
    },
    exclude: {
      path: ['node_modules'],
    },
    ...cruiseOptions,
  }, undefined, transpileOptions as Record<string, unknown> | undefined);

  const duration = Math.round(performance.now() - startTime);

  const rawOutput: DepCruiserRawOutput = typeof result.output === 'string'
    ? JSON.parse(result.output)
    : (result.output as unknown as DepCruiserRawOutput);

  const { entities, relationships } = normalizeDepCruiserOutput(rawOutput, {
    moduleBoundaries: options.moduleBoundaries,
  });

  const hasErrors = rawOutput.summary.violations.some(
    (v) => v.rule.severity === 'error',
  );

  return {
    entities,
    relationships,
    toolRun: {
      tool: 'dependency-cruiser',
      version: getDepCruiserVersion(),
      aspect: 'dependencyGraph',
      exitCode: hasErrors ? 1 : 0,
      duration,
      warnings: extractWarnings(rawOutput),
    },
  };
}
