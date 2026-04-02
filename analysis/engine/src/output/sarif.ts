/**
 * SARIF v2.1.0 exporter — Static Analysis Results Interchange Format.
 */

import type { Entity } from '@aspect/contracts';
import type { AnalysisResult } from '../orchestrator.js';
import type { CollectedData } from './types.js';
import { buildEntityMap } from './types.js';

// ── Options ─────────────────────────────────────────────────────────────

export interface SarifOptions {
  toolName?: string;
  toolVersion?: string;
  includeMetrics?: boolean;
}

// ── SARIF v2.1.0 types (subset) ────────────────────────────────────────

export interface SarifLog {
  $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json';
  version: '2.1.0';
  runs: SarifRun[];
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      rules: SarifRule[];
    };
  };
  results: SarifResult[];
}

export interface SarifRule {
  id: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: 'error' | 'warning' | 'note' };
}

export interface SarifResult {
  ruleId: string;
  message: { text: string };
  level: 'error' | 'warning' | 'note';
  locations: SarifLocation[];
}

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string };
    region: {
      startLine: number;
      startColumn: number;
      endLine: number;
      endColumn: number;
    };
  };
}

// ── Rule catalog ────────────────────────────────────────────────────────

const RULES: SarifRule[] = [
  {
    id: 'aspect/high-cyclomatic-complexity',
    shortDescription: { text: 'Cyclomatic complexity exceeds threshold' },
    defaultConfiguration: { level: 'warning' },
  },
  {
    id: 'aspect/dependency-cycle',
    shortDescription: { text: 'Dependency cycle detected' },
    defaultConfiguration: { level: 'error' },
  },
  {
    id: 'aspect/low-srp',
    shortDescription: { text: 'Low Single Responsibility Principle score' },
    defaultConfiguration: { level: 'warning' },
  },
  {
    id: 'aspect/low-dip',
    shortDescription: { text: 'Low Dependency Inversion Principle score' },
    defaultConfiguration: { level: 'warning' },
  },
  {
    id: 'aspect/high-duplication',
    shortDescription: { text: 'High code duplication' },
    defaultConfiguration: { level: 'warning' },
  },
  {
    id: 'aspect/zone-of-pain',
    shortDescription: { text: 'Module is in the zone of pain' },
    defaultConfiguration: { level: 'note' },
  },
  {
    id: 'aspect/high-coupling',
    shortDescription: { text: 'High coupling detected' },
    defaultConfiguration: { level: 'note' },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────

function locationFromEntity(entity: Entity): SarifLocation {
  return {
    physicalLocation: {
      artifactLocation: { uri: entity.filePath },
      region: {
        startLine: entity.sourceRange.startLine,
        startColumn: entity.sourceRange.startColumn + 1, // SARIF is 1-based
        endLine: entity.sourceRange.endLine,
        endColumn: entity.sourceRange.endColumn + 1,
      },
    },
  };
}

function fileLocation(filePath: string): SarifLocation {
  return {
    physicalLocation: {
      artifactLocation: { uri: filePath },
      region: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
    },
  };
}

// ── Exporter ────────────────────────────────────────────────────────────

export function toSarif(
  result: AnalysisResult,
  collectedData: CollectedData,
  options?: SarifOptions,
): SarifLog {
  const toolName = options?.toolName ?? '@aspect/engine';
  const toolVersion = options?.toolVersion ?? '0.1.0';
  const entityMap = buildEntityMap(collectedData.entities);
  const results: SarifResult[] = [];

  // High cyclomatic complexity (>10) → warning
  if (result.complexity) {
    for (const c of result.complexity.cyclomatic) {
      if (c.cyclomaticComplexity > 10) {
        const entity = entityMap.get(c.entityId);
        results.push({
          ruleId: 'aspect/high-cyclomatic-complexity',
          message: {
            text: `Cyclomatic complexity is ${c.cyclomaticComplexity} (threshold: 10)`,
          },
          level: 'warning',
          locations: entity ? [locationFromEntity(entity)] : [],
        });
      }
    }
  }

  // Dependency cycles → error
  if (result.graph) {
    for (const cycle of result.graph.cycles.cycles) {
      const firstEntity = entityMap.get(cycle.entityIds[0]);
      results.push({
        ruleId: 'aspect/dependency-cycle',
        message: {
          text: `Dependency cycle of size ${cycle.size} involving: ${cycle.entityIds.join(' → ')}`,
        },
        level: 'error',
        locations: firstEntity ? [locationFromEntity(firstEntity)] : [],
      });
    }
  }

  // Low SRP score (<0.5) → warning
  if (result.solid) {
    for (const srp of result.solid.srp) {
      if (srp.srpScore < 0.5) {
        const entity = entityMap.get(srp.entityId);
        results.push({
          ruleId: 'aspect/low-srp',
          message: {
            text: `SRP score is ${srp.srpScore.toFixed(2)} (threshold: 0.5)`,
          },
          level: 'warning',
          locations: entity ? [locationFromEntity(entity)] : [],
        });
      }
    }
  }

  // Low DIP score (<0.5) → warning
  if (result.solid) {
    for (const dip of result.solid.dip) {
      if (dip.dipScore < 0.5) {
        const entity = entityMap.get(dip.entityId);
        results.push({
          ruleId: 'aspect/low-dip',
          message: {
            text: `DIP score is ${dip.dipScore.toFixed(2)} (threshold: 0.5)`,
          },
          level: 'warning',
          locations: entity ? [locationFromEntity(entity)] : [],
        });
      }
    }
  }

  // High duplication (>20%) → warning
  if (result.duplication) {
    for (const file of result.duplication.files) {
      if (file.duplicationPercentage > 20) {
        results.push({
          ruleId: 'aspect/high-duplication',
          message: {
            text: `Duplication is ${file.duplicationPercentage.toFixed(1)}% (threshold: 20%)`,
          },
          level: 'warning',
          locations: [fileLocation(file.filePath)],
        });
      }
    }
  }

  // Zone of pain modules → note
  for (const moduleId of result.summary.modulesInZoneOfPain) {
    const boundary = collectedData.moduleBoundaries.find(
      (m) => m.moduleId === moduleId,
    );
    results.push({
      ruleId: 'aspect/zone-of-pain',
      message: {
        text: `Module "${moduleId}" is in the zone of pain (high concreteness, high stability)`,
      },
      level: 'note',
      locations: boundary ? [fileLocation(boundary.modulePath)] : [],
    });
  }

  // High coupling (>10 total) → note
  if (result.coupling) {
    for (const c of result.coupling.entities) {
      if (c.totalCoupling > 10) {
        const entity = entityMap.get(c.entityId);
        results.push({
          ruleId: 'aspect/high-coupling',
          message: { text: `Total coupling is ${c.totalCoupling} (threshold: 10)` },
          level: 'note',
          locations: entity ? [locationFromEntity(entity)] : [],
        });
      }
    }
  }

  // Only include rules that were actually triggered
  const usedRuleIds = new Set(results.map((r) => r.ruleId));
  const activeRules = RULES.filter((r) => usedRuleIds.has(r.id));

  return {
    $schema:
      'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-2.1/schema/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: { name: toolName, version: toolVersion, rules: activeRules },
        },
        results,
      },
    ],
  };
}
