/**
 * SonarQube Generic Issue Import Format exporter.
 */

import type { Entity } from '@aspect/contracts';
import type { AnalysisResult } from '../orchestrator.js';
import type { CollectedData } from './types.js';
import { buildEntityMap } from './types.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface SonarQubeIssue {
  engineId: string;
  ruleId: string;
  severity: 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MINOR' | 'INFO';
  type: 'BUG' | 'VULNERABILITY' | 'CODE_SMELL';
  primaryLocation: {
    message: string;
    filePath: string;
    textRange: {
      startLine: number;
      endLine: number;
      startColumn: number;
      endColumn: number;
    };
  };
}

export interface SonarQubeReport {
  issues: SonarQubeIssue[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

function textRangeFromEntity(entity: Entity): SonarQubeIssue['primaryLocation']['textRange'] {
  return {
    startLine: entity.sourceRange.startLine,
    endLine: entity.sourceRange.endLine,
    startColumn: entity.sourceRange.startColumn,
    endColumn: entity.sourceRange.endColumn,
  };
}

// ── Exporter ────────────────────────────────────────────────────────────

export function toSonarQube(
  result: AnalysisResult,
  collectedData: CollectedData,
): SonarQubeReport {
  const entityMap = buildEntityMap(collectedData.entities);
  const issues: SonarQubeIssue[] = [];

  // High cyclomatic complexity (>10) → CODE_SMELL, MAJOR
  if (result.complexity) {
    for (const c of result.complexity.cyclomatic) {
      if (c.cyclomaticComplexity > 10) {
        const entity = entityMap.get(c.entityId);
        if (!entity) continue;
        issues.push({
          engineId: 'aspect',
          ruleId: 'high-cyclomatic-complexity',
          severity: 'MAJOR',
          type: 'CODE_SMELL',
          primaryLocation: {
            message: `Cyclomatic complexity is ${c.cyclomaticComplexity} (threshold: 10)`,
            filePath: entity.filePath,
            textRange: textRangeFromEntity(entity),
          },
        });
      }
    }
  }

  // Dependency cycles → BUG, CRITICAL
  if (result.graph) {
    for (const cycle of result.graph.cycles.cycles) {
      const firstEntity = entityMap.get(cycle.entityIds[0]);
      if (!firstEntity) continue;
      issues.push({
        engineId: 'aspect',
        ruleId: 'dependency-cycle',
        severity: 'CRITICAL',
        type: 'BUG',
        primaryLocation: {
          message: `Dependency cycle of size ${cycle.size} involving: ${cycle.entityIds.join(' → ')}`,
          filePath: firstEntity.filePath,
          textRange: textRangeFromEntity(firstEntity),
        },
      });
    }
  }

  // Low SRP score (<0.5) → CODE_SMELL, MAJOR
  if (result.solid) {
    for (const srp of result.solid.srp) {
      if (srp.srpScore < 0.5) {
        const entity = entityMap.get(srp.entityId);
        if (!entity) continue;
        issues.push({
          engineId: 'aspect',
          ruleId: 'low-srp',
          severity: 'MAJOR',
          type: 'CODE_SMELL',
          primaryLocation: {
            message: `SRP score is ${srp.srpScore.toFixed(2)} (threshold: 0.5)`,
            filePath: entity.filePath,
            textRange: textRangeFromEntity(entity),
          },
        });
      }
    }
  }

  // Low DIP score (<0.5) → CODE_SMELL, MINOR
  if (result.solid) {
    for (const dip of result.solid.dip) {
      if (dip.dipScore < 0.5) {
        const entity = entityMap.get(dip.entityId);
        if (!entity) continue;
        issues.push({
          engineId: 'aspect',
          ruleId: 'low-dip',
          severity: 'MINOR',
          type: 'CODE_SMELL',
          primaryLocation: {
            message: `DIP score is ${dip.dipScore.toFixed(2)} (threshold: 0.5)`,
            filePath: entity.filePath,
            textRange: textRangeFromEntity(entity),
          },
        });
      }
    }
  }

  // High duplication (>20%) → CODE_SMELL, MAJOR
  if (result.duplication) {
    for (const file of result.duplication.files) {
      if (file.duplicationPercentage > 20) {
        issues.push({
          engineId: 'aspect',
          ruleId: 'high-duplication',
          severity: 'MAJOR',
          type: 'CODE_SMELL',
          primaryLocation: {
            message: `Duplication is ${file.duplicationPercentage.toFixed(1)}% (threshold: 20%)`,
            filePath: file.filePath,
            textRange: { startLine: 1, endLine: 1, startColumn: 0, endColumn: 1 },
          },
        });
      }
    }
  }

  return { issues };
}
