/**
 * @aspect/engine — Step 8: Optimization
 *
 * Takes the output of steps 5–7 and produces:
 *
 *   - Cluster quality assessment (concern mixing, package span,
 *     folder separation)
 *   - File split candidates (files that bridge clusters)
 *   - Structural warnings (actionable advice)
 *
 * Also provides `analyseStructuralAlignment()` — a convenience
 * wrapper that runs steps 6, 7, and 8 together.
 */

import type { CodeContentRole } from './2-code-classification.js';
import type {
  StructuralFileInfo, Community,
  ClusterQuality, FileSplitCandidate,
  FolderFocus, PackageAlignment,
  StructuralAlignmentResult, StructuralWarning,
  WarningThresholds,
} from './types.js';
import { DEFAULT_THRESHOLDS, round3, parentDir, buildFileCommunityIndex } from './types.js';
import { analysePackageAlignment } from './6-package-comparison.js';
import { analyseFolderFocus } from './7-folder-comparison.js';

// ── Concern conflict definitions ────────────────────────────────────────

const CONCERN_CONFLICTS: Array<[string, string, string]> = [
  ['infrastructure', 'logic', 'infrastructure+logic'],
  ['infrastructure', 'presentation', 'infrastructure+presentation'],
  ['presentation', 'logic', 'presentation+logic'],
  ['contract', 'logic', 'contract+logic'],
  ['contract', 'presentation', 'contract+presentation'],
  ['entry_point', 'contract', 'entry_point+contract'],
];

const ROLE_SIGNIFICANCE_THRESHOLD = 0.2;

// ── Cluster quality ─────────────────────────────────────────────────────

/**
 * For each cluster, assess quality: concern mixing, package span,
 * and folder separation.
 */
export function analyseClusterQuality(
  files: StructuralFileInfo[],
  communities: Community[],
): ClusterQuality[] {
  const fileMap = new Map(files.map((f) => [f.fileId, f]));
  const results: ClusterQuality[] = [];

  for (const community of communities) {
    const members = community.memberFileIds
      .map((id) => fileMap.get(id))
      .filter((f): f is StructuralFileInfo => f != null);

    // ── Role mix ────────────────────────────────────────────────────
    const roleMix: Record<string, number> = {};
    for (const f of members) {
      const role = f.contentRole ?? 'unknown';
      roleMix[role] = (roleMix[role] ?? 0) + 1;
    }

    let dominantRole: CodeContentRole | 'unknown' = 'unknown';
    let dominantCount = 0;
    for (const [role, count] of Object.entries(roleMix)) {
      if (count > dominantCount) {
        dominantCount = count;
        dominantRole = role as CodeContentRole | 'unknown';
      }
    }
    const dominantRoleRatio = members.length > 0
      ? round3(dominantCount / members.length)
      : 0;

    // Concern conflicts
    let hasMixedConcerns = false;
    let concernConflict: string | undefined;

    const significantRoles = Object.entries(roleMix)
      .filter(([, count]) => count / members.length >= ROLE_SIGNIFICANCE_THRESHOLD)
      .map(([role]) => role);

    for (const [roleA, roleB, conflict] of CONCERN_CONFLICTS) {
      if (significantRoles.includes(roleA) && significantRoles.includes(roleB)) {
        hasMixedConcerns = true;
        concernConflict = conflict;
        break;
      }
    }

    // ── Package span ────────────────────────────────────────────────
    const packages = new Set<string>();
    for (const f of members) {
      if (f.packageId) packages.add(f.packageId);
    }

    // ── Folder analysis ─────────────────────────────────────────────
    const folders = new Set<string>();
    for (const f of members) {
      folders.add(parentDir(f.filePath));
    }

    // Folder separation: does this community share folders with others?
    let folderSeparated: boolean | undefined;
    if (packages.size > 0) {
      const otherCommunitiesInSamePackages = communities.filter((other) => {
        if (other.id === community.id) return false;
        const otherMembers = other.memberFileIds.map((id) => fileMap.get(id)).filter(Boolean);
        return otherMembers.some((m) => m!.packageId && packages.has(m!.packageId));
      });

      if (otherCommunitiesInSamePackages.length > 0) {
        const otherFolders = new Set<string>();
        for (const other of otherCommunitiesInSamePackages) {
          for (const fId of other.memberFileIds) {
            const f = fileMap.get(fId);
            if (f && f.packageId && packages.has(f.packageId)) {
              otherFolders.add(parentDir(f.filePath));
            }
          }
        }

        let overlap = 0;
        for (const folder of folders) {
          if (otherFolders.has(folder)) overlap++;
        }
        folderSeparated = overlap === 0;
      }
    }

    results.push({
      clusterId: community.id,
      fileCount: members.length,
      roleMix,
      dominantRole,
      dominantRoleRatio,
      hasMixedConcerns,
      concernConflict,
      packageCount: packages.size,
      packages: [...packages].sort(),
      spansPackages: packages.size > 1,
      folderCount: folders.size,
      folders: [...folders].sort(),
      folderSeparated,
    });
  }

  return results;
}

// ── File split candidates ───────────────────────────────────────────────

/**
 * Find files that bridge multiple clusters — candidates for splitting.
 */
export function findSplitCandidates(
  files: StructuralFileInfo[],
  communities: Community[],
): FileSplitCandidate[] {
  const fileToCommunity = buildFileCommunityIndex(communities);
  const candidates: FileSplitCandidate[] = [];

  for (const f of files) {
    const cIds = fileToCommunity.get(f.fileId);
    if (!cIds || cIds.length < 2) continue;

    const edgesPerCluster: Record<string, number> = {};
    for (const cId of cIds) {
      const community = communities.find((c) => c.id === cId);
      edgesPerCluster[cId] = community ? community.memberFileIds.length : 1;
    }

    const splitConfidence = round3(Math.min(1.0, (cIds.length - 1) * 0.4));

    candidates.push({
      fileId: f.fileId,
      filePath: f.filePath,
      clusterIds: cIds,
      edgesPerCluster,
      splitConfidence,
      contentRole: f.contentRole,
    });
  }

  candidates.sort((a, b) => b.splitConfidence - a.splitConfidence);
  return candidates;
}

// ── Warning generation ──────────────────────────────────────────────────

/**
 * Generate structural warnings based on thresholds.
 */
export function generateWarnings(
  files: StructuralFileInfo[],
  communities: Community[],
  folderFocus: FolderFocus[],
  packageAlignment: PackageAlignment[],
  clusterQuality: ClusterQuality[],
  thresholds: WarningThresholds = DEFAULT_THRESHOLDS,
): StructuralWarning[] {
  const warnings: StructuralWarning[] = [];

  // File size warnings
  for (const f of files) {
    if (f.category !== 'code' || !f.linesOfCode) continue;
    if (f.linesOfCode > thresholds.maxFileLoc * 2) {
      warnings.push({
        kind: 'file-too-large', severity: 'critical',
        target: f.filePath,
        message: `${f.linesOfCode} LOC — more than double the ${thresholds.maxFileLoc} limit, should be split`,
        value: f.linesOfCode, threshold: thresholds.maxFileLoc,
      });
    } else if (f.linesOfCode > thresholds.maxFileLoc) {
      warnings.push({
        kind: 'file-too-large', severity: 'warning',
        target: f.filePath,
        message: `${f.linesOfCode} LOC — exceeds ${thresholds.maxFileLoc} limit`,
        value: f.linesOfCode, threshold: thresholds.maxFileLoc,
      });
    }
  }

  // Community size warnings
  for (const c of communities) {
    if (c.memberFileIds.length > thresholds.maxClusterSize * 2) {
      warnings.push({
        kind: 'cluster-too-large', severity: 'critical',
        target: c.id,
        message: `Community has ${c.memberFileIds.length} files — more than double the ${thresholds.maxClusterSize} limit, indicates a tightly coupled monolith`,
        value: c.memberFileIds.length, threshold: thresholds.maxClusterSize,
      });
    } else if (c.memberFileIds.length > thresholds.maxClusterSize) {
      warnings.push({
        kind: 'cluster-too-large', severity: 'warning',
        target: c.id,
        message: `Community has ${c.memberFileIds.length} files — exceeds ${thresholds.maxClusterSize} limit`,
        value: c.memberFileIds.length, threshold: thresholds.maxClusterSize,
      });
    }
  }

  // Cluster quality warnings
  for (const cq of clusterQuality) {
    if (cq.hasMixedConcerns && cq.concernConflict) {
      warnings.push({
        kind: 'cluster-mixed-concerns',
        severity: cq.fileCount > 10 ? 'critical' : 'warning',
        target: cq.clusterId,
        message: `Cluster mixes ${cq.concernConflict} (${cq.fileCount} files) — these concerns should be separated`,
        value: cq.dominantRoleRatio, threshold: 0.7,
      });
    }
    if (cq.spansPackages) {
      warnings.push({
        kind: 'cluster-spans-packages',
        severity: cq.packageCount > 2 ? 'critical' : 'warning',
        target: cq.clusterId,
        message: `Cluster spans ${cq.packageCount} packages (${cq.packages.join(', ')}) — tightly coupled files in separate packages`,
        value: cq.packageCount, threshold: 1,
      });
    }
    if (cq.folderSeparated === false) {
      warnings.push({
        kind: 'package-needs-subfolders', severity: 'warning',
        target: cq.clusterId,
        message: `Cluster shares folders with other clusters — needs subfolder separation within the package`,
        value: 0, threshold: 1,
      });
    }
  }

  // Folder focus warnings
  for (const f of folderFocus) {
    if (f.assessment === 'trivial' || f.assessment === 'unclustered') continue;
    if (f.focusScore < thresholds.minFolderFocus) {
      warnings.push({
        kind: 'folder-unfocused',
        severity: f.assessment === 'mixed' ? 'critical' : 'warning',
        target: f.folderPath,
        message: `Focus score ${f.focusScore} — ${f.clusterCount} clusters, ${f.roleCount} roles in one folder`,
        value: f.focusScore, threshold: thresholds.minFolderFocus,
      });
    }
  }

  // Package alignment warnings
  for (const p of packageAlignment) {
    if (p.clusterIds.length === 0) continue;
    if (p.alignmentScore < thresholds.minPackageAlignment) {
      warnings.push({
        kind: 'package-misaligned',
        severity: p.alignmentScore < thresholds.minPackageAlignment * 0.5 ? 'critical' : 'warning',
        target: p.packageId,
        message: `Alignment score ${p.alignmentScore} — clusters spill across package boundaries`,
        value: p.alignmentScore, threshold: thresholds.minPackageAlignment,
      });
    }
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 };
  warnings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  return warnings;
}

// ── Convenience wrapper ─────────────────────────────────────────────────

/**
 * Run all structural alignment analyses in one call (steps 6 + 7 + 8).
 */
export function analyseStructuralAlignment(
  files: StructuralFileInfo[],
  communities: Community[],
  thresholds: Partial<WarningThresholds> = {},
): StructuralAlignmentResult {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const folderFocus = analyseFolderFocus(files, communities);
  const splitCandidates = findSplitCandidates(files, communities);
  const packageAlignment = analysePackageAlignment(files, communities);
  const clusterQuality = analyseClusterQuality(files, communities);
  const warnings = generateWarnings(files, communities, folderFocus, packageAlignment, clusterQuality, t);
  return { folderFocus, splitCandidates, packageAlignment, clusterQuality, warnings };
}
