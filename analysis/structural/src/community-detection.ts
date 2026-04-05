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
  Community, CommunityDetectionResult, MisplacedFile, TangledDirectory,
} from './types.js';
import type { CodeContentRole } from './2-code-classification.js';
import { parentDir } from './types.js';

// ── Constants ───────────────────────────────────────────────────────────

const TANGLED_THRESHOLD = 3;

/**
 * Target max cluster size in LOC. Clusters larger than this get recursively
 * split so each cluster fits comfortably in a single LLM context window.
 * ~8 000 LOC ≈ ~25 000 tokens — leaves room for prompts and output.
 */
const MAX_CLUSTER_LOC = 8_000;
const MAX_CLUSTER_FILES = 30;

/**
 * Higher resolution → more, smaller communities. Default Louvain is 1.0;
 * we use a higher value to keep clusters context-window-sized.
 */
const LOUVAIN_RESOLUTION = 1.2;

// ── Community detection ─────────────────────────────────────────────────

export function detectCommunities(
  weightedEdges: WeightedEdge[],
  fileClassifications: FileClassificationEntry[],
): CommunityDetectionResult {
  const codeFiles = fileClassifications.filter((f) => f.category === 'code');
  if (codeFiles.length < 2) {
    return { communities: [], modularity: 0, misplacedFiles: [], tangledDirectories: [] };
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
    return { communities: [], modularity: 0, misplacedFiles: [], tangledDirectories: [] };
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

  // Split oversized communities so each fits in a context window
  let communities: Community[] = [...communityMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, members], i) => ({
      id: `community-${i}`,
      memberFileIds: members.sort(),
    }));

  // Absorb singleton files into the nearest community by directory
  communities = absorbSingletons(communities, pathMap);

  // Split oversized communities (after absorb, since absorbed singletons may push clusters over the cap)
  communities = splitOversizedCommunities(communities, locMap, graph);

  // Extract shared contract/type files into their own clusters
  const roleMap = new Map<string, CodeContentRole | undefined>();
  for (const f of codeFiles) roleMap.set(f.fileId, f.contentRole);
  communities = extractSharedTypes(communities, weightedEdges, roleMap);

  // Detect misplaced files: file's community majority dir ≠ file's actual dir
  const misplacedFiles = findMisplacedFiles(communities, pathMap);
  const tangledDirectories = findTangledDirectories(communities, pathMap);

  return {
    communities,
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
  const dirGroups = new Map<string, string[]>();
  for (const fid of sharedFiles) {
    const dir = parentDir(fid);
    const list = dirGroups.get(dir) ?? [];
    list.push(fid);
    dirGroups.set(dir, list);
  }

  // Remove extracted files from their original communities
  const remaining = communities
    .map((c) => ({
      ...c,
      memberFileIds: c.memberFileIds.filter((fid) => !sharedFiles.has(fid)),
    }))
    .filter((c) => c.memberFileIds.length > 0);

  // Create new shared-type communities
  let nextId = remaining.length;
  const sharedCommunities: Community[] = [];
  for (const [, members] of dirGroups) {
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
