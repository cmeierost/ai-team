/**
 * @aspect/engine — Step 10: Context comparison
 *
 * Compares agent file contexts (resolved from `.perm` files) against
 * the community structure. For each context, measures:
 *
 *   - Coverage: which communities does this context fully/partially cover?
 *   - Leakage: files in the context that don't belong to any community
 *   - Gaps: community files NOT in the context
 *
 * This powers the comparison: "does this agent's file context match
 * the architectural community it should own?"
 */

import type { Community, CommunityGroup, CommunityGroupChild } from './types.js';

/** Per-community coverage within a single context. */
export interface ContextCommunityCoverage {
  communityId: string;
  /** Files in both the context and the community. */
  coveredFiles: string[];
  /** Community files NOT in the context. */
  gapFiles: string[];
  /** coveredFiles / communityMemberFiles. */
  coverageRatio: number;
}

/** Per-community-group coverage within a single context. */
export interface ContextGroupCoverage {
  communityGroupId: string;
  /** Files in both the context and the group (recursive). */
  coveredFiles: string[];
  /** Group files NOT in the context. */
  gapFiles: string[];
  /** coveredFiles / totalGroupFiles. */
  coverageRatio: number;
}

/** Result of comparing one file context against the community structure. */
export interface ContextComparisonEntry {
  /** Identifier for the context (e.g., .perm file path or agent name). */
  contextId: string;
  /** All files in this context. */
  contextFiles: string[];
  /** Per-community coverage breakdown. */
  communityCoverage: ContextCommunityCoverage[];
  /** Per-community-group coverage breakdown. */
  groupCoverage: ContextGroupCoverage[];
  /** Files in the context that don't belong to any community. */
  leakageFiles: string[];
  /** leakageFiles / contextFiles. */
  leakageRatio: number;
  /** The community group with highest coverage — the context's "best match". */
  bestMatchGroupId?: string;
  bestMatchCoverageRatio?: number;
}

/** Full result from step 10. */
export interface ContextComparisonResult {
  entries: ContextComparisonEntry[];
}

/** Input: a resolved file context (just the file list). */
export interface FileContextInput {
  contextId: string;
  files: string[];
}

/** Collect all file IDs from a community group recursively. */
function collectGroupFiles(
  group: CommunityGroup,
  communities: Community[],
): string[] {
  const communityById = new Map(communities.map((c) => [c.id, c]));
  const fileIds: string[] = [];
  const walk = (node: CommunityGroup) => {
    for (const child of node.children) {
      if (child.kind === 'community') {
        const comm = communityById.get(child.communityId);
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
 * Compare multiple file contexts against the community structure.
 */
export function compareContexts(
  contexts: FileContextInput[],
  communities: Community[],
  communityGroups: CommunityGroup[],
): ContextComparisonResult {
  // Build file→community index
  const allCommunityFiles = new Set<string>();
  for (const c of communities) {
    for (const fid of c.memberFileIds) allCommunityFiles.add(fid);
  }

  const entries: ContextComparisonEntry[] = [];

  for (const ctx of contexts) {
    const contextFileSet = new Set(ctx.files);

    // Per-community coverage
    const communityCoverage: ContextCommunityCoverage[] = [];
    for (const c of communities) {
      const coveredFiles = c.memberFileIds.filter((fid) => contextFileSet.has(fid));
      const gapFiles = c.memberFileIds.filter((fid) => !contextFileSet.has(fid));
      if (coveredFiles.length === 0) continue;
      communityCoverage.push({
        communityId: c.id,
        coveredFiles,
        gapFiles,
        coverageRatio: Math.round((coveredFiles.length / c.memberFileIds.length) * 1000) / 1000,
      });
    }

    // Per-community-group coverage
    const groupCoverage: ContextGroupCoverage[] = [];
    for (const group of communityGroups) {
      const groupFiles = collectGroupFiles(group, communities);
      const coveredFiles = groupFiles.filter((fid) => contextFileSet.has(fid));
      const gapFiles = groupFiles.filter((fid) => !contextFileSet.has(fid));
      if (coveredFiles.length === 0) continue;
      groupCoverage.push({
        communityGroupId: group.id,
        coveredFiles,
        gapFiles,
        coverageRatio: Math.round((coveredFiles.length / groupFiles.length) * 1000) / 1000,
      });
    }

    // Leakage: context files not in any community
    const leakageFiles = ctx.files.filter((fid) => !allCommunityFiles.has(fid));
    const leakageRatio = ctx.files.length > 0
      ? Math.round((leakageFiles.length / ctx.files.length) * 1000) / 1000
      : 0;

    // Best match group
    let bestMatchGroupId: string | undefined;
    let bestMatchCoverageRatio: number | undefined;
    for (const gc of groupCoverage) {
      if (bestMatchCoverageRatio == null || gc.coverageRatio > bestMatchCoverageRatio) {
        bestMatchGroupId = gc.communityGroupId;
        bestMatchCoverageRatio = gc.coverageRatio;
      }
    }

    entries.push({
      contextId: ctx.contextId,
      contextFiles: ctx.files,
      communityCoverage,
      groupCoverage,
      leakageFiles,
      leakageRatio,
      bestMatchGroupId,
      bestMatchCoverageRatio,
    });
  }

  return { entries };
}
