/**
 * @module reference-graph
 *
 * Symbol-level reference graph collector adapter.
 *
 * Wraps the TypeScript compiler API to walk all production source files and
 * emit scored, weighted reference edges between entities. The output is:
 *   - Relationship[] entries (raw edges) merged into the IR
 *   - A ReferenceGraphSignal carrying the scored view + summary
 *
 * Consumed by the dead-code detector, SOLID calculator, structural pipeline,
 * and LLM priority reader.
 */

import * as path from 'node:path';
import * as ts from 'typescript';
import type {
  Entity,
  Relationship,
  ReferenceGraphSignal,
  ReferenceEdge,
  SourceRange,
} from '@aspect/contracts';
import {
  buildProgram,
  loadTsconfig,
  findTsconfig,
  collectDevDeps,
  getProdSourceFiles,
  collectAllReferencesOnce,
  resolveAlias,
  DEFAULT_SKIP_DIRS,
} from '@aspect/collector-shared';

// ── Public types ────────────────────────────────────────────────────────────

export interface ReferenceGraphAdapterOptions {
  rootDir: string;
  tsConfigPath?: string;
  skipDirs?: Set<string>;
  progressEvery?: number;
}

export interface ReferenceGraphAdapterResult {
  relationships: Relationship[];
  signal: ReferenceGraphSignal;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a map from ts.Symbol → Entity.id by matching on file path, kind, and name.
 * This is the join point between the reference walker and the AST visitor's entities.
 */
function buildSymbolToEntityMap(
  entities: Entity[],
  checker: ts.TypeChecker,
  prodFiles: Map<string, ts.SourceFile>
): Map<ts.Symbol, string> {
  const map = new Map<ts.Symbol, string>();

  // Index entities by (filePath, kind, name) for fast lookup
  const byKey = new Map<string, Entity[]>();
  for (const entity of entities) {
    const key = `${entity.filePath}|${entity.kind}|${entity.name}`;
    const list = byKey.get(key) ?? [];
    list.push(entity);
    byKey.set(key, list);
  }

  // Walk all exported symbols and try to match them to entities
  for (const [, sourceFile] of prodFiles) {
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!moduleSymbol) continue;

    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const resolved = resolveAlias(symbol, checker);
      const decl = resolved.declarations?.[0];
      if (!decl) continue;

      const filePath = path.relative(
        path.dirname(findTsconfig(path.resolve('.')) ?? '.'),
        decl.getSourceFile().fileName
      ).replaceAll('\\', '/');

      const kind = symbolKindToEntityKind(resolved);
      const name = resolved.escapedName.toString();

      const key = `${filePath}|${kind}|${name}`;
      const candidates = byKey.get(key);
      if (candidates && candidates.length > 0) {
        // Take the first matching entity (deterministic by file order)
        const entity = candidates[0];
        map.set(resolved, entity.id);
      }
    }
  }

  return map;
}

/**
 * Map a ts.Symbol to the closest Entity.kind string.
 */
function symbolKindToEntityKind(symbol: ts.Symbol): string {
  const flags = symbol.flags;
  if (ts.SymbolFlags.Class & flags) return 'class';
  if (ts.SymbolFlags.Function & flags) return 'function';
  if (ts.SymbolFlags.Interface & flags) return 'interface';
  if (ts.SymbolFlags.TypeAlias & flags) return 'type-alias';
  if (ts.SymbolFlags.Enum & flags) return 'enum';
  if (ts.SymbolFlags.Variable & flags) return 'variable';
  return 'unknown';
}

/**
 * Convert a ts.SourceFile line/column to a SourceRange.
 */
function toSourceRange(
  sourceFile: ts.SourceFile,
  start: number,
  end: number = start
): SourceRange {
  const startPos = sourceFile.getLineAndCharacterOfPosition(start);
  const endPos = sourceFile.getLineAndCharacterOfPosition(end);
  return {
    startLine: startPos.line + 1,
    startColumn: startPos.character,
    endLine: endPos.line + 1,
    endColumn: endPos.character,
  };
}

/**
 * Map our internal ReferenceKind to the Relationship.kind enum in the IR.
 */
function mapReferenceKind(kind: string): Relationship['kind'] {
  switch (kind) {
    case 'value':
      return 'reference';
    case 'type':
      return 'reference';
    case 'implements':
      return 'implement';
    case 'extends':
      return 'extend';
    case 'export':
      return 're-export';
    case 'import':
      return 'reference';
    default:
      return 'reference';
  }
}

// ── Main adapter ────────────────────────────────────────────────────────────

export async function runReferenceGraphAdapter(
  options: ReferenceGraphAdapterOptions,
  entities: Entity[]
): Promise<ReferenceGraphAdapterResult> {
  const rootDir = path.resolve(options.rootDir);
  const tsConfigPath = options.tsConfigPath ?? findTsconfig(rootDir);
  if (!tsConfigPath) {
    throw new Error(`No tsconfig.json found in ${rootDir} or parent directories.`);
  }

  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const { excludePatterns } = loadTsconfig(tsConfigPath);

  process.stderr.write(`Loading tsconfig: ${tsConfigPath}\n`);
  const program = buildProgram(tsConfigPath);

  const devDeps = collectDevDeps(rootDir);
  const { prodFiles, testFiles } = getProdSourceFiles(program, excludePatterns, skipDirs, devDeps);

  process.stderr.write(
    `Analyzing ${prodFiles.size} prod files (${testFiles.size} test files excluded)...\n`
  );

  const checker = program.getTypeChecker();

  // Build symbol → entityId map
  const symbolToEntity = buildSymbolToEntityMap(entities, checker, prodFiles);

  // Collect all references
  const allRefs = collectAllReferencesOnce(checker, prodFiles, rootDir, options.progressEvery ?? 50);

  // Build relationships and signal edges
  const relationships: Relationship[] = [];
  const signalEdges: ReferenceEdge[] = [];
  const byKind: Record<string, number> = {};
  const byScope: Record<string, number> = {};
  let unresolvedCount = 0;

  for (const [symbol, refs] of allRefs) {
    const targetEntityId = symbolToEntity.get(symbol) ?? null;
    if (!targetEntityId) {
      unresolvedCount += refs.length;
      continue;
    }

    for (const ref of refs) {
      const sourceFile = program.getSourceFile(ref.filePath);
      if (!sourceFile) continue;

      const sourceRange = toSourceRange(sourceFile, 0); // approximate; real pos not tracked here

      const relKind = mapReferenceKind(ref.kind);

      relationships.push({
        sourceEntityId: `file:${ref.filePath}`, // approximate; will be refined
        targetEntityId,
        kind: relKind,
        sourceFilePath: ref.filePath,
        targetFilePath: null,
        sourceRange,
        targetRange: null,
        resolutionKind: 'resolved',
        targetClassification: 'unknown',
        targetIsAbstraction: false,
        consumedMembers: null,
        targetTotalMembers: null,
        crossModule: ref.scope === 'cross_package',
        crossPackage: ref.scope === 'cross_package',
        thirdParty: false,
        typeOnly: ref.kind === 'type',
        dynamic: false,
      });

      let signalKind: ReferenceEdge['kind'];
      if (relKind === 're-export') {
        signalKind = 're-export';
      } else if (ref.kind === 'implements') {
        signalKind = 'implement';
      } else if (ref.kind === 'extends') {
        signalKind = 'extend';
      } else {
        signalKind = 'reference';
      }

      signalEdges.push({
        sourceEntityId: `file:${ref.filePath}`,
        targetEntityId,
        kind: signalKind,
        scope: ref.scope,
        score: ref.score,
        isBarrel: ref.isBarrel,
        sourceRange,
        targetRange: null,
        resolutionKind: 'resolved',
      });

      byKind[relKind] = (byKind[relKind] ?? 0) + 1;
      byScope[ref.scope] = (byScope[ref.scope] ?? 0) + 1;
    }
  }

  const signal: ReferenceGraphSignal = {
    source: {
      tool: 'reference-graph',
      version: '0.1.0',
      rootDir: path.relative(rootDir, rootDir) || '.',
      tsconfig: path.relative(rootDir, tsConfigPath),
      prodFileCount: prodFiles.size,
      testFileCount: testFiles.size,
    },
    edges: signalEdges,
    summary: {
      totalEdges: signalEdges.length,
      byKind,
      byScope,
      unresolvedCount,
    },
  };

  return { relationships, signal };
}