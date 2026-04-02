/**
 * dependency-cruiser adapter for @aspect/collector-typescript.
 *
 * Runs dependency-cruiser on a target directory and normalizes the output into
 * the intermediate schema (entities + relationships).
 */

import * as path from 'node:path';
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

  for (const mod of rawOutput.modules) {
    const filePath = mod.source.replace(/\\/g, '/').replace(/^\.\//, '');
    const entityId = makeEntityId(filePath);

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

    for (const dep of mod.dependencies) {
      const targetPath = dep.resolved.replace(/\\/g, '/').replace(/^\.\//, '');
      const targetId = makeEntityId(targetPath);

      relationships.push({
        sourceEntityId: entityId,
        targetEntityId: targetId,
        kind: 'import',
        sourceRange: null,
        targetClassification: 'unknown',
        targetIsAbstraction: false,
        consumedMembers: null,
        targetTotalMembers: null,
        crossModule: isCrossModule(filePath, targetPath, boundaries),
        crossPackage: isCrossPackage(dep.resolved),
        thirdParty: isThirdParty(dep),
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

  const absoluteSrcDirs = srcDirs.map((dir) => path.resolve(rootDir, dir));

  const result = await cruise(absoluteSrcDirs, {
    outputType: 'json',
    ...cruiseOptions,
  });

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
