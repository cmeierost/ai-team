/**
 * @aspect/engine — Community detection (Louvain)
 *
 * Detects dense subgraphs in the dependency graph using the Louvain
 * algorithm. Unlike the union-find clustering in step 5 (which only
 * groups mutually-coupled pairs), Louvain catches asymmetric dense
 * communities — groups of files that reference each other far more
 * than they reference outsiders.
 *
 * Also detects:
 *   - Misplaced files (community ≠ directory)
 *   - Tangled directories (too many communities in one folder)
 */

import Graph from 'graphology';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const UndirectedGraph = (Graph as any).UndirectedGraph as typeof Graph;
import louvain from 'graphology-communities-louvain';

import type {
  WeightedEdge, FileClassificationEntry,
  Community, SuperCluster, SuperClusterChild, CommunityDetectionResult, MisplacedFile, TangledDirectory, ClusterExposure,
} from './types.js';
import type { CodeContentRole } from './2-code-classification.js';
import { parentDir } from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────

/** Extract the top-level package prefix (e.g. 'packages/web' or 'analysis/structural'). */
function packagePrefix(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').replace(/^file:/, '').split('/');
  // Typical shape: packages/web/src/... or analysis/structural/src/...
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0] ?? '';
}

// ── Constants ───────────────────────────────────────────────────────────

const TANGLED_THRESHOLD = 3;

/**
 * Target max cluster size in LOC. Clusters larger than this get recursively
 * split so each cluster fits comfortably in a single LLM context window.
 * ~8 000 LOC ≈ ~25 000 tokens — leaves room for prompts and output.
 */
const MAX_CLUSTER_LOC = 8_000;
const MAX_CLUSTER_FILES = 30;
const MIN_CLUSTER_LOC = 3_000;
const MAX_SUPERCLUSTER_SHARED_LOC = 5_000;
const MAX_SUPERCLUSTER_CHILDREN = 5;

/**
 * Higher resolution → more, smaller communities. Default Louvain is 1.0.
 */
const LOUVAIN_RESOLUTION = 1.0;

/** Communities below this size get merged into their best neighbor when meaningful. */
const MIN_CLUSTER_FILES = 4;
const ROLE_FOCUS_RATIO = 0.7;

// ── Community detection ─────────────────────────────────────────────────

export function detectCommunities(
  weightedEdges: WeightedEdge[],
  fileClassifications: FileClassificationEntry[],
): CommunityDetectionResult {
  const codeFiles = fileClassifications.filter((f) => f.category === 'code');
  if (codeFiles.length < 2) {
    return { communities: [], superClusters: [], modularity: 0, misplacedFiles: [], tangledDirectories: [] };
  }

  // Build undirected graph (Louvain requirement)
  const graph = new UndirectedGraph();
  const pathMap = new Map<string, string>();

  for (const f of codeFiles) {
    graph.addNode(f.fileId);
    pathMap.set(f.fileId, f.filePath);
  }

  for (const edge of weightedEdges) {
    if (!graph.hasNode(edge.sourceFileId) || !graph.hasNode(edge.targetFileId)) continue;
    if (edge.sourceFileId === edge.targetFileId) continue;
    if (graph.hasEdge(edge.sourceFileId, edge.targetFileId)) {
      const w = (graph.getEdgeAttribute(edge.sourceFileId, edge.targetFileId, 'weight') as number) ?? 0;
      graph.setEdgeAttribute(edge.sourceFileId, edge.targetFileId, 'weight', w + edge.weight);
    } else {
      graph.addEdge(edge.sourceFileId, edge.targetFileId, { weight: edge.weight });
    }
  }

  if (graph.size === 0) {
    return { communities: [], superClusters: [], modularity: 0, misplacedFiles: [], tangledDirectories: [] };
  }

  // Run Louvain with higher resolution for smaller, context-window-sized clusters
  const detailed = louvain.detailed(graph, {
    getEdgeWeight: 'weight',
    resolution: LOUVAIN_RESOLUTION,
  });

  // Group by community
  const communityMap = new Map<number, string[]>();
  for (const [node, cid] of Object.entries(detailed.communities)) {
    const list = communityMap.get(cid) ?? [];
    list.push(node);
    communityMap.set(cid, list);
  }

  // Build LOC lookup for size-based splitting
  const locMap = new Map<string, number>();
  for (const f of codeFiles) locMap.set(f.fileId, f.linesOfCode ?? 0);
  const roleMap = new Map<string, CodeContentRole | undefined>();
  for (const f of codeFiles) roleMap.set(f.fileId, f.contentRole);

  // Split oversized communities so each fits in a context window
  let communities: Community[] = [...communityMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, members], i) => ({
      id: `community-${i}`,
      memberFileIds: members.sort(),
    }));

  // Absorb singleton files into the nearest community by directory
  communities = absorbSingletons(communities, pathMap);

  // Merge tiny fragments by directory continuity first.
  communities = mergeSmallCommunities(communities, graph, pathMap);

  // Split oversized communities (after absorb+merge, since they may push clusters over the cap)
  communities = splitOversizedCommunities(communities, locMap, graph);

  // Enforce concern focus: split mixed-role communities.
  communities = splitMixedConcernCommunities(communities, roleMap);

  // Merge undersized communities only when they are genuinely related.
  communities = mergeUndersizedCommunities(communities, graph, pathMap, locMap, roleMap);

  // Extract shared contract/type files into their own clusters.
  communities = extractSharedTypes(communities, weightedEdges, roleMap);

  communities = annotateCommunities(communities, pathMap, locMap, roleMap);

  // Build hierarchical superclusters from shared contracts + package affinity.
  const superClusters = buildSuperClusters(communities, weightedEdges, roleMap, pathMap, locMap);

  const clusterExposure = computeCommunityExposure(communities, weightedEdges, locMap);
  const superClusterExposure = computeSuperClusterExposure(superClusters, communities, weightedEdges, locMap);
  applyExposureToCommunities(communities, clusterExposure);
  applyExposureToSuperClusters(superClusters, superClusterExposure);

  // Detect misplaced files: file's community majority dir ≠ file's actual dir
  const misplacedFiles = findMisplacedFiles(communities, pathMap);
  const tangledDirectories = findTangledDirectories(communities, pathMap);

  return {
    communities,
    superClusters,
    clusterExposure,
    superClusterExposure,
    modularity: detailed.modularity,
    misplacedFiles,
    tangledDirectories,
  };
}

// ── Singleton absorption ────────────────────────────────────────────────

/**
 * Absorb single-file communities into the nearest multi-file community
 * by directory proximity, or group isolated singletons by directory into
 * new small communities. Keeps cluster count manageable without inflating
 * existing clusters beyond the file cap.
 */
function absorbSingletons(
  communities: Community[],
  pathMap: Map<string, string>,
): Community[] {
  const multi = communities.filter((c) => c.memberFileIds.length > 1);
  const singles = communities.filter((c) => c.memberFileIds.length === 1);

  if (singles.length === 0) return communities;

  // Build community → majority directory (only for multi-member communities)
  const communityDirs = new Map<string, Set<string>>();
  for (const c of multi) {
    const dirs = new Set(c.memberFileIds.map((fid) => parentDir(pathMap.get(fid) ?? fid)));
    communityDirs.set(c.id, dirs);
  }

  const absorbed: string[] = []; // singletons that found a home
  const orphans: string[] = [];  // singletons that didn't match

  for (const s of singles) {
    const fid = s.memberFileIds[0];
    const fDir = parentDir(pathMap.get(fid) ?? fid);

    // Only absorb if the singleton's directory is already represented in a community
    let bestCommunity: Community | null = null;
    for (const c of multi) {
      if (c.memberFileIds.length >= MAX_CLUSTER_FILES) continue; // respect cap
      const dirs = communityDirs.get(c.id)!;
      if (dirs.has(fDir)) { bestCommunity = c; break; }
    }

    if (bestCommunity) {
      bestCommunity.memberFileIds.push(fid);
      absorbed.push(fid);
    } else {
      orphans.push(fid);
    }
  }

  // Group remaining orphans by directory into small communities
  const dirGroups = new Map<string, string[]>();
  for (const fid of orphans) {
    const dir = parentDir(pathMap.get(fid) ?? fid);
    const list = dirGroups.get(dir) ?? [];
    list.push(fid);
    dirGroups.set(dir, list);
  }

  const result = [...multi];
  for (const [, members] of dirGroups) {
    result.push({ id: '', memberFileIds: members.sort() });
  }

  // Re-number
  return result.map((c, i) => ({ ...c, id: `community-${i}`, memberFileIds: c.memberFileIds.sort() }));
}

// ── Small-community merging ─────────────────────────────────────────────

/**
 * Merge communities smaller than MIN_CLUSTER_FILES into their best neighbor.
 * "Best" = the community sharing the most edges, breaking ties by directory
 * proximity. This prevents the cluster map from being dominated by tiny
 * fragments that don't carry enough context for an agent.
 */
function mergeSmallCommunities(
  communities: Community[],
  graph: InstanceType<typeof Graph>,
  pathMap: Map<string, string>,
): Community[] {
  // Build file → community index
  const fileToCIdx = new Map<string, number>();
  for (let i = 0; i < communities.length; i++) {
    for (const fid of communities[i].memberFileIds) fileToCIdx.set(fid, i);
  }

  // Iteratively merge smallest into best neighbor
  const merged = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < communities.length; i++) {
      if (merged.has(i)) continue;
      if (communities[i].memberFileIds.length >= MIN_CLUSTER_FILES) continue;

      // Count edges to each other community
      const edgeCounts = new Map<number, number>();
      for (const fid of communities[i].memberFileIds) {
        if (!graph.hasNode(fid)) continue;
        graph.forEachNeighbor(fid, (neighbor) => {
          const nIdx = fileToCIdx.get(neighbor);
          if (nIdx !== undefined && nIdx !== i && !merged.has(nIdx)) {
            edgeCounts.set(nIdx, (edgeCounts.get(nIdx) ?? 0) + 1);
          }
        });
      }

      // Pick the neighbor with most edges; if none, pick closest by directory
      let bestIdx = -1;
      let bestEdges = 0;
      for (const [idx, count] of edgeCounts) {
        if (count > bestEdges && communities[idx].memberFileIds.length + communities[i].memberFileIds.length <= MAX_CLUSTER_FILES) {
          bestEdges = count;
          bestIdx = idx;
        }
      }

      if (bestIdx === -1) {
        // No edge-connected neighbor under the cap — try directory proximity
        // but only within the same package to avoid cross-package merging
        const myDir = parentDir(pathMap.get(communities[i].memberFileIds[0]) ?? '');
        const myPkg = packagePrefix(myDir);
        let bestScore = -1;
        for (let j = 0; j < communities.length; j++) {
          if (j === i || merged.has(j)) continue;
          if (communities[j].memberFileIds.length + communities[i].memberFileIds.length > MAX_CLUSTER_FILES) continue;
          const otherDir = parentDir(pathMap.get(communities[j].memberFileIds[0]) ?? '');
          if (packagePrefix(otherDir) !== myPkg) continue; // don't cross packages
          const myParts = myDir.split('/');
          const otherParts = otherDir.split('/');
          let common = 0;
          while (common < myParts.length && common < otherParts.length && myParts[common] === otherParts[common]) common++;
          if (common > bestScore) { bestScore = common; bestIdx = j; }
        }
      }

      if (bestIdx === -1) continue;

      // Merge i into bestIdx
      for (const fid of communities[i].memberFileIds) {
        communities[bestIdx].memberFileIds.push(fid);
        fileToCIdx.set(fid, bestIdx);
      }
      communities[i].memberFileIds = [];
      merged.add(i);
      changed = true;
    }
  }

  return communities
    .filter((_, i) => !merged.has(i))
    .map((c, i) => ({ ...c, id: `community-${i}`, memberFileIds: c.memberFileIds.sort() }));
}

// ── Oversized community splitting ───────────────────────────────────────

/**
 * Recursively split communities that exceed context-window thresholds.
 * Uses sub-graph Louvain with progressively higher resolution.
 */
function splitOversizedCommunities(
  communities: Community[],
  locMap: Map<string, number>,
  graph: InstanceType<typeof Graph>,
): Community[] {
  const result: Community[] = [];
  let nextId = communities.length;

  for (const community of communities) {
    const loc = community.memberFileIds.reduce((s, fid) => s + (locMap.get(fid) ?? 0), 0);
    if (loc <= MAX_CLUSTER_LOC && community.memberFileIds.length <= MAX_CLUSTER_FILES) {
      result.push(community);
      continue;
    }

    // Build subgraph and run Louvain at higher resolution
    const subGraph = new UndirectedGraph();
    const members = new Set(community.memberFileIds);
    for (const fid of members) {
      if (graph.hasNode(fid)) subGraph.addNode(fid);
    }
    graph.forEachEdge((edge, attrs, src, tgt) => {
      if (members.has(src) && members.has(tgt) && subGraph.hasNode(src) && subGraph.hasNode(tgt)) {
        if (!subGraph.hasEdge(src, tgt)) {
          subGraph.addEdge(src, tgt, { weight: attrs.weight ?? 1 });
        }
      }
    });

    if (subGraph.size === 0 || subGraph.order < 4) {
      result.push(community);
      continue;
    }

    try {
      const sub = louvain.detailed(subGraph, {
        getEdgeWeight: 'weight',
        resolution: LOUVAIN_RESOLUTION * 2,
      });

      const subMap = new Map<number, string[]>();
      for (const [node, cid] of Object.entries(sub.communities)) {
        const list = subMap.get(cid) ?? [];
        list.push(node);
        subMap.set(cid, list);
      }

      if (subMap.size <= 1) {
        // Louvain couldn't split further — keep as-is
        result.push(community);
      } else {
        // Collect sub-communities; absorb sub-singletons into the largest sub-community
        const subComms = [...subMap.values()].sort((a, b) => b.length - a.length);
        const largest = subComms[0];
        for (let i = 1; i < subComms.length; i++) {
          if (subComms[i].length === 1) {
            largest.push(subComms[i][0]);
          } else {
            result.push({
              id: `community-${nextId++}`,
              memberFileIds: subComms[i].sort(),
            });
          }
        }
        // Also add any members not in the subgraph (absorbed isolates)
        for (const fid of members) {
          if (!subGraph.hasNode(fid)) largest.push(fid);
        }
        result.push({
          id: `community-${nextId++}`,
          memberFileIds: largest.sort(),
        });
      }
    } catch {
      result.push(community);
    }
  }

  // Re-number sequentially
  return result.map((c, i) => ({ ...c, id: `community-${i}` }));
}

// ── Shared-type extraction ──────────────────────────────────────────────

/** Minimum number of consuming communities before a contract file is extracted. */
const SHARED_TYPE_MIN_CONSUMERS = 2;

/**
 * Extract contract/type files consumed by multiple communities into
 * dedicated "shared types" clusters. This keeps implementation clusters
 * focused on a single agent's scope — shared interfaces become their own
 * boundary clusters.
 */
function extractSharedTypes(
  communities: Community[],
  edges: WeightedEdge[],
  roleMap: Map<string, CodeContentRole | undefined>,
): Community[] {
  // Build file → community lookup
  const fileToCommunity = new Map<string, string>();
  for (const c of communities) {
    for (const fid of c.memberFileIds) fileToCommunity.set(fid, c.id);
  }

  // For each target file, count how many distinct communities import it
  const targetConsumers = new Map<string, Set<string>>();
  for (const edge of edges) {
    const srcCommunity = fileToCommunity.get(edge.sourceFileId);
    const tgtCommunity = fileToCommunity.get(edge.targetFileId);
    if (!srcCommunity || !tgtCommunity) continue;
    if (srcCommunity === tgtCommunity) continue; // same cluster — not cross-community

    let consumers = targetConsumers.get(edge.targetFileId);
    if (!consumers) {
      consumers = new Set();
      targetConsumers.set(edge.targetFileId, consumers);
    }
    consumers.add(srcCommunity);
  }

  // Identify contract files consumed by ≥ N communities
  const sharedFiles = new Set<string>();
  for (const [fileId, consumers] of targetConsumers) {
    if (consumers.size < SHARED_TYPE_MIN_CONSUMERS) continue;
    const role = roleMap.get(fileId);
    if (role === 'contract' || role === 'infrastructure') {
      sharedFiles.add(fileId);
    }
  }

  if (sharedFiles.size === 0) return communities;

  // Group extracted files by directory prefix so related types stay together
  // Only create a separate cluster if the group is big enough to be meaningful
  const dirGroups = new Map<string, string[]>();
  for (const fid of sharedFiles) {
    const dir = parentDir(fid);
    const list = dirGroups.get(dir) ?? [];
    list.push(fid);
    dirGroups.set(dir, list);
  }

  const actuallyExtracted = new Set<string>();
  const viableGroups: string[][] = [];
  for (const [, members] of dirGroups) {
    if (members.length >= MIN_CLUSTER_FILES) {
      viableGroups.push(members);
      for (const fid of members) actuallyExtracted.add(fid);
    }
    // Small groups stay in their original community — not worth fragmenting
  }

  if (actuallyExtracted.size === 0) return communities;

  // Remove extracted files from their original communities
  const remaining = communities
    .map((c) => ({
      ...c,
      memberFileIds: c.memberFileIds.filter((fid) => !actuallyExtracted.has(fid)),
    }))
    .filter((c) => c.memberFileIds.length > 0);

  // Create new shared-type communities
  let nextId = remaining.length;
  const sharedCommunities: Community[] = [];
  for (const members of viableGroups) {
    sharedCommunities.push({
      id: `community-${nextId++}`,
      memberFileIds: members.sort(),
    });
  }

  // Re-number sequentially
  return [...remaining, ...sharedCommunities].map((c, i) => ({
    ...c,
    id: `community-${i}`,
  }));
}

function splitMixedConcernCommunities(
  communities: Community[],
  roleMap: Map<string, CodeContentRole | undefined>,
): Community[] {
  const next: Community[] = [];
  for (const community of communities) {
    const byRole = new Map<string, string[]>();
    for (const fid of community.memberFileIds) {
      const role = roleMap.get(fid) ?? 'unknown';
      const list = byRole.get(role) ?? [];
      list.push(fid);
      byRole.set(role, list);
    }
    const dominant = [...byRole.values()].sort((a, b) => b.length - a.length)[0]?.length ?? 0;
    if (byRole.size <= 1 || dominant / Math.max(community.memberFileIds.length, 1) >= ROLE_FOCUS_RATIO) {
      next.push({ ...community, memberFileIds: [...community.memberFileIds].sort() });
      continue;
    }
    for (const members of byRole.values()) {
      if (members.length === 0) continue;
      next.push({ id: '', memberFileIds: members.sort() });
    }
  }
  return next.map((c, i) => ({ ...c, id: `community-${i}` }));
}

function mergeUndersizedCommunities(
  communities: Community[],
  graph: InstanceType<typeof Graph>,
  pathMap: Map<string, string>,
  locMap: Map<string, number>,
  roleMap: Map<string, CodeContentRole | undefined>,
): Community[] {
  const work = communities.map((c) => ({ ...c, memberFileIds: [...c.memberFileIds] }));
  const fileToIdx = new Map<string, number>();
  for (let i = 0; i < work.length; i++) {
    for (const fid of work[i].memberFileIds) fileToIdx.set(fid, i);
  }

  const merged = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < work.length; i++) {
      if (merged.has(i)) continue;
      const loc = communityLoc(work[i], locMap);
      if (loc >= MIN_CLUSTER_LOC || work[i].memberFileIds.length >= MIN_CLUSTER_FILES) continue;

      const myRole = dominantRole(work[i], roleMap);
      const myTech = dominantTech(work[i], pathMap);
      const candidateScore = new Map<number, number>();

      for (const fid of work[i].memberFileIds) {
        if (!graph.hasNode(fid)) continue;
        graph.forEachNeighbor(fid, (neighbor) => {
          const idx = fileToIdx.get(neighbor);
          if (idx == null || idx === i || merged.has(idx)) return;
          if (dominantRole(work[idx], roleMap) !== myRole) return;
          if (dominantTech(work[idx], pathMap) !== myTech) return;
          candidateScore.set(idx, (candidateScore.get(idx) ?? 0) + 1);
        });
      }

      let bestIdx = -1;
      let bestScore = 0;
      for (const [idx, score] of candidateScore) {
        if (score <= bestScore) continue;
        if (work[idx].memberFileIds.length + work[i].memberFileIds.length > MAX_CLUSTER_FILES) continue;
        if (communityLoc(work[idx], locMap) + loc > MAX_CLUSTER_LOC) continue;
        bestIdx = idx;
        bestScore = score;
      }
      if (bestIdx === -1) continue;

      for (const fid of work[i].memberFileIds) {
        work[bestIdx].memberFileIds.push(fid);
        fileToIdx.set(fid, bestIdx);
      }
      work[i].memberFileIds = [];
      merged.add(i);
      changed = true;
    }
  }

  return work
    .filter((_, idx) => !merged.has(idx))
    .map((c, i) => ({ ...c, id: `community-${i}`, memberFileIds: c.memberFileIds.sort() }));
}

function annotateCommunities(
  communities: Community[],
  pathMap: Map<string, string>,
  locMap: Map<string, number>,
  roleMap: Map<string, CodeContentRole | undefined>,
): Community[] {
  return communities.map((community) => {
    const totalLoc = communityLoc(community, locMap);
    return {
      ...community,
      totalLoc,
      dominantTechnology: dominantTech(community, pathMap),
      dominantRole: dominantRole(community, roleMap),
    };
  });
}

function dominantRole(
  community: Community,
  roleMap: Map<string, CodeContentRole | undefined>,
): CodeContentRole | undefined {
  const counts = new Map<CodeContentRole, number>();
  for (const fid of community.memberFileIds) {
    const role = roleMap.get(fid);
    if (!role) continue;
    counts.set(role, (counts.get(role) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function dominantTech(community: Community, pathMap: Map<string, string>): string | undefined {
  const counts = new Map<string, number>();
  for (const fid of community.memberFileIds) {
    const p = pathMap.get(fid);
    if (!p) continue;
    const tech = packagePrefix(p);
    counts.set(tech, (counts.get(tech) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function communityLoc(community: Community, locMap: Map<string, number>): number {
  let loc = 0;
  for (const fid of community.memberFileIds) loc += locMap.get(fid) ?? 0;
  return loc;
}

function computeCommunityExposure(
  communities: Community[],
  edges: WeightedEdge[],
  locMap: Map<string, number>,
): ClusterExposure[] {
  const fileToCommunity = new Map<string, string>();
  const communityFiles = new Map<string, Set<string>>();
  for (const c of communities) {
    const set = new Set(c.memberFileIds);
    communityFiles.set(c.id, set);
    for (const fid of c.memberFileIds) fileToCommunity.set(fid, c.id);
  }

  const directExposed = new Map<string, Set<string>>();
  for (const edge of edges) {
    const srcC = fileToCommunity.get(edge.sourceFileId);
    const tgtC = fileToCommunity.get(edge.targetFileId);
    if (!srcC || !tgtC || srcC === tgtC) continue;
    let set = directExposed.get(tgtC);
    if (!set) {
      set = new Set();
      directExposed.set(tgtC, set);
    }
    set.add(edge.targetFileId);
  }

  return communities.map((c) => {
    const files = communityFiles.get(c.id)!;
    const exposed = directExposed.get(c.id) ?? new Set<string>();
    let totalLoc = 0;
    let exposedLoc = 0;
    for (const fid of files) {
      const loc = locMap.get(fid) ?? 0;
      totalLoc += loc;
      if (exposed.has(fid)) exposedLoc += loc;
    }
    return {
      clusterId: c.id,
      totalLoc,
      exposedLoc,
      exposureRatio: totalLoc > 0 ? Math.round((exposedLoc / totalLoc) * 1000) / 1000 : 0,
      exposedFileCount: exposed.size,
      directExposureLoc: exposedLoc,
      barrelExposureLoc: 0,
    };
  });
}

function computeSuperClusterExposure(
  superClusters: SuperCluster[],
  communities: Community[],
  edges: WeightedEdge[],
  locMap: Map<string, number>,
): ClusterExposure[] {
  const communityById = new Map(communities.map((c) => [c.id, c]));
  const fileToCommunity = new Map<string, string>();
  for (const c of communities) for (const fid of c.memberFileIds) fileToCommunity.set(fid, c.id);

  const results: ClusterExposure[] = [];
  const walk = (cluster: SuperCluster) => {
    const cids = collectCommunityIds(cluster);
    const cidSet = new Set(cids);
    const fileSet = new Set<string>();
    for (const cid of cids) for (const fid of communityById.get(cid)?.memberFileIds ?? []) fileSet.add(fid);

    const exposedFiles = new Set<string>();
    for (const edge of edges) {
      const srcC = fileToCommunity.get(edge.sourceFileId);
      const tgtC = fileToCommunity.get(edge.targetFileId);
      if (!srcC || !tgtC || srcC === tgtC) continue;
      if (!cidSet.has(srcC) && cidSet.has(tgtC)) exposedFiles.add(edge.targetFileId);
    }

    let totalLoc = 0;
    let exposedLoc = 0;
    for (const fid of fileSet) {
      const loc = locMap.get(fid) ?? 0;
      totalLoc += loc;
      if (exposedFiles.has(fid)) exposedLoc += loc;
    }
    results.push({
      clusterId: cluster.id,
      totalLoc,
      exposedLoc,
      exposureRatio: totalLoc > 0 ? Math.round((exposedLoc / totalLoc) * 1000) / 1000 : 0,
      exposedFileCount: exposedFiles.size,
      directExposureLoc: exposedLoc,
      barrelExposureLoc: 0,
    });
    for (const child of cluster.children) {
      if (child.kind === 'supercluster') walk(child.cluster);
    }
  };
  for (const cluster of superClusters) walk(cluster);
  return results;
}

function applyExposureToCommunities(communities: Community[], exposure: ClusterExposure[]): void {
  const map = new Map(exposure.map((e) => [e.clusterId, e.exposureRatio]));
  for (const c of communities) c.exposureRatio = map.get(c.id) ?? 0;
}

function applyExposureToSuperClusters(superClusters: SuperCluster[], exposure: ClusterExposure[]): void {
  const map = new Map(exposure.map((e) => [e.clusterId, e.exposureRatio]));
  const visit = (s: SuperCluster) => {
    s.exposureRatio = map.get(s.id) ?? 0;
    for (const child of s.children) {
      if (child.kind === 'supercluster') visit(child.cluster);
    }
  };
  for (const s of superClusters) visit(s);
}

function collectCommunityIds(superCluster: SuperCluster): string[] {
  const ids: string[] = [];
  const walk = (s: SuperCluster) => {
    for (const child of s.children) {
      if (child.kind === 'community') ids.push(child.communityId);
      else walk(child.cluster);
    }
  };
  walk(superCluster);
  return ids;
}

// ── Supercluster detection ──────────────────────────────────────────────

function buildSuperClusters(
  communities: Community[],
  edges: WeightedEdge[],
  roleMap: Map<string, CodeContentRole | undefined>,
  pathMap: Map<string, string>,
  locMap: Map<string, number>,
): SuperCluster[] {
  const communityById = new Map(communities.map((c) => [c.id, c]));
  const fileToCommunity = new Map<string, string>();
  for (const c of communities) {
    for (const fid of c.memberFileIds) fileToCommunity.set(fid, c.id);
  }

  // Initial grouping: package affinity + contract consumer links.
  const parent = new Map<string, string>();
  for (const c of communities) parent.set(c.id, c.id);
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const byPkg = new Map<string, string[]>();
  for (const c of communities) {
    const pkg = c.dominantTechnology ?? packagePrefix(pathMap.get(c.memberFileIds[0] ?? '') ?? '');
    const list = byPkg.get(pkg) ?? [];
    list.push(c.id);
    byPkg.set(pkg, list);
  }
  for (const ids of byPkg.values()) {
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }

  for (const edge of edges) {
    const src = fileToCommunity.get(edge.sourceFileId);
    const tgt = fileToCommunity.get(edge.targetFileId);
    if (!src || !tgt || src === tgt) continue;
    const role = roleMap.get(edge.targetFileId);
    if (role === 'contract' || role === 'infrastructure' || role === 'barrel') {
      union(src, tgt);
    }
  }

  const groups = new Map<string, string[]>();
  for (const c of communities) {
    const root = find(c.id);
    const list = groups.get(root) ?? [];
    list.push(c.id);
    groups.set(root, list);
  }

  let nextId = 0;
  const nextSuperId = () => `supercluster-${nextId++}`;

  const roots: SuperCluster[] = [...groups.values()]
    .map((cids) => buildSuperClusterRecursive(cids.sort(), 0))
    .filter((s): s is SuperCluster => s != null);

  return roots;

  function buildSuperClusterRecursive(communityIds: string[], depth: number): SuperCluster | null {
    if (communityIds.length === 0) return null;
    const sharedContractFileIds = findSharedContractFiles(communityIds);
    const sharedContractLoc = sumLoc(sharedContractFileIds);
    const totalFiles = communityIds.reduce((s, id) => s + (communityById.get(id)?.memberFileIds.length ?? 0), 0);
    const dominantTechnology = dominantTech(communityIds);
    const dominantRole = dominantSharedRole(sharedContractFileIds);

    const withinCaps = communityIds.length <= MAX_SUPERCLUSTER_CHILDREN && sharedContractLoc <= MAX_SUPERCLUSTER_SHARED_LOC;
    let children: SuperClusterChild[] = [];

    if (withinCaps || depth >= 5) {
      children = communityIds.map((communityId) => ({ kind: 'community', communityId }));
    } else {
      const partitions = splitCommunityIds(communityIds, sharedContractLoc);
      for (const part of partitions) {
        if (part.length === 1) {
          children.push({ kind: 'community', communityId: part[0] });
          continue;
        }
        const child = buildSuperClusterRecursive(part, depth + 1);
        if (child) children.push({ kind: 'supercluster', cluster: child });
      }
      if (children.length === 1 && children[0].kind === 'supercluster') {
        return children[0].cluster;
      }
    }

    return {
      id: nextSuperId(),
      label: dominantTechnology ? `${dominantTechnology} scope` : `scope ${depth + 1}`,
      sharedContractLoc,
      sharedContractFileIds: [...sharedContractFileIds].sort(),
      totalFiles,
      dominantTechnology,
      dominantRole,
      coordinatorScope: buildCoordinatorScope(dominantTechnology, dominantRole),
      children,
    };
  }

  function splitCommunityIds(communityIds: string[], sharedLoc: number): string[][] {
    // Try a meaningful split by technology first.
    const byTech = new Map<string, string[]>();
    for (const id of communityIds) {
      const key = communityById.get(id)?.dominantTechnology ?? '';
      const list = byTech.get(key) ?? [];
      list.push(id);
      byTech.set(key, list);
    }
    const techGroups = [...byTech.values()].filter((v) => v.length > 0);
    if (techGroups.length > 1) return techGroups.map((ids) => ids.sort());

    // Fallback: chunk deterministically to enforce caps.
    const sorted = [...communityIds].sort((a, b) =>
      (communityById.get(b)?.totalLoc ?? 0) - (communityById.get(a)?.totalLoc ?? 0));
    const targetGroupCount = Math.max(
      Math.ceil(sorted.length / MAX_SUPERCLUSTER_CHILDREN),
      Math.ceil(sharedLoc / MAX_SUPERCLUSTER_SHARED_LOC),
    );
    const groups: string[][] = Array.from({ length: Math.max(2, targetGroupCount) }, () => []);
    for (let i = 0; i < sorted.length; i++) groups[i % groups.length].push(sorted[i]);
    return groups.filter((g) => g.length > 0).map((g) => g.sort());
  }

  function findSharedContractFiles(communityIds: string[]): Set<string> {
    const inGroup = new Set(communityIds);
    const consumerByTarget = new Map<string, Set<string>>();
    for (const edge of edges) {
      const src = fileToCommunity.get(edge.sourceFileId);
      const tgt = fileToCommunity.get(edge.targetFileId);
      if (!src || !tgt || src === tgt || !inGroup.has(src) || !inGroup.has(tgt)) continue;
      const role = roleMap.get(edge.targetFileId);
      if (!(role === 'contract' || role === 'infrastructure' || role === 'barrel')) continue;
      let consumers = consumerByTarget.get(edge.targetFileId);
      if (!consumers) {
        consumers = new Set();
        consumerByTarget.set(edge.targetFileId, consumers);
      }
      consumers.add(src);
    }
    const shared = new Set<string>();
    for (const [fid, consumers] of consumerByTarget) {
      if (consumers.size >= 2) shared.add(fid);
    }
    return shared;
  }

  function dominantTech(communityIds: string[]): string | undefined {
    const counts = new Map<string, number>();
    for (const id of communityIds) {
      const tech = communityById.get(id)?.dominantTechnology;
      if (!tech) continue;
      counts.set(tech, (counts.get(tech) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  function dominantSharedRole(fileIds: Set<string>): CodeContentRole | undefined {
    const counts = new Map<CodeContentRole, number>();
    for (const fid of fileIds) {
      const role = roleMap.get(fid);
      if (!role) continue;
      counts.set(role, (counts.get(role) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }

  function buildCoordinatorScope(tech?: string, role?: CodeContentRole): string {
    if (tech && role) return `${tech} ${role} coordination`;
    if (tech) return `${tech} coordination`;
    if (role) return `${role} coordination`;
    return 'coordination scope';
  }

  function sumLoc(fileIds: Iterable<string>): number {
    let total = 0;
    for (const fid of fileIds) total += locMap.get(fid) ?? 0;
    return total;
  }
}

// ── Misplaced file detection ────────────────────────────────────────────

function findMisplacedFiles(
  communities: Community[],
  pathMap: Map<string, string>,
): MisplacedFile[] {
  const results: MisplacedFile[] = [];

  for (const community of communities) {
    if (community.memberFileIds.length < 2) continue;

    // Count members per directory
    const dirCounts = new Map<string, number>();
    for (const fid of community.memberFileIds) {
      const fp = pathMap.get(fid);
      if (!fp) continue;
      const dir = parentDir(fp);
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    }

    // Find majority directory
    let majorityDir = '';
    let majorityCount = 0;
    for (const [dir, count] of dirCounts) {
      if (count > majorityCount) {
        majorityDir = dir;
        majorityCount = count;
      }
    }
    if (majorityCount < 2) continue;

    // Flag files not in the majority directory
    for (const fid of community.memberFileIds) {
      const fp = pathMap.get(fid);
      if (!fp) continue;
      const dir = parentDir(fp);
      if (dir !== majorityDir) {
        results.push({
          fileId: fid,
          filePath: fp,
          currentDirectory: dir,
          communityId: community.id,
          suggestedDirectory: majorityDir,
          peerCount: majorityCount,
        });
      }
    }
  }

  results.sort((a, b) => b.peerCount - a.peerCount);
  return results;
}

// ── Tangled directory detection ─────────────────────────────────────────

function findTangledDirectories(
  communities: Community[],
  pathMap: Map<string, string>,
): TangledDirectory[] {
  // Map directory → set of community IDs
  const dirCommunities = new Map<string, Set<string>>();
  const dirFileCounts = new Map<string, number>();

  for (const community of communities) {
    for (const fid of community.memberFileIds) {
      const fp = pathMap.get(fid);
      if (!fp) continue;
      const dir = parentDir(fp);
      const cids = dirCommunities.get(dir) ?? new Set();
      cids.add(community.id);
      dirCommunities.set(dir, cids);
      dirFileCounts.set(dir, (dirFileCounts.get(dir) ?? 0) + 1);
    }
  }

  const results: TangledDirectory[] = [];
  for (const [dir, cids] of dirCommunities) {
    if (cids.size >= TANGLED_THRESHOLD) {
      results.push({
        directory: dir,
        communityCount: cids.size,
        communityIds: [...cids].sort(),
        fileCount: dirFileCounts.get(dir) ?? 0,
      });
    }
  }

  results.sort((a, b) => b.communityCount - a.communityCount);
  return results;
}
