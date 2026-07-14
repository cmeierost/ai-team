import { describe, expect, it } from 'vitest';

import { buildLlmPriorityReader } from './priority-reader.js';
import type { StructuralPipelineResult } from './types.js';

function makeResult(overrides: Partial<StructuralPipelineResult> = {}): StructuralPipelineResult {
  return {
    entityGraph: {
      fileClassifications: [],
      weightedEdges: [],
      fileInfoMap: {},
    },
    fileClassifications: [],
    weightedEdges: [],
    alignment: {
      folderFocus: [],
      splitCandidates: [],
      packageAlignment: [],
      clusterQuality: [],
      warnings: [],
    },
    summary: {
      totalFiles: 0,
      codeFiles: 0,
      categoryCounts: {},
      roleCounts: {},
      clusterCount: 0,
      avgClusterSize: 0,
      maxClusterSize: 0,
      warningCount: 0,
      criticalWarningCount: 0,
      focusedFolderCount: 0,
      unfocusedFolderCount: 0,
      splitCandidateCount: 0,
      oversizedFileCount: 0,
    },
    ...overrides,
  } as StructuralPipelineResult;
}

describe('buildLlmPriorityReader', () => {
  it('picks the highest-impact recommendation as current issue', () => {
    const result = makeResult({
      recommendations: [
        {
          id: 'r1',
          priority: 'critical',
          category: 'folder-cleanup',
          title: 'Untangle folder',
          description: 'Split tangled directory by communities.',
          fileIds: [],
          filePaths: ['packages/service/src/workflow'],
          impact: 0.9,
        },
        {
          id: 'r2',
          priority: 'medium',
          category: 'file-move',
          title: 'Move file',
          description: 'Move helper file.',
          fileIds: ['f2'],
          filePaths: ['packages/service/src/utils/helper.ts'],
          impact: 0.2,
        },
      ],
    });

    const reader = buildLlmPriorityReader(result);
    expect(reader.issueCount).toBeGreaterThan(0);
    expect(reader.current?.id).toBe('r1');
    expect(reader.current?.source).toBe('recommendation');
  });

  it('falls back to warnings and shallowness when recommendations are absent', () => {
    const result = makeResult({
      alignment: {
        folderFocus: [],
        splitCandidates: [],
        packageAlignment: [],
        clusterQuality: [],
        warnings: [
          {
            kind: 'tangled-directory',
            severity: 'critical',
            target: 'packages/service/src/commands',
            message: 'Too many communities in commands/',
            value: 8,
            threshold: 3,
          },
        ],
      },
      shallownessDiagnostics: {
        findings: [
          {
            fileId: 'f1',
            filePath: 'packages/service/src/tasks/task-manager.ts',
            score: 66,
            riskBand: 'high',
            signals: {
              interfaceSurfaceComplexityScore: 0,
              sharedResponsibilityLeakScore: 0,
              singleConsumerExportRatio: 0,
              hiddenComplexityRatio: 0,
              exportCount: 0,
              exportsPer100Loc: 0,
              coImportAffinity: 0,
            },
            classificationAwareRecommendation: {
              strategy: 'internalize-runtime-exports',
              rationale: 'test',
              contentRole: 'logic',
              typeLikeExportRatio: 0.1,
            },
          },
        ],
        summary: {
          totalFiles: 1,
          flaggedFiles: 1,
          criticalCount: 0,
          highCount: 1,
          mediumCount: 0,
          moveSuggestedCount: 0,
        },
      },
    });

    const reader = buildLlmPriorityReader(result);
    expect(reader.issueCount).toBeGreaterThan(0);
    expect(reader.current).toBeDefined();
    expect(['warning', 'shallowness']).toContain(reader.current?.source);
  });

  it('respects maxItems limit', () => {
    const result = makeResult({
      recommendations: [
        {
          id: 'r1',
          priority: 'high',
          category: 'file-move',
          title: 'Move A',
          description: 'A',
          fileIds: ['a'],
          filePaths: ['a.ts'],
          impact: 0.9,
        },
        {
          id: 'r2',
          priority: 'high',
          category: 'file-move',
          title: 'Move B',
          description: 'B',
          fileIds: ['b'],
          filePaths: ['b.ts'],
          impact: 0.8,
        },
        {
          id: 'r3',
          priority: 'medium',
          category: 'file-move',
          title: 'Move C',
          description: 'C',
          fileIds: ['c'],
          filePaths: ['c.ts'],
          impact: 0.7,
        },
      ],
    });

    const reader = buildLlmPriorityReader(result, { maxItems: 2 });
    expect(reader.issueCount).toBe(2);
    expect(reader.current).toBeDefined();
    expect(reader.next).toHaveLength(1);
  });
});
