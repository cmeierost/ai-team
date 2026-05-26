/**
 * @aspect/engine — Step 6: Package comparison
 *
 * Measures how well package boundaries align with communities and
 * community groups. Produces both:
 * - Per-package alignment scores (package→community direction)
 * - Per-community-group best-match (group→package direction)
 */

import type {
  StructuralFileInfo, Community, CommunityGroup, CommunityGroupChild,
  PackageAlignment, SpilledCluster,
  CommunityGroupPackageMatch, PackageComparisonResult,
} from './types.js';
import { round3, buildFileCommunityIndex } from './types.js';

/**
 * For each package, measure how well its boundaries match natural communities.
 */
export function analysePackageAlignment(
  files: StructuralFileInfo[],
  communities: Community[],
): PackageAlignment[] {
  const packageFiles = new Map<string, StructuralFileInfo[]>();
  for (const f of files) {
    if (!f.packageId) continue;
    let list = packageFiles.get(f.packageId);
    if (!list) { list = []; packageFiles.set(f.packageId, list); }
    list.push(f);
  }

  const fileToCommunity = buildFileCommunityIndex(communities);
  const results: PackageAlignment[] = [];

  for (const [packageId, pkgFiles] of packageFiles) {
    const pkgFileIds = new Set(pkgFiles.map((f) => f.fileId));

    const touchedCommunityIds = new Set<string>();
    let unclustered = 0;
    for (const f of pkgFiles) {
      const cIds = fileToCommunity.get(f.fileId);
      if (cIds && cIds.length > 0) {
        for (const cId of cIds) touchedCommunityIds.add(cId);
      } else {
        unclustered++;
      }
    }

    const spilled: SpilledCluster[] = [];
    let totalContainment = 0;
    for (const cId of touchedCommunityIds) {
      const community = communities.find((c) => c.id === cId)!;
      const inside = community.memberFileIds.filter((id) => pkgFileIds.has(id)).length;
      const outside = community.memberFileIds.length - inside;
      const containment = round3(inside / community.memberFileIds.length);
      totalContainment += containment;
      if (outside > 0) {
        spilled.push({ clusterId: cId, insideCount: inside, outsideCount: outside, containment });
      }
    }

    const clusterIds = [...touchedCommunityIds];
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

/** Collect all file IDs from a community group (recursively). */
function collectGroupFileIds(
  group: CommunityGroup,
  communities: Community[],
): string[] {
  const fileIds: string[] = [];
  const walk = (node: CommunityGroup) => {
    for (const child of node.children) {
      if (child.kind === 'community') {
        const comm = communities.find((c) => c.id === child.communityId);
        if (comm) fileIds.push(...comm.memberFileIds);
      } else {
        walk(child.cluster);
      }
    }
  };
  walk(group);
  return fileIds;
}

/**
 * For each community group, find the best-matching package by file overlap
 * and compute covered/missing/extra file lists.
 */
export function matchCommunityGroupsToPackages(
  communityGroups: CommunityGroup[],
  communities: Community[],
  files: StructuralFileInfo[],
): CommunityGroupPackageMatch[] {
  // Build file→package index
  const fileToPackage = new Map<string, string>();
  for (const f of files) {
    if (f.packageId) fileToPackage.set(f.fileId, f.packageId);
  }

  // Build package→fileSet index
  const packageFileIds = new Map<string, Set<string>>();
  for (const f of files) {
    if (!f.packageId) continue;
    let s = packageFileIds.get(f.packageId);
    if (!s) { s = new Set(); packageFileIds.set(f.packageId, s); }
    s.add(f.fileId);
  }

  const results: CommunityGroupPackageMatch[] = [];

  for (const group of communityGroups) {
    const groupFileIds = collectGroupFileIds(group, communities);
    if (groupFileIds.length === 0) continue;

    // Count files per package
    const pkgCounts = new Map<string, number>();
    for (const fid of groupFileIds) {
      const pkg = fileToPackage.get(fid);
      if (pkg) pkgCounts.set(pkg, (pkgCounts.get(pkg) ?? 0) + 1);
    }

    // Find the best-matching package
    let bestPkg = '';
    let bestCount = 0;
    for (const [pkg, count] of pkgCounts) {
      if (count > bestCount) { bestPkg = pkg; bestCount = count; }
    }

    if (!bestPkg) continue;

    const bestPkgFileSet = packageFileIds.get(bestPkg) ?? new Set();
    const groupFileSet = new Set(groupFileIds);

    const coveredFiles = groupFileIds.filter((fid) => bestPkgFileSet.has(fid));
    const missingFiles = groupFileIds.filter((fid) => !bestPkgFileSet.has(fid));
    const extraFiles = [...bestPkgFileSet].filter((fid) => !groupFileSet.has(fid));
    const coverageRatio = round3(coveredFiles.length / groupFileIds.length);

    results.push({
      communityGroupId: group.id,
      bestPackageId: bestPkg,
      coveredFiles,
      missingFiles,
      extraFiles,
      coverageRatio,
    });
  }

  return results;
}

/**
 * Full step 6: package comparison from both directions.
 */
export function comparePackages(
  files: StructuralFileInfo[],
  communities: Community[],
  communityGroups: CommunityGroup[],
): PackageComparisonResult {
  return {
    packageAlignment: analysePackageAlignment(files, communities),
    communityGroupMatches: matchCommunityGroupsToPackages(communityGroups, communities, files),
  };
}
