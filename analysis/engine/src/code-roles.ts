/**
 * @aspect/engine — Code role classification
 *
 * Classifies each file entity by its structural role (utility, contract,
 * business_logic, presentation) based on coupling metrics, name-based
 * signals, and entity-kind heuristics.  Different roles have different
 * expected coupling signatures, so this feeds into downstream warnings
 * such as contract-imports-implementation violations and god-object risk.
 */

import type { Entity, Relationship } from '@aspect/contracts';

// ── Public types ────────────────────────────────────────────────────────

export type CodeRole =
  | 'utility'
  | 'contract'
  | 'business_logic'
  | 'presentation'
  | 'unknown';

export interface CodeRoleClassification {
  entityId: string;
  filePath: string;
  role: CodeRole;
  /** 0–1 — how confident we are in the classification. */
  confidence: number;
  /** Reasons for the classification. */
  signals: RoleSignal[];
}

export interface RoleSignal {
  signal: string;
  weight: number;
  description: string;
}

export interface CodeRoleResult {
  classifications: CodeRoleClassification[];
  summary: {
    utility: number;
    contract: number;
    business_logic: number;
    presentation: number;
    unknown: number;
  };
  /** Files classified as contracts that import implementations (bad coupling). */
  contractViolations: Array<{
    entityId: string;
    filePath: string;
    implementationImports: string[];
  }>;
  /** Business-logic files imported by too many different modules (god-object risk). */
  overloadedBusinessLogic: Array<{
    entityId: string;
    filePath: string;
    fanIn: number;
  }>;
}

export interface CodeRoleOptions {
  /** Fan-in threshold for utility classification (default: 5). */
  utilityFanInThreshold?: number;
  /** Fan-out ceiling — utilities should have low fan-out (default: 3). */
  utilityMaxFanOut?: number;
  /** Min ratio of type-only incoming rels for contract classification (default: 0.7). */
  contractTypeOnlyRatio?: number;
  /** Fan-in threshold for overloaded business-logic warning (default: 10). */
  overloadedFanInThreshold?: number;
}

// ── Defaults ────────────────────────────────────────────────────────────

const DEFAULT_UTILITY_FAN_IN = 5;
const DEFAULT_UTILITY_MAX_FAN_OUT = 3;
const DEFAULT_CONTRACT_TYPE_ONLY_RATIO = 0.7;
const DEFAULT_OVERLOADED_FAN_IN = 10;
const MIN_SCORE_THRESHOLD = 0.3;

// ── Name-based signal patterns ──────────────────────────────────────────

const UTILITY_PATH_PATTERNS = [/\butil(s|itie?s)?\b/i, /\bhelper(s)?\b/i, /\bcommon\b/i, /\bshared\b/i, /\blib\b/i];
const CONTRACT_PATH_PATTERNS = [/\btypes?\b/i, /\binterfaces?\b/i, /\bcontract(s)?\b/i, /\bdto(s)?\b/i, /\bschema(s)?\b/i];
const PRESENTATION_PATH_PATTERNS = [/\bcomponent(s)?\b/i, /\bview(s)?\b/i, /\bpage(s)?\b/i, /\bscreen(s)?\b/i, /\brender\b/i, /\bui\b/i, /\bwidget(s)?\b/i];

// ── Helpers ─────────────────────────────────────────────────────────────

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function isExternalOrBare(filePath: string): boolean {
  const norm = normalizePath(filePath);
  return norm.includes('node_modules') || !norm.includes('/');
}

function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(path));
}

// ── Metric computation ──────────────────────────────────────────────────

interface FileMetrics {
  fanIn: number;
  fanOut: number;
  typeOnlyInRatio: number;
  typeOnlyOutRatio: number;
  incomingTypeOnlyCount: number;
  incomingTotalCount: number;
}

function computeFileMetrics(
  entityId: string,
  fileEntityIds: Set<string>,
  entityToFile: Map<string, string>,
  outgoing: Relationship[],
  incoming: Relationship[],
): FileMetrics {
  // Fan-out: distinct target *files* this file imports
  const outFiles = new Set<string>();
  let outTypeOnly = 0;
  for (const r of outgoing) {
    const targetFileId = entityToFile.get(r.targetEntityId);
    if (targetFileId && targetFileId !== entityId && fileEntityIds.has(targetFileId)) {
      outFiles.add(targetFileId);
    }
    if (r.typeOnly) outTypeOnly++;
  }

  // Fan-in: distinct source *files* that import this file
  const inFiles = new Set<string>();
  let inTypeOnly = 0;
  for (const r of incoming) {
    const sourceFileId = entityToFile.get(r.sourceEntityId);
    if (sourceFileId && sourceFileId !== entityId && fileEntityIds.has(sourceFileId)) {
      inFiles.add(sourceFileId);
    }
    if (r.typeOnly) inTypeOnly++;
  }

  const inTotal = incoming.length;
  const outTotal = outgoing.length;

  return {
    fanIn: inFiles.size,
    fanOut: outFiles.size,
    typeOnlyInRatio: inTotal > 0 ? inTypeOnly / inTotal : 0,
    typeOnlyOutRatio: outTotal > 0 ? outTypeOnly / outTotal : 0,
    incomingTypeOnlyCount: inTypeOnly,
    incomingTotalCount: inTotal,
  };
}

// ── Scoring ─────────────────────────────────────────────────────────────

interface RoleScores {
  utility: { score: number; signals: RoleSignal[] };
  contract: { score: number; signals: RoleSignal[] };
  business_logic: { score: number; signals: RoleSignal[] };
  presentation: { score: number; signals: RoleSignal[] };
}

function scoreRoles(
  filePath: string,
  metrics: FileMetrics,
  childKinds: string[],
  opts: Required<Pick<CodeRoleOptions, 'utilityFanInThreshold' | 'utilityMaxFanOut' | 'contractTypeOnlyRatio'>>,
): RoleScores {
  const norm = normalizePath(filePath);
  const scores: RoleScores = {
    utility: { score: 0, signals: [] },
    contract: { score: 0, signals: [] },
    business_logic: { score: 0, signals: [] },
    presentation: { score: 0, signals: [] },
  };

  // ── Utility signals ──
  if (metrics.fanIn >= opts.utilityFanInThreshold && metrics.fanOut <= opts.utilityMaxFanOut) {
    const s: RoleSignal = { signal: 'high-fan-in-low-fan-out', weight: 0.5, description: `Fan-in ${metrics.fanIn} >= ${opts.utilityFanInThreshold} and fan-out ${metrics.fanOut} <= ${opts.utilityMaxFanOut}` };
    scores.utility.score += s.weight;
    scores.utility.signals.push(s);
  }
  if (matchesAny(norm, UTILITY_PATH_PATTERNS)) {
    const s: RoleSignal = { signal: 'utility-path-name', weight: 0.35, description: 'Path matches utility pattern (util/helper/common/shared/lib)' };
    scores.utility.score += s.weight;
    scores.utility.signals.push(s);
  }

  // ── Contract signals ──
  if (metrics.incomingTotalCount > 0 && metrics.typeOnlyInRatio >= opts.contractTypeOnlyRatio) {
    const s: RoleSignal = { signal: 'high-type-only-in-ratio', weight: 0.5, description: `Type-only incoming ratio ${metrics.typeOnlyInRatio.toFixed(2)} >= ${opts.contractTypeOnlyRatio}` };
    scores.contract.score += s.weight;
    scores.contract.signals.push(s);
  }
  if (matchesAny(norm, CONTRACT_PATH_PATTERNS)) {
    const s: RoleSignal = { signal: 'contract-path-name', weight: 0.35, description: 'Path matches contract pattern (type/interface/contract/dto/schema)' };
    scores.contract.score += s.weight;
    scores.contract.signals.push(s);
  }
  if (norm.endsWith('.d.ts')) {
    const s: RoleSignal = { signal: 'declaration-file', weight: 0.6, description: 'TypeScript declaration file (.d.ts)' };
    scores.contract.score += s.weight;
    scores.contract.signals.push(s);
  }
  // Child entity kinds: high ratio of interface/type-alias → contract
  if (childKinds.length > 0) {
    const typeKinds = childKinds.filter((k) => k === 'interface' || k === 'type-alias');
    const ratio = typeKinds.length / childKinds.length;
    if (ratio >= 0.7) {
      const s: RoleSignal = { signal: 'mostly-type-entities', weight: 0.4, description: `${typeKinds.length}/${childKinds.length} child entities are interfaces/type-aliases` };
      scores.contract.score += s.weight;
      scores.contract.signals.push(s);
    }
  }

  // ── Presentation signals ──
  if (matchesAny(norm, PRESENTATION_PATH_PATTERNS)) {
    const s: RoleSignal = { signal: 'presentation-path-name', weight: 0.5, description: 'Path matches presentation pattern (component/view/page/screen/render/ui/widget)' };
    scores.presentation.score += s.weight;
    scores.presentation.signals.push(s);
  }
  // .tsx or .jsx files are a weaker presentation signal
  if (norm.endsWith('.tsx') || norm.endsWith('.jsx')) {
    const s: RoleSignal = { signal: 'jsx-extension', weight: 0.2, description: 'JSX/TSX file extension (likely UI)' };
    scores.presentation.score += s.weight;
    scores.presentation.signals.push(s);
  }

  // ── Business logic signals ──
  // Moderate coupling is a weak positive signal
  if (metrics.fanIn >= 2 && metrics.fanOut >= 2) {
    const s: RoleSignal = { signal: 'moderate-coupling', weight: 0.25, description: `Moderate fan-in (${metrics.fanIn}) and fan-out (${metrics.fanOut})` };
    scores.business_logic.score += s.weight;
    scores.business_logic.signals.push(s);
  }
  // Child entities with class+methods → business logic
  if (childKinds.length > 0) {
    const hasClasses = childKinds.some((k) => k === 'class');
    const methodCount = childKinds.filter((k) => k === 'method').length;
    if (hasClasses && methodCount >= 3) {
      const s: RoleSignal = { signal: 'class-with-methods', weight: 0.35, description: `Contains class entities with ${methodCount} methods` };
      scores.business_logic.score += s.weight;
      scores.business_logic.signals.push(s);
    }
  }
  // Default baseline: business_logic gets a small base score so it wins when nothing else matches
  {
    const s: RoleSignal = { signal: 'default-baseline', weight: 0.15, description: 'Default baseline for business logic' };
    scores.business_logic.score += s.weight;
    scores.business_logic.signals.push(s);
  }

  return scores;
}

// ── Main entry point ────────────────────────────────────────────────────

/**
 * Classify each file entity by its structural role based on coupling
 * metrics, file-path heuristics, and child-entity kinds.
 */
export function classifyCodeRoles(
  entities: Entity[],
  relationships: Relationship[],
  options?: CodeRoleOptions,
): CodeRoleResult {
  const utilityFanInThreshold = options?.utilityFanInThreshold ?? DEFAULT_UTILITY_FAN_IN;
  const utilityMaxFanOut = options?.utilityMaxFanOut ?? DEFAULT_UTILITY_MAX_FAN_OUT;
  const contractTypeOnlyRatio = options?.contractTypeOnlyRatio ?? DEFAULT_CONTRACT_TYPE_ONLY_RATIO;
  const overloadedFanInThreshold = options?.overloadedFanInThreshold ?? DEFAULT_OVERLOADED_FAN_IN;

  // Build lookup structures
  const fileEntities = entities.filter(
    (e) => e.kind === 'file' && !isExternalOrBare(e.filePath),
  );
  const fileEntityIds = new Set(fileEntities.map((e) => e.id));

  // Map every entity to its file (entities with parentEntityId chain up to the file)
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const entityToFile = new Map<string, string>();
  for (const e of entities) {
    if (e.kind === 'file') {
      entityToFile.set(e.id, e.id);
    } else {
      // Walk up parentEntityId to find containing file
      let cur: Entity | undefined = e;
      while (cur && cur.kind !== 'file') {
        cur = cur.parentEntityId ? entityById.get(cur.parentEntityId) : undefined;
      }
      if (cur) {
        entityToFile.set(e.id, cur.id);
      }
    }
  }

  // Collect child entity kinds per file
  const childKindsPerFile = new Map<string, string[]>();
  for (const e of entities) {
    if (e.kind === 'file') continue;
    const fileId = entityToFile.get(e.id);
    if (fileId && fileEntityIds.has(fileId)) {
      let kinds = childKindsPerFile.get(fileId);
      if (!kinds) {
        kinds = [];
        childKindsPerFile.set(fileId, kinds);
      }
      kinds.push(e.kind);
    }
  }

  // Index relationships by source/target file
  const outgoingByFile = new Map<string, Relationship[]>();
  const incomingByFile = new Map<string, Relationship[]>();
  for (const r of relationships) {
    if (r.thirdParty) continue;
    const srcFile = entityToFile.get(r.sourceEntityId);
    const tgtFile = entityToFile.get(r.targetEntityId);
    if (srcFile && fileEntityIds.has(srcFile)) {
      let list = outgoingByFile.get(srcFile);
      if (!list) { list = []; outgoingByFile.set(srcFile, list); }
      list.push(r);
    }
    if (tgtFile && fileEntityIds.has(tgtFile)) {
      let list = incomingByFile.get(tgtFile);
      if (!list) { list = []; incomingByFile.set(tgtFile, list); }
      list.push(r);
    }
  }

  // Fan-in cache for post-classification checks
  const fanInCache = new Map<string, number>();

  // Classify each file
  const classifications: CodeRoleClassification[] = [];
  const roleByEntity = new Map<string, CodeRole>();

  for (const file of fileEntities) {
    const outgoing = outgoingByFile.get(file.id) ?? [];
    const incoming = incomingByFile.get(file.id) ?? [];
    const childKinds = childKindsPerFile.get(file.id) ?? [];

    const metrics = computeFileMetrics(file.id, fileEntityIds, entityToFile, outgoing, incoming);
    fanInCache.set(file.id, metrics.fanIn);

    const scores = scoreRoles(
      file.filePath,
      metrics,
      childKinds,
      { utilityFanInThreshold, utilityMaxFanOut, contractTypeOnlyRatio },
    );

    // Pick the highest-scoring role
    const roleEntries: Array<{ role: CodeRole; score: number; signals: RoleSignal[] }> = [
      { role: 'utility', score: scores.utility.score, signals: scores.utility.signals },
      { role: 'contract', score: scores.contract.score, signals: scores.contract.signals },
      { role: 'business_logic', score: scores.business_logic.score, signals: scores.business_logic.signals },
      { role: 'presentation', score: scores.presentation.score, signals: scores.presentation.signals },
    ];

    roleEntries.sort((a, b) => b.score - a.score);

    const best = roleEntries[0];
    const second = roleEntries[1];

    const role: CodeRole = best.score >= MIN_SCORE_THRESHOLD ? best.role : 'unknown';
    const confidence = Math.min(1, Math.max(0, best.score - second.score));

    roleByEntity.set(file.id, role);

    classifications.push({
      entityId: file.id,
      filePath: normalizePath(file.filePath),
      role,
      confidence,
      signals: role === 'unknown' ? [] : best.signals,
    });
  }

  // Summary counts
  const summary = { utility: 0, contract: 0, business_logic: 0, presentation: 0, unknown: 0 };
  for (const c of classifications) {
    summary[c.role]++;
  }

  // Contract violations: contracts that import business_logic or presentation
  const contractViolations: CodeRoleResult['contractViolations'] = [];
  for (const c of classifications) {
    if (c.role !== 'contract') continue;
    const outgoing = outgoingByFile.get(c.entityId) ?? [];
    const implImports: string[] = [];
    const seen = new Set<string>();
    for (const r of outgoing) {
      const tgtFile = entityToFile.get(r.targetEntityId);
      if (!tgtFile || tgtFile === c.entityId || seen.has(tgtFile)) continue;
      seen.add(tgtFile);
      const tgtRole = roleByEntity.get(tgtFile);
      if (tgtRole === 'business_logic' || tgtRole === 'presentation') {
        const tgtEntity = entityById.get(tgtFile);
        if (tgtEntity) implImports.push(normalizePath(tgtEntity.filePath));
      }
    }
    if (implImports.length > 0) {
      contractViolations.push({
        entityId: c.entityId,
        filePath: c.filePath,
        implementationImports: implImports,
      });
    }
  }

  // Overloaded business logic: business_logic files with fan-in >= threshold
  const overloadedBusinessLogic: CodeRoleResult['overloadedBusinessLogic'] = [];
  for (const c of classifications) {
    if (c.role !== 'business_logic') continue;
    const fanIn = fanInCache.get(c.entityId) ?? 0;
    if (fanIn >= overloadedFanInThreshold) {
      overloadedBusinessLogic.push({
        entityId: c.entityId,
        filePath: c.filePath,
        fanIn,
      });
    }
  }

  return { classifications, summary, contractViolations, overloadedBusinessLogic };
}
