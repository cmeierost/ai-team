#!/usr/bin/env node
/**
 * Symbol-level dead code analyzer — monorepo-wide, TypeChecker-based.
 *
 * Collects ALL reference data for every exported entity:
 *  - Reference kind (type, value, implements, extends, export, import)
 *  - Scope level (same_file → cross_package, with barrel awareness)
 *  - Score (weighted by scope × kind matrix)
 *  - Dead parameters (constructor/method params never used in body)
 *  - Interface implementers
 *  - Fan-in / fan-out (for future centrality/clustering)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';

// Re-export shared types and helpers from @aspect/collector-shared
import type { ReferenceKind, ScopeLevel, SymbolReference } from '@aspect/collector-shared';
import {
  SCORE_MATRIX,
  resolveAlias,
  getSymbolKind,
  getSymbolLine,
  classifyReferenceKind,
  isDeclarationIdentifier,
  isBarrelFile,
  getPackageName,
  determineScope,
  collectAllReferencesOnce,
  findAllReferences,
  loadTsconfig,
  findTsconfig,
  buildProgram,
  getProdSourceFiles,
  collectDevDeps,
  DEFAULT_SKIP_DIRS,
} from '@aspect/collector-shared';

export {
  SCORE_MATRIX,
  resolveAlias,
  getSymbolKind,
  getSymbolLine,
  classifyReferenceKind,
  isDeclarationIdentifier,
  isBarrelFile,
  getPackageName,
  determineScope,
  collectAllReferencesOnce,
  findAllReferences,
  loadTsconfig,
  findTsconfig,
  buildProgram,
  getProdSourceFiles,
  collectDevDeps,
  DEFAULT_SKIP_DIRS,
} from '@aspect/collector-shared';
export type { ReferenceKind, ScopeLevel, SymbolReference } from '@aspect/collector-shared';

export interface SymbolMember {
  memberId: string;
  parentEntityId: string;
  parentName: string;
  filePath: string;
  name: string;
  kind: 'method' | 'property' | 'field';
  line: number;
  isExported: boolean;
  references: SymbolReference[];
  refCount: number;
}

export interface SymbolEntity {
  entityId: string;
  filePath: string;
  packageName: string;
  folder: string;
  name: string;
  kind: string;
  line: number;
  isExported: boolean;
  isReExport: boolean;
  references: SymbolReference[];
  refCount: number;
  score: number;
  scoreBreakdown: {
    byScope: Record<ScopeLevel, number>;
    byKind: Record<ReferenceKind, number>;
  };
  fanIn: number;
  fanOut: number;
  implementers: { entityId: string; name: string; filePath: string }[];
  implementsInterfaces: { entityId: string; name: string; filePath: string }[];
  deadParameters: { paramName: string; parentName: string; line: number }[];
  members: SymbolMember[];
  deadMembers: SymbolMember[];
}

export type RecommendationType =
  | 'remove_dead_export'
  | 'make_package_internal'
  | 'make_private'
  | 'remove_dead_parameter'
  | 'remove_dead_reexport'
  | 'remove_dead_interface_method'
  | 'introduce_barrel'
  | 'route_through_barrel';

export interface Recommendation {
  type: RecommendationType;
  filePath: string;
  line: number;
  entityName: string;
  message: string;
}

export interface AnalysisResult {
  rootDir: string;
  tsconfig: string;
  prodFileCount: number;
  testFileCount: number;
  entities: SymbolEntity[];
  deadEntities: SymbolEntity[];
  recommendations: Recommendation[];
  summary: {
    total: number;
    dead: number;
    exported: number;
    deadExported: number;
    byKind: Record<string, { total: number; dead: number }>;
    byPackage: Record<string, { total: number; dead: number }>;
    byScope: {
      same_file_only: number;
      same_folder_only: number;
      same_package_only: number;
      cross_package: number;
    };
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────
// All shared helpers are re-exported from @aspect/collector-shared at the top of this file.
// Local helpers below are specific to the dead-code analyzer's entity model.

function getFolder(filePath: string): string {
  return path.dirname(filePath);
}

function getModuleSymbol(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): ts.Symbol | undefined {
  return checker.getSymbolAtLocation(sourceFile);
}

/**
 * Filter a symbol's references to exclude declaration positions.
 * The single-pass collector doesn't store raw positions, so we skip this filter.
 * Declaration self-references are minimal noise and don't affect dead code detection.
 */
function filterDeclarationPositions(
  refs: SymbolReference[],
  _symbol: ts.Symbol
): SymbolReference[] {
  return refs;
}

// ── Member-level reference counting ──────────────────────────────────────────

function collectMembers(
  symbol: ts.Symbol,
  checker: ts.TypeChecker,
  prodFiles: Map<string, ts.SourceFile>,
  rootDir: string
): SymbolMember[] {
  const members: SymbolMember[] = [];
  const parentName = symbol.escapedName.toString();
  const parentEntityId = `${symbol.declarations![0].getSourceFile().fileName}#${parentName}`;

  // Get members via type
  const decl = symbol.declarations?.[0];
  if (!decl) return members;
  const parentType = checker.getTypeOfSymbolAtLocation(symbol, decl);
  const properties = parentType.getProperties();

  for (const prop of properties) {
    const propDecl = prop.declarations?.[0];
    if (!propDecl) continue;
    const propFile = propDecl.getSourceFile();
    if (!prodFiles.has(propFile.fileName)) continue;

    const propName = prop.escapedName.toString();
    const propLine = propFile.getLineAndCharacterOfPosition(propDecl.getStart(propFile)).line + 1;

    // Determine member kind
    let memberKind: SymbolMember['kind'] = 'property';
    if (ts.isMethodDeclaration(propDecl) || ts.isMethodSignature(propDecl)) {
      memberKind = 'method';
    } else if (ts.isPropertyDeclaration(propDecl) || ts.isPropertySignature(propDecl)) {
      memberKind = 'field';
    }

    // Count references to this member
    const memberRefs = findAllReferences(prop, checker, prodFiles, rootDir);

    members.push({
      memberId: `${propFile.fileName}#${propName}`,
      parentEntityId,
      parentName,
      filePath: propFile.fileName,
      name: propName,
      kind: memberKind,
      line: propLine,
      isExported: true,
      references: memberRefs,
      refCount: memberRefs.length,
    });
  }

  return members;
}

// ── Parameter-level dead code ────────────────────────────────────────────────

function findDeadParameters(
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker
): { paramName: string; parentName: string; line: number }[] {
  const dead: { paramName: string; parentName: string; line: number }[] = [];

  function visitNode(node: ts.Node): void {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      const fn = node as ts.FunctionLikeDeclaration;
      const params = fn.parameters;
      const body = fn.body;
      if (!body || params.length === 0) {
        ts.forEachChild(node, visitNode);
        return;
      }

      let parentName = 'anonymous';
      if (ts.isFunctionDeclaration(node) && node.name) parentName = node.name.getText(sourceFile);
      else if (ts.isMethodDeclaration(node) && node.name)
        parentName = node.name.getText(sourceFile);
      else if (ts.isConstructorDeclaration(node)) {
        const classDecl = node.parent;
        if (ts.isClassDeclaration(classDecl) && classDecl.name)
          parentName = classDecl.name.getText(sourceFile) + '.constructor';
      }

      for (const param of params) {
        if (!ts.isIdentifier(param.name)) continue;
        const paramName = param.name.getText(sourceFile);
        const paramSymbol = checker.getSymbolAtLocation(param.name);
        if (!paramSymbol) continue;

        let used = false;
        function checkBody(n: ts.Node): void {
          if (used) return;
          if (ts.isIdentifier(n) && checker.getSymbolAtLocation(n) === paramSymbol) {
            used = true;
            return;
          }
          ts.forEachChild(n, checkBody);
        }
        checkBody(body);

        if (!used) {
          const line = sourceFile.getLineAndCharacterOfPosition(param.name.getStart()).line + 1;
          dead.push({ paramName, parentName, line });
        }
      }
    }
    ts.forEachChild(node, visitNode);
  }

  visitNode(sourceFile);
  return dead;
}

// ── Recommendations ──────────────────────────────────────────────────────────

function generateRecommendations(
  entities: SymbolEntity[],
  deadEntities: SymbolEntity[],
  rootDir: string
): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const e of deadEntities) {
    recs.push({
      type: 'remove_dead_export',
      filePath: e.filePath,
      line: e.line,
      entityName: e.name,
      message: `${e.kind} '${e.name}' is exported but has zero references (score: 0)`,
    });
  }

  for (const e of entities) {
    if (e.refCount === 0) continue;
    if (e.references.every((r) => r.scope === 'same_file')) {
      recs.push({
        type: 'make_private',
        filePath: e.filePath,
        line: e.line,
        entityName: e.name,
        message: `${e.kind} '${e.name}' is exported but only referenced within the same file — remove export`,
      });
    }
  }

  for (const e of entities) {
    if (e.refCount === 0) continue;
    const hasCrossPackage = e.references.some((r) => r.scope === 'cross_package');
    if (
      !hasCrossPackage &&
      e.references.some(
        (r) =>
          r.scope === 'same_folder' ||
          r.scope === 'sub_dir_barrel' ||
          r.scope === 'sub_dir_deep' ||
          r.scope === 'parent_barrel' ||
          r.scope === 'sibling_barrel' ||
          r.scope === 'sibling_deep'
      )
    ) {
      recs.push({
        type: 'make_package_internal',
        filePath: e.filePath,
        line: e.line,
        entityName: e.name,
        message: `${e.kind} '${e.name}' is only referenced within ${e.packageName} — could be package-internal`,
      });
    }
  }

  for (const e of entities) {
    for (const dp of e.deadParameters) {
      recs.push({
        type: 'remove_dead_parameter',
        filePath: e.filePath,
        line: dp.line,
        entityName: `${dp.parentName}(${dp.paramName})`,
        message: `Parameter '${dp.paramName}' in ${dp.parentName} is never used in the function body`,
      });
    }
  }

  for (const e of entities) {
    if (!e.isReExport) continue;
    const hasExternalImport = e.references.some(
      (r) => r.kind === 'import' && r.scope === 'cross_package'
    );
    if (!hasExternalImport) {
      recs.push({
        type: 'remove_dead_reexport',
        filePath: e.filePath,
        line: e.line,
        entityName: e.name,
        message: `Re-export of '${e.name}' has no external consumers — consider removing`,
      });
    }
  }

  const folders = new Map<string, SymbolEntity[]>();
  for (const e of entities) {
    const list = folders.get(e.folder) ?? [];
    list.push(e);
    folders.set(e.folder, list);
  }

  for (const [folder, folderEntities] of folders) {
    const indexPath = path.join(folder, 'index.ts');
    const hasBarrel = fs.existsSync(indexPath);

    // Files that are imported from by other files (not just same file)
    const filesWithExternalImports = new Set<string>();
    for (const e of folderEntities) {
      if (e.references.some((r) => r.scope !== 'same_file')) {
        filesWithExternalImports.add(e.filePath);
      }
    }

    // Count exported symbols in this folder
    const exportedCount = folderEntities.filter((e) => e.isExported).length;

    // 1. Suggest barrel for folders with multiple exported symbols but no index.ts
    if (!hasBarrel && exportedCount >= 3) {
      recs.push({
        type: 'introduce_barrel',
        filePath: indexPath,
        line: 0,
        entityName: path.basename(folder),
        message: `Folder '${path.basename(folder)}' has ${exportedCount} exported symbols across ${filesWithExternalImports.size} files but no index.ts — consider creating a barrel file to define a clean public API`,
      });
    }

    // 2. Suggest barrel for folders where multiple files are imported from externally
    if (!hasBarrel && filesWithExternalImports.size >= 2) {
      recs.push({
        type: 'introduce_barrel',
        filePath: indexPath,
        line: 0,
        entityName: path.basename(folder),
        message: `Folder '${path.basename(folder)}' has ${filesWithExternalImports.size} files imported from outside — an index.ts would consolidate the public API surface`,
      });
    }

    // 3. Suggest routing through existing barrel for deep imports
    if (hasBarrel) {
      for (const e of folderEntities) {
        const hasDeepImports = e.references.some(
          (r) =>
            r.scope === 'sub_dir_deep' ||
            r.scope === 'sibling_deep' ||
            (r.kind === 'import' && !r.isBarrel)
        );
        if (hasDeepImports && e.refCount > 0) {
          recs.push({
            type: 'route_through_barrel',
            filePath: e.filePath,
            line: e.line,
            entityName: e.name,
            message: `${e.kind} '${e.name}' in '${path.basename(folder)}' is imported via deep path — consider re-exporting from index.ts and routing imports through the barrel`,
          });
        }
      }
    }
  }

  return recs;
}

// ── Main analysis ────────────────────────────────────────────────────────────

export async function analyzeDeadCodeAsync(
  tsconfigPath: string,
  skipDirs: Set<string> = DEFAULT_SKIP_DIRS
): Promise<AnalysisResult> {
  const rootDir = path.dirname(tsconfigPath);

  process.stderr.write(`Loading tsconfig: ${tsconfigPath}\n`);
  const { excludePatterns } = loadTsconfig(tsconfigPath);

  process.stderr.write('Building TypeScript program...\n');
  const program = buildProgram(tsconfigPath);

  const allDiagnostics = ts.getPreEmitDiagnostics(program);
  const errors = allDiagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    process.stderr.write(`\n⚠ ${errors.length} compile error(s) found in program:\n`);
    for (const diag of errors.slice(0, 20)) {
      const msg = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
      const file = diag.file;
      const loc = file
        ? `${file.fileName}:${file.getLineAndCharacterOfPosition(diag.start!).line + 1}`
        : 'unknown';
      process.stderr.write(`  ${loc}: ${msg}\n`);
    }
    if (errors.length > 20) process.stderr.write(`  ... and ${errors.length - 20} more\n`);
    process.stderr.write('\n');
  }

  process.stderr.write('Collecting dev dependencies...\n');
  const devDeps = collectDevDeps(rootDir);
  process.stderr.write(`Found ${devDeps.size} dev dependency packages\n`);

  process.stderr.write('Classifying source files...\n');
  const { prodFiles, testFiles } = getProdSourceFiles(program, excludePatterns, skipDirs, devDeps);
  const checker = program.getTypeChecker();

  process.stderr.write(
    `Analyzing ${prodFiles.size} prod files (${testFiles.size} test files excluded)...\n`
  );

  const symbolMap = new Map<
    ts.Symbol,
    { exportFile: string; exportName: string; isReExport: boolean }
  >();

  process.stderr.write('  Collecting exported symbols...\n');
  for (const [filePath, sourceFile] of prodFiles) {
    const moduleSymbol = getModuleSymbol(sourceFile, checker);
    if (!moduleSymbol) continue;
    for (const symbol of checker.getExportsOfModule(moduleSymbol)) {
      const resolved = resolveAlias(symbol, checker);
      const isReExport = resolved !== symbol;
      if (!symbolMap.has(resolved)) {
        symbolMap.set(resolved, {
          exportFile: filePath,
          exportName: symbol.escapedName.toString(),
          isReExport,
        });
      }
    }
  }

  process.stderr.write(`  Found ${symbolMap.size} unique exported symbols\n`);

  // Single-pass: walk all files once, collect all symbol→references
  process.stderr.write('  Scanning all files for references...\n');
  const allRefs = collectAllReferencesOnce(checker, prodFiles, rootDir);

  process.stderr.write('  Building entities...\n');
  const entities: SymbolEntity[] = [];
  let idx = 0;

  for (const [symbol, exportInfo] of symbolMap) {
    const decl = symbol.declarations?.[0];
    if (!decl) continue;
    const declFile = decl.getSourceFile();
    const declFilePath = declFile.fileName;
    const declLine = declFile.getLineAndCharacterOfPosition(decl.getStart(declFile)).line + 1;

    const rawRefs = allRefs.get(symbol) ?? [];
    const refs = filterDeclarationPositions(rawRefs, symbol);

    let score = 0;
    const byScope: Record<ScopeLevel, number> = {
      same_file: 0,
      same_folder: 0,
      sub_dir_barrel: 0,
      sub_dir_deep: 0,
      parent_barrel: 0,
      sibling_barrel: 0,
      sibling_deep: 0,
      cross_package: 0,
    };
    const byKind: Record<ReferenceKind, number> = {
      value: 0,
      type: 0,
      implements: 0,
      extends: 0,
      export: 0,
      import: 0,
      other: 0,
    };

    for (const ref of refs) {
      score += ref.score;
      byScope[ref.scope]++;
      byKind[ref.kind]++;
    }

    const fanInFiles = new Set(refs.map((r) => r.filePath));

    entities.push({
      entityId: `${declFilePath}#${symbol.escapedName}`,
      filePath: declFilePath,
      packageName: getPackageName(declFilePath, rootDir),
      folder: getFolder(declFilePath),
      name: symbol.escapedName.toString(),
      kind: getSymbolKind(symbol),
      line: declLine,
      isExported: true,
      isReExport: exportInfo.isReExport,
      references: refs,
      refCount: refs.length,
      score,
      scoreBreakdown: { byScope, byKind },
      fanIn: fanInFiles.size,
      fanOut: 0,
      implementers: [],
      implementsInterfaces: [],
      deadParameters: [],
      members: [],
      deadMembers: [],
    });

    idx++;
    if (idx % 100 === 0 || idx === symbolMap.size) {
      const pct = ((idx / symbolMap.size) * 100).toFixed(0);
      process.stderr.write(`    \r    ${idx}/${symbolMap.size} symbols processed (${pct}%)`);
    }
  }
  process.stderr.write('\n');

  // Post-processing
  process.stderr.write('  Post-processing: members, interfaces, dead params, fan-out...\n');

  // Collect members for interfaces, classes, and type aliases
  let totalMembersCollected = 0;
  let totalDeadMembers = 0;
  for (const entity of entities) {
    if (entity.kind !== 'interface' && entity.kind !== 'class' && entity.kind !== 'type_alias')
      continue;
    // Find the original symbol from symbolMap by matching name + file
    let targetSymbol: ts.Symbol | undefined;
    for (const [s, info] of symbolMap) {
      if (info.exportName === entity.name && info.exportFile === entity.filePath) {
        targetSymbol = s;
        break;
      }
    }
    if (!targetSymbol) continue;
    const members = collectMembers(targetSymbol, checker, prodFiles, rootDir);
    entity.members = members;
    entity.deadMembers = members.filter((m) => m.refCount === 0);
    totalMembersCollected += members.length;
    totalDeadMembers += entity.deadMembers.length;
  }

  process.stderr.write(`  Collected ${totalMembersCollected} members (${totalDeadMembers} dead)\n`);

  // Interface implementers — scan all class declarations for `implements InterfaceName`
  for (const entity of entities) {
    if (entity.kind !== 'interface') continue;
    for (const sourceFile of program.getSourceFiles()) {
      if (!prodFiles.has(sourceFile.fileName)) continue;
      ts.forEachChild(sourceFile, function visit(node: ts.Node) {
        if (ts.isClassDeclaration(node) && node.heritageClauses) {
          for (const clause of node.heritageClauses) {
            if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
              for (const expr of clause.types) {
                if (ts.isIdentifier(expr.expression) && expr.expression.text === entity.name) {
                  const implEntity = entities.find(
                    (e) =>
                      e.filePath === sourceFile.fileName &&
                      e.name === node.name?.text &&
                      e.kind === 'class'
                  );
                  if (implEntity) {
                    entity.implementers.push({
                      entityId: implEntity.entityId,
                      name: implEntity.name,
                      filePath: implEntity.filePath,
                    });
                  }
                }
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      });
    }
  }

  // Implements interfaces
  const entityBySymbol = new Map<ts.Symbol, SymbolEntity>();
  for (const entity of entities) {
    const declFile = prodFiles.get(entity.filePath);
    if (!declFile) continue;
    const moduleSymbol = getModuleSymbol(declFile, checker);
    if (!moduleSymbol) continue;
    for (const sym of checker.getExportsOfModule(moduleSymbol)) {
      const resolved = resolveAlias(sym, checker);
      if (resolved.escapedName === entity.name) {
        entityBySymbol.set(resolved, entity);
        break;
      }
    }
  }

  for (const entity of entities) {
    if (entity.kind !== 'class') continue;
    const declFile = prodFiles.get(entity.filePath);
    if (!declFile) continue;
    const moduleSymbol = getModuleSymbol(declFile, checker);
    if (!moduleSymbol) continue;
    for (const sym of checker.getExportsOfModule(moduleSymbol)) {
      const resolved = resolveAlias(sym, checker);
      if (resolved.escapedName !== entity.name || !(ts.SymbolFlags.Class & resolved.flags))
        continue;
      const classType = checker.getTypeOfSymbolAtLocation(resolved, resolved.declarations![0]);
      const classTypeFlags = classType.flags;
      if (classTypeFlags & ts.TypeFlags.Object) {
        const objType = classType as ts.ObjectType;
        const baseTypes = objType.getBaseTypes?.();
        if (!baseTypes) continue;
        for (const baseType of baseTypes) {
          const baseSymbol = baseType.symbol;
          if (!baseSymbol) continue;
          const baseEntity = entityBySymbol.get(baseSymbol);
          if (baseEntity) {
            entity.implementsInterfaces.push({
              entityId: baseEntity.entityId,
              name: baseEntity.name,
              filePath: baseEntity.filePath,
            });
          }
        }
      }
    }
  }

  // Dead parameters
  for (const [filePath, sourceFile] of prodFiles) {
    const deadParams = findDeadParameters(sourceFile, checker);
    if (deadParams.length === 0) continue;
    const entity = entities.find((e) => e.filePath === filePath);
    if (entity) entity.deadParameters.push(...deadParams);
  }

  // Fan-out
  for (const entity of entities) {
    const referencedEntityIds = new Set<string>();
    for (const other of entities) {
      for (const ref of other.references) {
        if (ref.filePath === entity.filePath) referencedEntityIds.add(other.entityId);
      }
    }
    entity.fanOut = referencedEntityIds.size;
  }

  const deadEntities = entities.filter((e) => e.isExported && e.refCount === 0);

  process.stderr.write('  Generating recommendations...\n');
  const recommendations = generateRecommendations(entities, deadEntities, rootDir);

  // Summary
  const byKind: Record<string, { total: number; dead: number }> = {};
  const byPackage: Record<string, { total: number; dead: number }> = {};
  for (const e of entities) {
    byKind[e.kind] = byKind[e.kind] || { total: 0, dead: 0 };
    byKind[e.kind].total++;
    byPackage[e.packageName] = byPackage[e.packageName] || { total: 0, dead: 0 };
    byPackage[e.packageName].total++;
  }
  for (const e of deadEntities) {
    byKind[e.kind].dead++;
    byPackage[e.packageName].dead++;
  }

  const sameFileOnly = entities.filter(
    (e) => e.refCount > 0 && e.references.every((r) => r.scope === 'same_file')
  ).length;
  const sameFolderOnly =
    entities.filter(
      (e) =>
        e.refCount > 0 &&
        e.references.every((r) => r.scope === 'same_file' || r.scope === 'same_folder')
    ).length - sameFileOnly;
  const samePackageOnly =
    entities.filter((e) => e.refCount > 0 && !e.references.some((r) => r.scope === 'cross_package'))
      .length -
    sameFileOnly -
    sameFolderOnly;
  const crossPackage = entities.filter((e) =>
    e.references.some((r) => r.scope === 'cross_package')
  ).length;

  return {
    rootDir,
    tsconfig: tsconfigPath,
    prodFileCount: prodFiles.size,
    testFileCount: testFiles.size,
    entities,
    deadEntities,
    recommendations,
    summary: {
      total: entities.length,
      dead: deadEntities.length,
      exported: entities.filter((e) => e.isExported).length,
      deadExported: deadEntities.length,
      byKind,
      byPackage,
      byScope: {
        same_file_only: sameFileOnly,
        same_folder_only: sameFolderOnly,
        same_package_only: samePackageOnly,
        cross_package: crossPackage,
      },
    },
  };
}
