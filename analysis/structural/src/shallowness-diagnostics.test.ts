import { describe, expect, it } from 'vitest';

import { computeShallownessDiagnostics } from './shallowness-diagnostics.js';
import type { FileInterfaceMetrics, FileClassificationEntry, WeightedEdge } from './types.js';

function makeMetric(overrides: Partial<FileInterfaceMetrics> = {}): FileInterfaceMetrics {
  return {
    fileId: 'provider',
    filePath: 'packages/service/src/provider/index.ts',
    linesOfCode: 100,
    exportedEntityCount: 12,
    exportedFunctionLikeCount: 8,
    exportedTypeLikeCount: 2,
    exportedClassCount: 1,
    exportedParameterCount: 20,
    exportedPublicPropertyCount: 2,
    incomingTypeRefs: 0,
    incomingValueRefs: 8,
    outgoingTypeRefs: 0,
    outgoingValueRefs: 1,
    consumerFileCount: 2,
    consumerClusterCount: 1,
    consumerCommunityGroupCount: 1,
    singleConsumerExportCount: 8,
    singleConsumerExportRatio: 0.8,
    interfaceSurfaceComplexityScore: 70,
    implementationComplexityScore: 180,
    hiddenComplexityRatio: 8,
    sharedResponsibilityLeakScore: 1.2,
    interfaceChangeCostScore: 160,
    interfaceChangeRiskBand: 'critical',
    ...overrides,
  };
}

function makeFile(fileId: string, filePath: string): FileClassificationEntry {
  return {
    fileId,
    filePath,
    category: 'code',
    fileClassification: { category: 'code', confidence: 1, reason: 'test' },
  };
}

function makeEdge(sourceFileId: string, targetFileId: string, weight = 1): WeightedEdge {
  return {
    sourceFileId,
    targetFileId,
    sourceEntityId: `${sourceFileId}:e`,
    targetEntityId: `${targetFileId}:e`,
    isTypeOnly: false,
    weight,
    weightReason: 'test',
  };
}

describe('computeShallownessDiagnostics', () => {
  it('prefers deepening dependent module for strong one-way flow', () => {
    const metrics = [makeMetric()];
    const files = [
      makeFile('provider', 'packages/service/src/provider/index.ts'),
      makeFile('depA1', 'packages/service/src/dependent-a/a.ts'),
      makeFile('depA2', 'packages/service/src/dependent-a/b.ts'),
    ];
    const edges: WeightedEdge[] = [
      makeEdge('depA1', 'provider', 3),
      makeEdge('depA2', 'provider', 2),
      makeEdge('provider', 'depA1', 0.2),
    ];

    const result = computeShallownessDiagnostics(
      metrics,
      undefined,
      undefined,
      undefined,
      edges,
      files
    );
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.directionality?.isBidirectional).toBe(true);
    expect(finding.remediation?.strategy).toBe('deepen-dependent-module');
    expect(finding.remediation?.targetModuleId).toBe('packages/service/src/dependent-a');
  });

  it('flags boundary directionality improvement when coupling is two-way', () => {
    const metrics = [makeMetric()];
    const files = [
      makeFile('provider', 'packages/service/src/provider/index.ts'),
      makeFile('depB1', 'packages/service/src/dependent-b/a.ts'),
      makeFile('depB2', 'packages/service/src/dependent-b/b.ts'),
    ];
    const edges: WeightedEdge[] = [
      makeEdge('depB1', 'provider', 4),
      makeEdge('depB2', 'provider', 3),
      makeEdge('provider', 'depB1', 2),
      makeEdge('provider', 'depB2', 2),
    ];

    const result = computeShallownessDiagnostics(
      metrics,
      undefined,
      undefined,
      undefined,
      edges,
      files
    );
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.directionality?.isBidirectional).toBe(true);
    expect(finding.remediation?.strategy).toBe('improve-boundary-directionality');
  });

  it('uses module-pair flow when flagged file has no direct incoming edges', () => {
    const metrics = [
      makeMetric({
        fileId: 'providerPublic',
        filePath: 'packages/service/src/provider/public-api.ts',
      }),
    ];

    const files = [
      makeFile('providerPublic', 'packages/service/src/provider/public-api.ts'),
      makeFile('providerInternal', 'packages/service/src/provider/internal.ts'),
      makeFile('depC1', 'packages/service/src/dependent-c/use-a.ts'),
      makeFile('depC2', 'packages/service/src/dependent-c/use-b.ts'),
    ];

    const edges: WeightedEdge[] = [
      // Dependent module heavily targets provider module, but not the flagged file directly.
      makeEdge('depC1', 'providerInternal', 4),
      makeEdge('depC2', 'providerInternal', 3),
      // Reverse flow is tiny.
      makeEdge('providerInternal', 'depC1', 0.2),
    ];

    const result = computeShallownessDiagnostics(
      metrics,
      undefined,
      undefined,
      undefined,
      edges,
      files
    );

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.directionality?.dependentModuleId).toBe('packages/service/src/dependent-c');
    expect(finding.remediation?.strategy).toBe('deepen-dependent-module');
  });

  it('raises belongs-together confidence when modules are frequently imported together', () => {
    const metrics = [
      makeMetric({
        fileId: 'providerPublic',
        filePath: 'packages/service/src/provider/public-api.ts',
        singleConsumerExportRatio: 0.4,
        consumerClusterCount: 4,
      }),
    ];

    const files = [
      makeFile('providerPublic', 'packages/service/src/provider/public-api.ts'),
      makeFile('providerInternal', 'packages/service/src/provider/internal.ts'),
      makeFile('depDInternal', 'packages/service/src/dependent-d/internal.ts'),
      makeFile('shared1', 'packages/service/src/shared/s1.ts'),
      makeFile('shared2', 'packages/service/src/shared/s2.ts'),
    ];

    const edges: WeightedEdge[] = [
      // dependent-d uses provider mostly one-way
      makeEdge('depDInternal', 'providerInternal', 6),
      makeEdge('providerInternal', 'depDInternal', 0.2),

      // shared modules import both provider and dependent => strong co-import affinity
      makeEdge('shared1', 'providerInternal', 1),
      makeEdge('shared1', 'depDInternal', 2),
      makeEdge('shared2', 'providerInternal', 1),
      makeEdge('shared2', 'depDInternal', 2),
    ];

    const result = computeShallownessDiagnostics(
      metrics,
      undefined,
      undefined,
      undefined,
      edges,
      files
    );

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.directionality?.coImportAffinity).toBeGreaterThanOrEqual(0.5);
    expect(finding.signals.coImportAffinity).toBeGreaterThanOrEqual(0.5);
    expect(finding.remediation?.strategy).toBe('deepen-dependent-module');
  });

  it('hints to stop further exporting when usage stays within one module part', () => {
    const metrics = [
      makeMetric({
        fileId: 'providerLocal',
        filePath: 'packages/service/src/provider/local-api.ts',
        consumerClusterCount: 1,
        consumerCommunityGroupCount: 1,
        sharedResponsibilityLeakScore: 0.2,
        singleConsumerExportRatio: 0.9,
      }),
    ];

    const files = [
      makeFile('providerLocal', 'packages/service/src/provider/local-api.ts'),
      makeFile('providerInternal', 'packages/service/src/provider/internal.ts'),
      makeFile('depLocal', 'packages/service/src/dependent-local/use.ts'),
    ];

    const edges: WeightedEdge[] = [
      makeEdge('depLocal', 'providerInternal', 3),
      makeEdge('providerInternal', 'depLocal', 0.1),
    ];

    const result = computeShallownessDiagnostics(
      metrics,
      undefined,
      undefined,
      undefined,
      edges,
      files
    );

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.exportSurfaceHint?.shouldStopFurtherExport).toBe(true);
    expect(finding.exportSurfaceHint?.localConsumerScope).toBe('single-module-part');
    expect(finding.exportSurfaceHint?.consumerModuleId).toBe(
      'packages/service/src/dependent-local'
    );
  });

  it('recommends extracting contract types for contract-heavy surfaces', () => {
    const metrics = [
      makeMetric({
        fileId: 'contractHeavy',
        filePath: 'packages/service/src/provider/contracts.ts',
        exportedEntityCount: 8,
        exportedTypeLikeCount: 6,
      }),
    ];

    const files = [makeFile('contractHeavy', 'packages/service/src/provider/contracts.ts')];

    const result = computeShallownessDiagnostics(
      metrics,
      undefined,
      undefined,
      undefined,
      [],
      files
    );

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.classificationAwareRecommendation?.strategy).toBe('extract-contract-types');
    expect(finding.classificationAwareRecommendation?.typeLikeExportRatio).toBeGreaterThanOrEqual(
      0.5
    );
  });

  it('recommends internalizing runtime exports for logic-heavy surfaces', () => {
    const metrics = [
      makeMetric({
        fileId: 'logicHeavy',
        filePath: 'packages/service/src/provider/runtime.ts',
        exportedEntityCount: 20,
        exportedTypeLikeCount: 1,
      }),
    ];

    const files = [
      {
        ...makeFile('logicHeavy', 'packages/service/src/provider/runtime.ts'),
        contentRole: 'logic' as const,
      },
    ];

    const result = computeShallownessDiagnostics(
      metrics,
      undefined,
      undefined,
      undefined,
      [],
      files
    );

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.classificationAwareRecommendation?.strategy).toBe(
      'internalize-runtime-exports'
    );
    expect(finding.classificationAwareRecommendation?.typeLikeExportRatio).toBeLessThanOrEqual(
      0.2
    );
  });

  it('respects custom contract threshold for classification-aware recommendation', () => {
    const metrics = [
      makeMetric({
        fileId: 'contractThreshold',
        filePath: 'packages/service/src/provider/contracts-threshold.ts',
        exportedEntityCount: 8,
        exportedTypeLikeCount: 6, // ratio 0.75
      }),
    ];

    const files = [makeFile('contractThreshold', 'packages/service/src/provider/contracts-threshold.ts')];

    const result = computeShallownessDiagnostics(
      metrics,
      undefined,
      undefined,
      undefined,
      [],
      files,
      { contractTypeLikeExportRatio: 0.8 }
    );

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.classificationAwareRecommendation?.strategy).toBe('split-runtime-and-types');
  });

  it('respects custom logic threshold for classification-aware recommendation', () => {
    const metrics = [
      makeMetric({
        fileId: 'logicThreshold',
        filePath: 'packages/service/src/provider/runtime-threshold.ts',
        exportedEntityCount: 20,
        exportedTypeLikeCount: 1, // ratio 0.05
      }),
    ];

    const files = [
      {
        ...makeFile('logicThreshold', 'packages/service/src/provider/runtime-threshold.ts'),
        contentRole: 'logic' as const,
      },
    ];

    const result = computeShallownessDiagnostics(
      metrics,
      undefined,
      undefined,
      undefined,
      [],
      files,
      { logicTypeLikeExportRatio: 0.01 }
    );

    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0];
    expect(finding.classificationAwareRecommendation?.strategy).toBe('split-runtime-and-types');
  });

  it('respects custom risk-band score thresholds for flagging', () => {
    const metrics = [
      makeMetric({
        fileId: 'borderline',
        filePath: 'packages/service/src/provider/borderline.ts',
        exportedEntityCount: 3,
        exportedTypeLikeCount: 0,
        interfaceSurfaceComplexityScore: 30,
        sharedResponsibilityLeakScore: 0.75,
        singleConsumerExportRatio: 0.35,
        hiddenComplexityRatio: 3,
      }),
    ];

    const files = [makeFile('borderline', 'packages/service/src/provider/borderline.ts')];

    const defaultResult = computeShallownessDiagnostics(
      metrics,
      undefined,
      undefined,
      undefined,
      [],
      files
    );
    expect(defaultResult.findings).toHaveLength(0);

    const tunedResult = computeShallownessDiagnostics(
      metrics,
      undefined,
      undefined,
      undefined,
      [],
      files,
      { mediumRiskMinScore: 40 }
    );
    expect(tunedResult.findings).toHaveLength(1);
    expect(tunedResult.findings[0].riskBand).toBe('medium');
  });
});
