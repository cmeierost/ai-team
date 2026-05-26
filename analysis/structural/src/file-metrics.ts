import type { Entity } from '@aspect/contracts';

import type {
  WeightedEdge,
  FileClassificationEntry,
  ExportAnalysis,
  CommunityDetectionResult,
  FileInterfaceMetrics,
  InterfaceChangeRiskBand,
} from './types.js';

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

function flattenCommunityGroups(
  roots: NonNullable<CommunityDetectionResult['communityGroups']>,
): NonNullable<CommunityDetectionResult['communityGroups']> {
  const all: NonNullable<CommunityDetectionResult['communityGroups']> = [];
  const walk = (node: NonNullable<CommunityDetectionResult['communityGroups']>[number]) => {
    all.push(node);
    for (const child of node.children ?? []) {
      if (child.kind === 'communityGroup') walk(child.cluster);
    }
  };
  for (const root of roots) walk(root);
  return all;
}

export function computeFileInterfaceMetrics(
  entities: Entity[],
  fileClassifications: FileClassificationEntry[],
  weightedEdges: WeightedEdge[],
  exportAnalysis?: ExportAnalysis,
  communities?: CommunityDetectionResult,
): FileInterfaceMetrics[] {
  const fileIdByPath = new Map(fileClassifications.map((f) => [f.filePath.replace(/\\/g, '/'), f.fileId]));
  const filePathById = new Map(fileClassifications.map((f) => [f.fileId, f.filePath]));
  const fileLocById = new Map(fileClassifications.map((f) => [f.fileId, f.linesOfCode ?? 0]));

  const fileChildEntities = new Map<string, Entity[]>();
  for (const entity of entities) {
    if (entity.kind === 'file') continue;
    const fileId = fileIdByPath.get(entity.filePath.replace(/\\/g, '/'));
    if (!fileId) continue;
    const list = fileChildEntities.get(fileId) ?? [];
    list.push(entity);
    fileChildEntities.set(fileId, list);
  }

  const incomingByFile = new Map<string, WeightedEdge[]>();
  const outgoingByFile = new Map<string, WeightedEdge[]>();
  for (const edge of weightedEdges) {
    const inList = incomingByFile.get(edge.targetFileId) ?? [];
    inList.push(edge);
    incomingByFile.set(edge.targetFileId, inList);

    const outList = outgoingByFile.get(edge.sourceFileId) ?? [];
    outList.push(edge);
    outgoingByFile.set(edge.sourceFileId, outList);
  }

  const exportByFile = new Map((exportAnalysis?.files ?? []).map((f) => [f.fileId, f]));

  const fileToCommunity = new Map<string, string>();
  for (const community of communities?.communities ?? []) {
    for (const fileId of community.memberFileIds) fileToCommunity.set(fileId, community.id);
  }

  const communityToSuper = new Map<string, string>();
  for (const sc of flattenCommunityGroups(communities?.communityGroups ?? [])) {
    const stack = [sc];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const child of cur.children ?? []) {
        if (child.kind === 'community') communityToSuper.set(child.communityId, sc.id);
        else stack.push(child.cluster);
      }
    }
  }

  const metrics: FileInterfaceMetrics[] = fileClassifications.map((file) => {
    const children = fileChildEntities.get(file.fileId) ?? [];
    const exported = children.filter((e) => e.classification?.isExported);

    const exportedFunctionLikeCount = exported.filter((e) => e.kind === 'function' || e.kind === 'method').length;
    const exportedTypeLikeCount = exported.filter((e) => e.kind === 'interface' || e.kind === 'type-alias').length;
    const exportedClassCount = exported.filter((e) => e.kind === 'class').length;
    const exportedEntityCount = exported.length;
    const exportedParameterCount = exported.reduce(
      (sum, e) => sum + (e.rawCounts?.parameterCount ?? 0),
      0,
    );
    const exportedPublicPropertyCount = exported.reduce(
      (sum, e) => sum + (e.rawCounts?.publicPropertyCount ?? 0),
      0,
    );

    const internalBranchPoints = children
      .filter((e) => !e.classification?.isExported)
      .reduce((sum, e) => sum + (e.rawCounts?.branchPoints ?? 0), 0);

    const incoming = incomingByFile.get(file.fileId) ?? [];
    const outgoing = outgoingByFile.get(file.fileId) ?? [];
    const incomingTypeRefs = incoming.filter((e) => e.isTypeOnly).length;
    const incomingValueRefs = incoming.length - incomingTypeRefs;
    const outgoingTypeRefs = outgoing.filter((e) => e.isTypeOnly).length;
    const outgoingValueRefs = outgoing.length - outgoingTypeRefs;

    const consumerFiles = new Set(incoming.map((e) => e.sourceFileId));
    const consumerFileCount = consumerFiles.size;
    const ownCommunity = fileToCommunity.get(file.fileId);
    const ownSuper = ownCommunity ? communityToSuper.get(ownCommunity) : undefined;

    const consumerClusters = new Set<string>();
    const consumerSupers = new Set<string>();
    let crossBoundaryConsumers = 0;
    for (const consumer of consumerFiles) {
      const c = fileToCommunity.get(consumer);
      if (c) consumerClusters.add(c);
      const s = c ? communityToSuper.get(c) : undefined;
      if (s) consumerSupers.add(s);
      if ((ownCommunity && c && c !== ownCommunity) || (ownSuper && s && s !== ownSuper)) {
        crossBoundaryConsumers++;
      }
    }

    const exportInfo = exportByFile.get(file.fileId);
    const singleConsumerExportCount = (exportInfo?.exports ?? []).filter((exp) => exp.fileRefs === 1).length;
    const singleConsumerExportRatio = (exportInfo?.totalExports ?? 0) > 0
      ? singleConsumerExportCount / Math.max(1, exportInfo!.totalExports)
      : 0;

    const interfaceSurfaceComplexityScore =
      exportedParameterCount
      + exportedPublicPropertyCount * 1.5
      + exportedFunctionLikeCount * 1.2
      + exportedTypeLikeCount
      + exportedClassCount * 1.3;

    const implementationComplexityScore =
      (fileLocById.get(file.fileId) ?? 0)
      + outgoingValueRefs * 2
      + incomingValueRefs
      + internalBranchPoints * 0.5;

    const hiddenComplexityRatio =
      implementationComplexityScore / Math.max(1, interfaceSurfaceComplexityScore);

    const crossBoundaryConsumerRatio = consumerFileCount > 0
      ? crossBoundaryConsumers / consumerFileCount
      : 0;

    const sharedResponsibilityLeakScore =
      crossBoundaryConsumerRatio
      * (1 + Math.log2(1 + consumerClusters.size))
      * (1 + 0.5 * Math.log2(1 + consumerSupers.size));

    const breadthFactor =
      1
      + Math.log2(1 + consumerFileCount)
      + 0.5 * Math.log2(1 + consumerClusters.size);

    const sharedFactor = 1 + crossBoundaryConsumerRatio + 0.5 * Math.log2(1 + consumerSupers.size);
    const interfaceChangeCostScore = interfaceSurfaceComplexityScore * breadthFactor * sharedFactor;

    return {
      fileId: file.fileId,
      filePath: filePathById.get(file.fileId) ?? file.filePath,
      linesOfCode: fileLocById.get(file.fileId) ?? 0,
      exportedEntityCount,
      exportedFunctionLikeCount,
      exportedTypeLikeCount,
      exportedClassCount,
      exportedParameterCount,
      exportedPublicPropertyCount,
      incomingTypeRefs,
      incomingValueRefs,
      outgoingTypeRefs,
      outgoingValueRefs,
      consumerFileCount,
      consumerClusterCount: consumerClusters.size,
      consumerCommunityGroupCount: consumerSupers.size,
      singleConsumerExportCount,
      singleConsumerExportRatio,
      interfaceSurfaceComplexityScore,
      implementationComplexityScore,
      hiddenComplexityRatio,
      sharedResponsibilityLeakScore,
      interfaceChangeCostScore,
      interfaceChangeRiskBand: 'low',
    };
  });

  const sortedScores = metrics.map((m) => m.interfaceChangeCostScore).sort((a, b) => a - b);
  const p50 = percentile(sortedScores, 0.5);
  const p75 = percentile(sortedScores, 0.75);
  const p90 = percentile(sortedScores, 0.9);

  const bandFor = (score: number): InterfaceChangeRiskBand => {
    if (score <= p50) return 'low';
    if (score <= p75) return 'medium';
    if (score <= p90) return 'high';
    return 'critical';
  };

  for (const metric of metrics) {
    metric.interfaceChangeRiskBand = bandFor(metric.interfaceChangeCostScore);
  }

  return metrics;
}
