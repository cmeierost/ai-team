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

// ── Main entry point ──

export function calculateComplexity(entities: Entity[]): ComplexityResults {
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

  return { cyclomatic, cognitive, halstead, fileSummaries };
}
