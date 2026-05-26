// @aspect/complexity — Complexity calculator
// Derives cyclomatic, cognitive, and Halstead complexity from raw counts.

// ── Source location (self-contained — no external deps) ──

export interface SourceLocation {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

// ── Entity shape expected by this calculator ──

export interface Entity {
  id: string;
  kind: string;
  name: string;
  filePath: string;
  sourceRange?: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null;
  rawCounts?: {
    branchPoints?: number | null;
    nestingContributions?: Array<{ depth: number; increment: number }> | null;
    operators?: { distinct: number; total: number } | null;
    operands?: { distinct: number; total: number } | null;
    linesOfCode?: number;
  } | null;
}

// ── Result types ──

export interface CyclomaticResult {
  entityId: string;
  location?: SourceLocation;
  cyclomaticComplexity: number;
}

export interface CognitiveResult {
  entityId: string;
  location?: SourceLocation;
  cognitiveComplexity: number;
}

export interface HalsteadMetrics {
  vocabulary: number;
  length: number;
  volume: number;
  difficulty: number;
  effort: number;
  time: number;
  estimatedBugs: number;
}

export interface HalsteadResult {
  entityId: string;
  location?: SourceLocation;
  halstead: HalsteadMetrics;
}

export interface FileComplexitySummary {
  filePath: string;
  maxCyclomatic: number;
  avgCyclomatic: number;
  totalCyclomatic: number;
  maxCognitive: number;
  avgCognitive: number;
  totalCognitive: number;
  functionCount: number;
}

export interface ComplexityResults {
  cyclomatic: CyclomaticResult[];
  cognitive: CognitiveResult[];
  halstead: HalsteadResult[];
  fileSummaries: FileComplexitySummary[];
}

// ── Maintainability Index types ──

export type MIRiskBand = 'green' | 'yellow' | 'red';

export interface MaintainabilityResult {
  entityId: string;
  maintainabilityIndex: number;
  riskBand: MIRiskBand;
  halsteadVolume: number;
  cyclomaticComplexity: number;
  linesOfCode: number;
}

export interface FileMaintainabilitySummary {
  filePath: string;
  minMI: number;
  avgMI: number;
  riskBand: MIRiskBand;
  entityCount: number;
  redCount: number;
  yellowCount: number;
  greenCount: number;
}

export interface MaintainabilityResults {
  entities: MaintainabilityResult[];
  fileSummaries: FileMaintainabilitySummary[];
}

// ── Kinds treated as "function-like" for file summaries ──

const FUNCTION_KINDS = new Set([
  'function',
  'method',
  'arrow-function',
  'constructor',
  'getter',
  'setter',
]);

// ── Core calculators ──

export function calculateCyclomatic(branchPoints: number): number {
  return branchPoints + 1;
}

export function calculateCognitive(
  nestingContributions: Array<{ depth: number; increment: number }>,
): number {
  return nestingContributions.reduce(
    (sum, nc) => sum + nc.increment + nc.depth,
    0,
  );
}

export function calculateHalstead(
  operators: { distinct: number; total: number },
  operands: { distinct: number; total: number },
): HalsteadMetrics {
  const eta1 = operators.distinct;
  const eta2 = operands.distinct;
  const n1 = operators.total;
  const n2 = operands.total;

  const vocabulary = eta1 + eta2;
  const length = n1 + n2;

  const volume = vocabulary > 0 ? length * Math.log2(vocabulary) : 0;
  const difficulty = eta2 > 0 ? (eta1 / 2) * (n2 / eta2) : 0;
  const effort = difficulty * volume;
  const time = effort / 18;
  const estimatedBugs = volume / 3000;

  return { vocabulary, length, volume, difficulty, effort, time, estimatedBugs };
}

// ── File-level aggregation ──

export function summarizeFileComplexity(
  entities: Entity[],
  cyclomaticResults: CyclomaticResult[],
  cognitiveResults: CognitiveResult[],
): FileComplexitySummary[] {
  const cyclomaticMap = new Map<string, number>();
  for (const r of cyclomaticResults) {
    cyclomaticMap.set(r.entityId, r.cyclomaticComplexity);
  }

  const cognitiveMap = new Map<string, number>();
  for (const r of cognitiveResults) {
    cognitiveMap.set(r.entityId, r.cognitiveComplexity);
  }

  const fileEntities = new Map<string, Entity[]>();
  for (const e of entities) {
    if (!FUNCTION_KINDS.has(e.kind)) continue;
    const list = fileEntities.get(e.filePath) ?? [];
    list.push(e);
    fileEntities.set(e.filePath, list);
  }

  const allFiles = new Set<string>();
  for (const e of entities) allFiles.add(e.filePath);

  const summaries: FileComplexitySummary[] = [];
  for (const filePath of allFiles) {
    const fnEntities = fileEntities.get(filePath) ?? [];
    const count = fnEntities.length;

    if (count === 0) {
      summaries.push({
        filePath,
        maxCyclomatic: 0,
        avgCyclomatic: 0,
        totalCyclomatic: 0,
        maxCognitive: 0,
        avgCognitive: 0,
        totalCognitive: 0,
        functionCount: 0,
      });
      continue;
    }

    const cyclomatics = fnEntities.map(
      (e) => cyclomaticMap.get(e.id) ?? 0,
    );
    const cognitives = fnEntities.map(
      (e) => cognitiveMap.get(e.id) ?? 0,
    );

    const totalCyclomatic = cyclomatics.reduce((a, b) => a + b, 0);
    const totalCognitive = cognitives.reduce((a, b) => a + b, 0);

    summaries.push({
      filePath,
      maxCyclomatic: Math.max(...cyclomatics),
      avgCyclomatic: totalCyclomatic / count,
      totalCyclomatic,
      maxCognitive: Math.max(...cognitives),
      avgCognitive: totalCognitive / count,
      totalCognitive,
      functionCount: count,
    });
  }

  return summaries;
}

// ── Maintainability Index ──
// VS-style formula: MI = MAX(0, (171 - 5.2·ln(HV) - 0.23·CC - 16.2·ln(LOC)) × 100/171)
// Thresholds: 0-9 = red, 10-19 = yellow, 20-100 = green

export function calculateMaintainabilityIndex(
  halsteadVolume: number,
  cyclomaticComplexity: number,
  linesOfCode: number,
): number {
  const hv = Math.max(halsteadVolume, 1);
  const loc = Math.max(linesOfCode, 1);
  const raw = 171 - 5.2 * Math.log(hv) - 0.23 * cyclomaticComplexity - 16.2 * Math.log(loc);
  return Math.max(0, (raw * 100) / 171);
}

export function miRiskBand(mi: number): MIRiskBand {
  if (mi < 10) return 'red';
  if (mi < 20) return 'yellow';
  return 'green';
}

export function calculateMaintainability(
  entities: Entity[],
  cyclomaticResults: CyclomaticResult[],
  halsteadResults: HalsteadResult[],
): MaintainabilityResults {
  const ccMap = new Map<string, number>();
  for (const r of cyclomaticResults) ccMap.set(r.entityId, r.cyclomaticComplexity);

  const hvMap = new Map<string, number>();
  for (const r of halsteadResults) hvMap.set(r.entityId, r.halstead.volume);

  const miResults: MaintainabilityResult[] = [];

  for (const e of entities) {
    if (!FUNCTION_KINDS.has(e.kind)) continue;
    const hv = hvMap.get(e.id);
    const cc = ccMap.get(e.id);
    const loc = e.rawCounts?.linesOfCode;
    if (hv == null || cc == null || loc == null) continue;

    const mi = calculateMaintainabilityIndex(hv, cc, loc);
    miResults.push({
      entityId: e.id,
      maintainabilityIndex: Math.round(mi * 100) / 100,
      riskBand: miRiskBand(mi),
      halsteadVolume: Math.round(hv * 100) / 100,
      cyclomaticComplexity: cc,
      linesOfCode: loc,
    });
  }

  // File-level aggregation
  const byFile = new Map<string, MaintainabilityResult[]>();
  const entityFileMap = new Map<string, string>();
  for (const e of entities) entityFileMap.set(e.id, e.filePath);
  for (const r of miResults) {
    const fp = entityFileMap.get(r.entityId) ?? '';
    const list = byFile.get(fp) ?? [];
    list.push(r);
    byFile.set(fp, list);
  }

  const fileSummaries: FileMaintainabilitySummary[] = [];
  for (const [filePath, results] of byFile) {
    const mis = results.map((r) => r.maintainabilityIndex);
    const minMI = Math.min(...mis);
    const avgMI = mis.reduce((a, b) => a + b, 0) / mis.length;
    fileSummaries.push({
      filePath,
      minMI: Math.round(minMI * 100) / 100,
      avgMI: Math.round(avgMI * 100) / 100,
      riskBand: miRiskBand(minMI),
      entityCount: results.length,
      redCount: results.filter((r) => r.riskBand === 'red').length,
      yellowCount: results.filter((r) => r.riskBand === 'yellow').length,
      greenCount: results.filter((r) => r.riskBand === 'green').length,
    });
  }

  return { entities: miResults, fileSummaries };
}

// ── Main entry point ──

export function calculateComplexity(entities: Entity[]): ComplexityResults & { maintainability: MaintainabilityResults } {
  const cyclomatic: CyclomaticResult[] = [];
  const cognitive: CognitiveResult[] = [];
  const halstead: HalsteadResult[] = [];

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

  for (const entity of entities) {
    const raw = entity.rawCounts;
    if (!raw) continue;

    const location = locationMap.get(entity.id);

    if (raw.branchPoints != null) {
      cyclomatic.push({
        entityId: entity.id,
        location,
        cyclomaticComplexity: calculateCyclomatic(raw.branchPoints),
      });
    }

    if (raw.nestingContributions != null) {
      cognitive.push({
        entityId: entity.id,
        location,
        cognitiveComplexity: calculateCognitive(raw.nestingContributions),
      });
    }

    if (raw.operators != null && raw.operands != null) {
      halstead.push({
        entityId: entity.id,
        location,
        halstead: calculateHalstead(raw.operators, raw.operands),
      });
    }
  }

  const fileSummaries = summarizeFileComplexity(entities, cyclomatic, cognitive);
  const maintainability = calculateMaintainability(entities, cyclomatic, halstead);

  return { cyclomatic, cognitive, halstead, fileSummaries, maintainability };
}
