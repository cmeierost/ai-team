// @aspect/engine — SOLID principle indicators
// Calculates heuristic scores for each SOLID principle from collected data.
// Pure math — no source code access or I/O. Scores are [0, 1] where lower = worse.

import type { Lcom4Result } from './cohesion.js';
import type { SourceLocation } from './location.js';

// ── Local input shapes (mirrors @aspect/contracts) ──

export interface Entity {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  sourceRange?: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null;
  classification?: {
    isAbstract: boolean;
    isInterface: boolean;
    isConcrete: boolean;
    isTypeOnly: boolean;
    isExported: boolean;
    visibility: string | null;
  };
  nameTokens?: string[];
  rawCounts?: {
    linesOfCode?: number;
    typeCheckingPatterns?: number | null;
    conditionalDispatchLocations?: Array<{
      line: number;
      kind: string;
      branchCount: number;
    }> | null;
    extensionPoints?: number | null;
    publicMethodCount?: number | null;
    publicPropertyCount?: number | null;
    overriddenMethods?: Array<{
      name: string;
      paramTypes: string[];
      returnType: string | null;
    }> | null;
  } | null;
  methodFieldAccessMatrix?: Array<{
    methodName: string;
    accessedFields: string[];
  }> | null;
}

export interface Relationship {
  sourceEntityId: string;
  targetEntityId: string;
  kind: string;
  targetClassification?: string;
  targetIsAbstraction?: boolean;
  consumedMembers?: string[] | null;
  targetTotalMembers?: number | null;
  crossModule?: boolean;
}

export interface ModuleBoundary {
  moduleId: string;
  modulePath: string;
  files: string[];
  declaredLayer?: number | null;
}

// ── Result types ──

export interface SrpIndicator {
  entityId: string;
  location?: SourceLocation;
  lcom4: number;
  importSourceDiversity: number;
  responsibilityGroupCount: number;
  nameSemanticClusters: string[][];
  /** 0–1 composite (lower = worse SRP). */
  srpScore: number;
}

export interface OcpIndicator {
  entityId: string;
  location?: SourceLocation;
  typeCheckingDensity: number;
  conditionalDispatchCount: number;
  extensionPointRatio: number;
  concreteTargetRatio: number;
  /** 0–1 (lower = worse OCP). */
  ocpScore: number;
}

export interface IspIndicator {
  entityId: string;
  location?: SourceLocation;
  avgUsageRatio: number;
  minUsageRatio: number;
  consumerCount: number;
  suggestedSplits: Array<{
    members: string[];
    consumers: string[];
  }>;
  /** 0–1 (lower = fatter interface). */
  ispScore: number;
}

export interface DipIndicator {
  entityId: string;
  location?: SourceLocation;
  abstractionDependencyRatio: number;
  concreteDependencyCount: number;
  layerViolationCount: number;
  /** 0–1 (lower = more concrete deps). */
  dipScore: number;
}

export interface LspIndicator {
  entityId: string;
  location?: SourceLocation;
  overrideCount: number;
  signatureMismatches: Array<{
    methodName: string;
    baseParams: string[];
    overrideParams: string[];
    baseReturn: string | null;
    overrideReturn: string | null;
  }>;
  /** 1.0 minus penalty per mismatch. */
  lspScore: number;
}

export interface SolidResults {
  srp: SrpIndicator[];
  ocp: OcpIndicator[];
  isp: IspIndicator[];
  dip: DipIndicator[];
  lsp: LspIndicator[];
}

// ── Helpers ──

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ── SRP (Single Responsibility) ──

function clusterMethodsByNameTokens(methods: Entity[]): string[][] {
  if (methods.length === 0) return [];

  const tokenSets = methods.map(m => new Set(m.nameTokens ?? [m.name]));
  const names = methods.map(m => m.name);

  // Union-find
  const parent = names.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number): void {
    parent[find(a)] = find(b);
  }

  for (let i = 0; i < methods.length; i++) {
    for (let j = i + 1; j < methods.length; j++) {
      if (jaccard(tokenSets[i], tokenSets[j]) > 0.3) {
        union(i, j);
      }
    }
  }

  const clusters = new Map<number, string[]>();
  for (let i = 0; i < names.length; i++) {
    const root = find(i);
    const cluster = clusters.get(root) ?? [];
    cluster.push(names[i]);
    clusters.set(root, cluster);
  }

  return [...clusters.values()].map(c => c.sort());
}

function calculateSrp(
  entities: Entity[],
  relationships: Relationship[],
  lcom4Results: Lcom4Result[],
  locationMap: Map<string, SourceLocation>,
): SrpIndicator[] {
  const lcom4Map = new Map(lcom4Results.map(r => [r.entityId, r]));
  const entityMap = new Map(entities.map(e => [e.id, e]));
  const results: SrpIndicator[] = [];

  for (const entity of entities) {
    const lcom4 = lcom4Map.get(entity.id);
    if (!lcom4) continue;

    // Import source diversity: distinct target file paths from same-file imports
    const fileEntityIds = new Set(
      entities.filter(e => e.filePath === entity.filePath).map(e => e.id),
    );
    const importTargetFiles = new Set<string>();
    for (const rel of relationships) {
      if (rel.kind === 'import' && fileEntityIds.has(rel.sourceEntityId)) {
        const target = entityMap.get(rel.targetEntityId);
        if (target) importTargetFiles.add(target.filePath);
      }
    }
    const importSourceDiversity = importTargetFiles.size;

    // Name semantic clusters: group child methods by nameToken similarity
    const childMethodIds = relationships
      .filter(r => r.sourceEntityId === entity.id && r.kind === 'contain')
      .map(r => r.targetEntityId);
    const childMethods = childMethodIds
      .map(id => entityMap.get(id))
      .filter((e): e is Entity => e != null && e.kind === 'method');
    const nameSemanticClusters = clusterMethodsByNameTokens(childMethods);

    // SRP score = 1/max(lcom4,1) × diversity penalty
    const diversityPenalty = 1 / (1 + Math.max(0, importSourceDiversity - 3) * 0.1);
    const srpScore = clamp01((1 / Math.max(lcom4.lcom4, 1)) * diversityPenalty);

    results.push({
      entityId: entity.id,
      location: locationMap.get(entity.id),
      lcom4: lcom4.lcom4,
      importSourceDiversity,
      responsibilityGroupCount: lcom4.lcom4,
      nameSemanticClusters,
      srpScore,
    });
  }

  return results;
}

// ── OCP (Open/Closed) ──

function calculateOcp(
  entities: Entity[],
  relationships: Relationship[],
  locationMap: Map<string, SourceLocation>,
): OcpIndicator[] {
  const results: OcpIndicator[] = [];

  for (const entity of entities) {
    const raw = entity.rawCounts;
    if (!raw) continue;

    const loc = raw.linesOfCode ?? 0;
    const typeChecks = raw.typeCheckingPatterns ?? 0;
    const dispatches = raw.conditionalDispatchLocations ?? [];
    const extPoints = raw.extensionPoints ?? 0;
    const pubMethods = raw.publicMethodCount ?? 0;

    const typeCheckingDensity = loc > 0 ? typeChecks / loc : 0;
    const conditionalDispatchCount = dispatches.length;
    const extensionPointRatio = pubMethods > 0 ? extPoints / pubMethods : 1;

    // Concrete target ratio from outgoing dependencies
    const outgoing = relationships.filter(r => r.sourceEntityId === entity.id);
    const totalDeps = outgoing.length;
    const concreteDeps = outgoing.filter(r => r.targetIsAbstraction === false).length;
    const concreteTargetRatio = totalDeps > 0 ? concreteDeps / totalDeps : 0;

    // OCP score: weighted combination of three components
    const typeCheckScore = Math.max(0, 1 - typeCheckingDensity * 50);
    const extScore = extensionPointRatio;
    const concreteScore = 1 - concreteTargetRatio;

    const ocpScore = clamp01(
      0.4 * typeCheckScore + 0.3 * extScore + 0.3 * concreteScore,
    );

    results.push({
      entityId: entity.id,
      location: locationMap.get(entity.id),
      typeCheckingDensity,
      conditionalDispatchCount,
      extensionPointRatio,
      concreteTargetRatio,
      ocpScore,
    });
  }

  return results;
}

// ── ISP (Interface Segregation) ──

function clusterMembersByUsage(
  consumerRels: Relationship[],
): Array<{ members: string[]; consumers: string[] }> {
  const allMembers = new Set<string>();
  for (const rel of consumerRels) {
    for (const m of rel.consumedMembers ?? []) allMembers.add(m);
  }
  const members = [...allMembers];
  if (members.length === 0) return [];

  // Connected components on member co-occurrence graph
  const memberIndex = new Map(members.map((m, i) => [m, i]));
  const parent = members.map((_, i) => i);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number): void {
    parent[find(a)] = find(b);
  }

  for (const rel of consumerRels) {
    const consumed = rel.consumedMembers ?? [];
    for (let i = 0; i < consumed.length; i++) {
      for (let j = i + 1; j < consumed.length; j++) {
        union(memberIndex.get(consumed[i])!, memberIndex.get(consumed[j])!);
      }
    }
  }

  const componentMembers = new Map<number, string[]>();
  for (let i = 0; i < members.length; i++) {
    const root = find(i);
    const list = componentMembers.get(root) ?? [];
    list.push(members[i]);
    componentMembers.set(root, list);
  }

  return [...componentMembers.values()].map(memberGroup => {
    const memberSet = new Set(memberGroup);
    const consumers = consumerRels
      .filter(r => (r.consumedMembers ?? []).some(m => memberSet.has(m)))
      .map(r => r.sourceEntityId);
    return {
      members: memberGroup.sort(),
      consumers: [...new Set(consumers)].sort(),
    };
  });
}

function calculateIsp(
  entities: Entity[],
  relationships: Relationship[],
  locationMap: Map<string, SourceLocation>,
): IspIndicator[] {
  const results: IspIndicator[] = [];

  // Group relationships by target entity (only those with usage data)
  const targetRelMap = new Map<string, Relationship[]>();
  for (const rel of relationships) {
    if (
      rel.consumedMembers != null &&
      rel.consumedMembers.length > 0 &&
      rel.targetTotalMembers != null &&
      rel.targetTotalMembers > 0
    ) {
      const list = targetRelMap.get(rel.targetEntityId) ?? [];
      list.push(rel);
      targetRelMap.set(rel.targetEntityId, list);
    }
  }

  for (const [targetId, consumerRels] of targetRelMap) {
    const totalMembers = consumerRels[0].targetTotalMembers!;

    const usageRatios = consumerRels.map(
      r => (r.consumedMembers?.length ?? 0) / totalMembers,
    );

    const avgUsageRatio =
      usageRatios.reduce((a, b) => a + b, 0) / usageRatios.length;
    const minUsageRatio = Math.min(...usageRatios);

    const suggestedSplits = clusterMembersByUsage(consumerRels);

    const ispScore = clamp01(avgUsageRatio);

    results.push({
      entityId: targetId,
      location: locationMap.get(targetId),
      avgUsageRatio,
      minUsageRatio,
      consumerCount: consumerRels.length,
      suggestedSplits,
      ispScore,
    });
  }

  return results;
}

// ── DIP (Dependency Inversion) ──

function calculateDip(
  entities: Entity[],
  relationships: Relationship[],
  moduleBoundaries: ModuleBoundary[],
  locationMap: Map<string, SourceLocation>,
): DipIndicator[] {
  // Build file → declared layer map
  const fileLayerMap = new Map<string, number>();
  for (const mb of moduleBoundaries) {
    if (mb.declaredLayer != null) {
      for (const file of mb.files) {
        fileLayerMap.set(file, mb.declaredLayer);
      }
    }
  }

  const entityMap = new Map(entities.map(e => [e.id, e]));
  const results: DipIndicator[] = [];

  for (const entity of entities) {
    const outgoing = relationships.filter(r => r.sourceEntityId === entity.id);
    if (outgoing.length === 0) continue;

    const abstractDeps = outgoing.filter(
      r => r.targetIsAbstraction === true,
    ).length;
    const concreteDeps = outgoing.filter(
      r => r.targetIsAbstraction === false,
    ).length;
    const totalClassified = abstractDeps + concreteDeps;
    const abstractionDependencyRatio =
      totalClassified > 0 ? abstractDeps / totalClassified : 1;

    // Layer violations: higher declaredLayer = more abstract/core.
    // A violation is when a core module depends on a less-abstract module.
    const sourceLayer = fileLayerMap.get(entity.filePath);
    let layerViolationCount = 0;
    if (sourceLayer != null) {
      for (const rel of outgoing) {
        const target = entityMap.get(rel.targetEntityId);
        if (!target) continue;
        const targetLayer = fileLayerMap.get(target.filePath);
        if (targetLayer != null && sourceLayer > targetLayer) {
          layerViolationCount++;
        }
      }
    }

    const dipScore = clamp01(abstractionDependencyRatio);

    results.push({
      entityId: entity.id,
      location: locationMap.get(entity.id),
      abstractionDependencyRatio,
      concreteDependencyCount: concreteDeps,
      layerViolationCount,
      dipScore,
    });
  }

  return results;
}

// ── LSP (Liskov Substitution) ──

function calculateLsp(
  entities: Entity[],
  relationships: Relationship[],
  locationMap: Map<string, SourceLocation>,
): LspIndicator[] {
  const entityMap = new Map(entities.map(e => [e.id, e]));
  const results: LspIndicator[] = [];

  for (const entity of entities) {
    const extendRel = relationships.find(
      r => r.sourceEntityId === entity.id && r.kind === 'extend',
    );
    if (!extendRel) continue;

    const overrides = entity.rawCounts?.overriddenMethods ?? [];

    if (overrides.length === 0) {
      results.push({
        entityId: entity.id,
        location: locationMap.get(entity.id),
        overrideCount: 0,
        signatureMismatches: [],
        lspScore: 1,
      });
      continue;
    }

    const baseEntity = entityMap.get(extendRel.targetEntityId);
    const baseMethodMap = new Map(
      (baseEntity?.rawCounts?.overriddenMethods ?? []).map(m => [m.name, m]),
    );

    const mismatches: LspIndicator['signatureMismatches'] = [];

    for (const override of overrides) {
      const baseMethod = baseMethodMap.get(override.name);
      if (!baseMethod) continue; // Can't compare without base signature

      const paramsMatch = arraysEqual(override.paramTypes, baseMethod.paramTypes);
      const returnMatch = override.returnType === baseMethod.returnType;

      if (!paramsMatch || !returnMatch) {
        mismatches.push({
          methodName: override.name,
          baseParams: baseMethod.paramTypes,
          overrideParams: override.paramTypes,
          baseReturn: baseMethod.returnType,
          overrideReturn: override.returnType,
        });
      }
    }

    const penaltyPerMismatch = 0.2;
    const lspScore = clamp01(1 - mismatches.length * penaltyPerMismatch);

    results.push({
      entityId: entity.id,
      location: locationMap.get(entity.id),
      overrideCount: overrides.length,
      signatureMismatches: mismatches,
      lspScore,
    });
  }

  return results;
}

// ── Orchestrator ──

export function calculateSolidIndicators(
  entities: Entity[],
  relationships: Relationship[],
  moduleBoundaries: ModuleBoundary[],
  lcom4Results: Lcom4Result[],
): SolidResults {
  // Build location lookup once for all sub-calculators
  const locationMap = new Map<string, SourceLocation>();
  for (const e of entities) {
    if (e.filePath && e.sourceRange) {
      locationMap.set(e.id, {
        filePath: e.filePath,
        startLine: e.sourceRange.startLine,
        startColumn: e.sourceRange.startColumn,
        endLine: e.sourceRange.endLine,
        endColumn: e.sourceRange.endColumn,
      });
    }
  }

  return {
    srp: calculateSrp(entities, relationships, lcom4Results, locationMap),
    ocp: calculateOcp(entities, relationships, locationMap),
    isp: calculateIsp(entities, relationships, locationMap),
    dip: calculateDip(entities, relationships, moduleBoundaries, locationMap),
    lsp: calculateLsp(entities, relationships, locationMap),
  };
}
