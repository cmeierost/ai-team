/**
 * @aspect/engine — Step 6: Package comparison
 *
 * Measures how well package boundaries align with natural clusters.
 *
 * A well-aligned package contains complete clusters — no cluster spills
 * across package boundaries. Misalignment means the package boundary
 * is arbitrary and doesn't reflect actual code relationships.
 */

import type {
  StructuralFileInfo, FileCluster,
  PackageAlignment, SpilledCluster,
} from './types.js';
import { round3, buildFileClusterIndex } from './types.js';

/**
 * For each package, measure how well its boundaries match natural clusters.
 */
export function analysePackageAlignment(
  files: StructuralFileInfo[],
  clusters: FileCluster[],
): PackageAlignment[] {
  const packageFiles = new Map<string, StructuralFileInfo[]>();
  for (const f of files) {
    if (!f.packageId) continue;
    let list = packageFiles.get(f.packageId);
    if (!list) { list = []; packageFiles.set(f.packageId, list); }
    list.push(f);
  }

  const fileToCluster = buildFileClusterIndex(clusters);
  const results: PackageAlignment[] = [];

  for (const [packageId, pkgFiles] of packageFiles) {
    const pkgFileIds = new Set(pkgFiles.map((f) => f.fileId));

    const touchedClusterIds = new Set<string>();
    let unclustered = 0;
    for (const f of pkgFiles) {
      const cIds = fileToCluster.get(f.fileId);
      if (cIds && cIds.length > 0) {
        for (const cId of cIds) touchedClusterIds.add(cId);
      } else {
        unclustered++;
      }
    }

    const spilled: SpilledCluster[] = [];
    let totalContainment = 0;
    for (const cId of touchedClusterIds) {
      const cluster = clusters.find((c) => c.id === cId)!;
      const inside = cluster.fileIds.filter((id) => pkgFileIds.has(id)).length;
      const outside = cluster.fileIds.length - inside;
      const containment = round3(inside / cluster.fileIds.length);
      totalContainment += containment;
      if (outside > 0) {
        spilled.push({ clusterId: cId, insideCount: inside, outsideCount: outside, containment });
      }
    }

    const clusterIds = [...touchedClusterIds];
    const alignmentScore = clusterIds.length > 0
      ? round3(totalContainment / clusterIds.length)
      : 1.0;

    results.push({
      packageId, fileCount: pkgFiles.length,
      clusterIds, unclusteredCount: unclustered,
      alignmentScore, spilledClusters: spilled,
    });
  }

  results.sort((a, b) => a.alignmentScore - b.alignmentScore);
  return results;
}
