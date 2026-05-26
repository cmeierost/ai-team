/**
 * @aspect/engine — Community detection (Louvain)
 *
 * Detects dense subgraphs in the entity dependency graph using the Louvain
 * algorithm. Entities (functions, classes, interfaces, etc.) are the graph
 * nodes; cross-file entity references are the edges.
 *
 * When entities from the same file land in different communities, that file
 * is flagged as a split candidate — it contains entities that belong to
 * different concerns and should be considered for restructuring.
 *
 * Also detects:
 *   - Misplaced files (community ≠ directory)
 *   - Tangled directories (too many communities in one folder)
 *   - Split file candidates (entities from one file in multiple communities)
 */

import Graph from 'graphology';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const UndirectedGraph = (Graph as any).UndirectedGraph as typeof Graph;
import louvain from 'graphology-communities-louvain';

import type { Entity } from '@aspect/contracts';
import type {
  WeightedEdge, FileClassificationEntry,
  Community, CommunityGroup, CommunityGroupChild, CommunityDetectionResult,
  MisplacedFile, TangledDirectory, ClusterExposure, SplitFileCandidate,
  CrossGroupEdge,
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
const MAX_CLUSTER_LOC = 10_000;
const MAX_CLUSTER_FILES = 30;
const MIN_CLUSTER_LOC = 3_000;
const MAX_CommunityGroup_SHARED_LOC = 5_000;
const MAX_CommunityGroup_CHILDREN = 5;
/** Minimum number of communities a CommunityGroup should contain.
 *  Singletons or tiny SCs get merged with the closest technology/role match. */
const MIN_CommunityGroup_COMMUNITIES = 2;

/**
 * Higher resolution → more, smaller communities. Default Louvain is 1.0.
 */
const LOUVAIN_RESOLUTION = 1.8;

/** Communities below this size get merged into their best neighbor when meaningful. */
const MIN_CLUSTER_FILES = 4;
/** Fan-in above this triggers hub dampening in the Louvain graph. */
const HUB_FANIN_THRESHOLD = 10;
const ROLE_FOCUS_RATIO = 0.7;

// ── Entity context ──────────────────────────────────────────────────────

/** Shared lookup maps built from entities + file classifications. */
interface EntityCtx {
  /** Entity ID → file ID (e.g. "file:packages/core/src/index.ts"). */
  entityToFileId: Map<string, string>;
  /** Entity ID → bare file path. */
  entityToPath: Map<string, string>;
  /** Entity ID → LOC (from rawCounts.linesOfCode). */
  entityLoc: Map<string, number>;
  /** File ID → file LOC (from file classification). */
  fileLoc: Map<string, number>;
  /** File ID → bare file path. */
  filePath: Map<string, string>;
  /** File ID → content role. */
  fileRole: Map<string, CodeContentRole | undefined>;
  /** File ID → entity IDs belonging to that file (non-file entities only). */
  fileEntities: Map<string, string[]>;
}

function buildEntityCtx(
  entities: Entity[],
  fileClassifications: FileClassificationEntry[],
): EntityCtx {
  const entityToFileId = new Map<string, string>();
  const entityToPath = new Map<string, string>();
  const entityLoc = new Map<string, number>();
  const fileEntities = new Map<string, string[]>();

  for (const e of entities) {
    if (e.kind === 'file') continue;
    const fid = `file:${e.filePath}`;
    entityToFileId.set(e.id, fid);
    entityToPath.set(e.id, e.filePath);
    entityLoc.set(e.id, e.rawCounts?.linesOfCode ?? 0);
    const list = fileEntities.get(fid) ?? [];
    list.push(e.id);
    fileEntities.set(fid, list);
  }

  const fileLoc = new Map<string, number>();
  const filePath = new Map<string, string>();
  const fileRole = new Map<string, CodeContentRole | undefined>();
  for (const f of fileClassifications) {
    fileLoc.set(f.fileId, f.linesOfCode ?? 0);
    filePath.set(f.fileId, f.filePath);
    fileRole.set(f.fileId, f.contentRole);
  }

  return { entityToFileId, entityToPath, entityLoc, fileLoc, filePath, fileRole, fileEntities };
}

/** Derive deduplicated file IDs from entity membership. */
function deriveFileIds(memberEntityIds: string[], ctx: EntityCtx): string[] {
  const files = new Set<string>();
  for (const eid of memberEntityIds) {
    const fid = ctx.entityToFileId.get(eid);
    if (fid) files.add(fid);
  }
  return [...files].sort();
}

/** Create a community from entity IDs, deriving file membership. */
function makeCommunity(id: string, entityIds: string[], ctx: EntityCtx): Community {
  return {
    id,
    memberEntityIds: entityIds.sort(),
    memberFileIds: deriveFileIds(entityIds, ctx),
  };
}

/** Re-derive memberFileIds from memberEntityIds after mutations. */
function syncFileIds(community: Community, ctx: EntityCtx): void {
  community.memberFileIds = deriveFileIds(community.memberEntityIds, ctx);
}

// ── Community detection ─────────────────────────────────────────────────

export function detectCommunities(
  weightedEdges: WeightedEdge[],
  fileClassifications: FileClassificationEntry[],
  entities: Entity[],
): CommunityDetectionResult {
  const emptyResult: CommunityDetectionResult = {
    communities: [], communityGroups: [], crossGroupEdges: [], modularity: 0,
    misplacedFiles: [], tangledDirectories: [], splitFileCandidates: [],
  };

  const ctx = buildEntityCtx(entities, fileClassifications);

  // Filter to non-file entities that have cross-file edges
  const codeEntityIds = new Set<string>();
  for (const e of entities) {
    if (e.kind === 'file') continue;
    const fid = ctx.entityToFileId.get(e.id);
    if (!fid) continue;
    const fc = fileClassifications.find((f) => f.fileId === fid);
    if (fc?.category === 'code') codeEntityIds.add(e.id);
  }

  if (codeEntityIds.size < 2) return emptyResult;

  // Build undirected entity graph (Louvain requirement)
  const graph = new UndirectedGraph();
  for (const eid of codeEntityIds) graph.addNode(eid);

  // Hub dampening: compute fan-in per target entity
  const fanIn = new Map<string, number>();
  for (const edge of weightedEdges) {
    if (!codeEntityIds.has(edge.sourceEntityId) || !codeEntityIds.has(edge.targetEntityId)) continue;
    if (edge.sourceEntityId === edge.targetEntityId) continue;
    fanIn.set(edge.targetEntityId, (fanIn.get(edge.targetEntityId) ?? 0) + 1);
  }

  for (const edge of weightedEdges) {
    const src = edge.sourceEntityId;
    const tgt = edge.targetEntityId;
    if (!graph.hasNode(src) || !graph.hasNode(tgt)) continue;
    if (src === tgt) continue;

    let w = edge.weight;
    const targetFanIn = fanIn.get(tgt) ?? 1;
    if (targetFanIn > HUB_FANIN_THRESHOLD) {
      w *= HUB_FANIN_THRESHOLD / targetFanIn;
    }

    if (graph.hasEdge(src, tgt)) {
      const existing = (graph.getEdgeAttribute(src, tgt, 'weight') as number) ?? 0;
      graph.setEdgeAttribute(src, tgt, 'weight', existing + w);
    } else {
      graph.addEdge(src, tgt, { weight: w });
    }
  }

  if (graph.size === 0) return emptyResult;

  // Run Louvain on entity graph
  const detailed = louvain.detailed(graph, {
    getEdgeWeight: 'weight',
    resolution: LOUVAIN_RESOLUTION,
  });

  // Group entities by community
  const communityMap = new Map<number, string[]>();
  for (const [node, cid] of Object.entries(detailed.communities)) {
    const list = communityMap.get(cid) ?? [];
    list.push(node);
    communityMap.set(cid, list);
  }

  // Capture entity→community assignment before helpers (for split detection)
  const entityToCommunityIdx = new Map<string, number>();
  for (const [cid, members] of communityMap) {
    for (const eid of members) entityToCommunityIdx.set(eid, cid);
  }

  // Build file-level lookup maps (for helpers that reason about directories)
  const pathMap = new Map<string, string>();
  const locMap = new Map<string, number>();
  const roleMap = new Map<string, CodeContentRole | undefined>();
  for (const f of fileClassifications) {
    if (f.category === 'code') {
      pathMap.set(f.fileId, f.filePath);
      locMap.set(f.fileId, f.linesOfCode ?? 0);
      roleMap.set(f.fileId, f.contentRole);
    }
  }

  let communities: Community[] = [...communityMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, members], i) => makeCommunity(`community-${i}`, members, ctx));

  // Post-processing pipeline
  communities = absorbSingletons(communities, pathMap, ctx);
  communities = mergeSmallCommunities(communities, graph, pathMap, ctx);
  communities = splitOversizedCommunities(communities, locMap, graph, ctx);
  communities = splitMixedConcernCommunities(communities, roleMap, ctx);
  communities = mergeUndersizedCommunities(communities, graph, pathMap, locMap, roleMap, ctx);
  communities = extractSharedTypes(communities, weightedEdges, roleMap, ctx);
  communities = mergeCyclicCommunities(communities, weightedEdges, ctx);
  communities = splitCrossPackageCommunities(communities, ctx);
  communities = splitOversizedCommunities(communities, locMap, graph, ctx);
  communities = annotateCommunities(communities, pathMap, locMap, roleMap);

  // Build hierarchical community groups
  let communityGroups = buildCommunityGroups(communities, weightedEdges, roleMap, pathMap, locMap);
  communityGroups = mergeCyclicCommunityGroups(communityGroups, communities, weightedEdges, roleMap);

  const clusterExposure = computeCommunityExposure(communities, weightedEdges, locMap);
  const communityGroupExposure = computeCommunityGroupExposure(communityGroups, communities, weightedEdges, locMap);
  applyExposureToCommunities(communities, clusterExposure);
  applyExposureToCommunityGroups(communityGroups, communityGroupExposure);

  const misplacedFiles = findMisplacedFiles(communities, pathMap);
  const tangledDirectories = findTangledDirectories(communities, pathMap);

  // Detect split file candidates: files with entities in multiple communities
  const splitFileCandidates = detectSplitFiles(communities, ctx);

  // Compute cross-community edges (summarised)
  const crossGroupEdges = computeCrossGroupEdges(communities, weightedEdges);

  return {
    communities,
    communityGroups,
    crossGroupEdges,
    clusterExposure,
    communityGroupExposure,
    modularity: detailed.modularity,
    misplacedFiles,
    tangledDirectories,
    splitFileCandidates,
  };
}

// ── Cross-group edge summarisation ──────────────────────────────────────

/**
 * Summarise entity-level edges that cross community boundaries into
 * per-community-pair aggregates with direction tracking.
 */
function computeCrossGroupEdges(
  communities: Community[],
  edges: WeightedEdge[],
): CrossGroupEdge[] {
  const fileToCommunity = new Map<string, string>();
  for (const c of communities) {
    for (const fid of c.memberFileIds) fileToCommunity.set(fid, c.id);
  }

  // Aggregate: key = "srcCommunity→tgtCommunity"
  const agg = new Map<string, { fwd: number; bwd: number; count: number }>();
  for (const edge of edges) {
    const srcC = fileToCommunity.get(edge.sourceFileId);
    const tgtC = fileToCommunity.get(edge.targetFileId);
    if (!srcC || !tgtC || srcC === tgtC) continue;

    // Canonical key — always smaller id first to deduplicate directions
    const [a, b] = srcC < tgtC ? [srcC, tgtC] : [tgtC, srcC];
    const key = `${a}→${b}`;
    let entry = agg.get(key);
    if (!entry) { entry = { fwd: 0, bwd: 0, count: 0 }; agg.set(key, entry); }

    if (srcC === a) entry.fwd += edge.weight;
    else entry.bwd += edge.weight;
    entry.count++;
  }

  const result: CrossGroupEdge[] = [];
  for (const [key, { fwd, bwd, count }] of agg) {
    const [a, b] = key.split('→');
    result.push({
      sourceGroupId: a,
      targetGroupId: b,
      weight: fwd + bwd,
      edgeCount: count,
      dominantDirection: fwd >= bwd ? 'forward' : 'backward',
    });
  }
  return result;
}

// ── Singleton absorption ────────────────────────────────────────────────

/**
 * Absorb single-file communities into the nearest multi-file community
 * by directory proximity, or group isolated singletons by directory into
 * new small communities.
 */
function absorbSingletons(
  communities: Community[],
  pathMap: Map<string, string>,
  ctx: EntityCtx,
): Community[] {
  const multi = communities.filter((c) => c.memberFileIds.length > 1);
  const singles = communities.filter((c) => c.memberFileIds.length <= 1);

  if (singles.length === 0) return communities;

  const communityDirs = new Map<string, Set<string>>();
  for (const c of multi) {
    const dirs = new Set(c.memberFileIds.map((fid) => parentDir(pathMap.get(fid) ?? fid)));
    communityDirs.set(c.id, dirs);
  }

  const absorbedCommunities: Community[] = [];
  const orphanEntityIds: string[] = [];

  for (const s of singles) {
    if (s.memberEntityIds.length === 0) continue;
    const fid = s.memberFileIds[0];
    if (!fid) { orphanEntityIds.push(...s.memberEntityIds); continue; }
    const fDir = parentDir(pathMap.get(fid) ?? fid);

    let bestCommunity: Community | null = null;
    for (const c of multi) {
      if (c.memberFileIds.length >= MAX_CLUSTER_FILES) continue;
      const dirs = communityDirs.get(c.id)!;
      if (dirs.has(fDir)) { bestCommunity = c; break; }
    }

    if (bestCommunity) {
      bestCommunity.memberEntityIds.push(...s.memberEntityIds);
      syncFileIds(bestCommunity, ctx);
    } else {
      orphanEntityIds.push(...s.memberEntityIds);
    }
  }

  // Group remaining orphans by directory
  const dirGroups = new Map<string, string[]>();
  for (const eid of orphanEntityIds) {
    const fid = ctx.entityToFileId.get(eid);
    const dir = parentDir(fid ? (pathMap.get(fid) ?? fid) : '');
    const list = dirGroups.get(dir) ?? [];
    list.push(eid);
    dirGroups.set(dir, list);
  }

  const result = [...multi];
  for (const [, members] of dirGroups) {
    result.push(makeCommunity('', members, ctx));
  }

  return result.map((c, i) => ({ ...c, id: `community-${i}` }));
}

// ── Small-community merging ─────────────────────────────────────────────

/**
 * Merge communities smaller than MIN_CLUSTER_FILES into their best neighbor.
 * Works on entity-level graph for edge connectivity.
 */
function mergeSmallCommunities(
  communities: Community[],
  graph: InstanceType<typeof Graph>,
  pathMap: Map<string, string>,
  ctx: EntityCtx,
): Community[] {
  const entityToCIdx = new Map<string, number>();
  for (let i = 0; i < communities.length; i++) {
    for (const eid of communities[i].memberEntityIds) entityToCIdx.set(eid, i);
  }

  const merged = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < communities.length; i++) {
      if (merged.has(i)) continue;
      if (communities[i].memberFileIds.length >= MIN_CLUSTER_FILES) continue;

      // Count edges to each other community via entity graph
      const edgeCounts = new Map<number, number>();
      for (const eid of communities[i].memberEntityIds) {
        if (!graph.hasNode(eid)) continue;
        graph.forEachNeighbor(eid, (neighbor) => {
          const nIdx = entityToCIdx.get(neighbor);
          if (nIdx !== undefined && nIdx !== i && !merged.has(nIdx)) {
            edgeCounts.set(nIdx, (edgeCounts.get(nIdx) ?? 0) + 1);
          }
        });
      }

      let bestIdx = -1;
      let bestEdges = 0;
      for (const [idx, count] of edgeCounts) {
        if (count > bestEdges && communities[idx].memberFileIds.length + communities[i].memberFileIds.length <= MAX_CLUSTER_FILES) {
          bestEdges = count;
          bestIdx = idx;
        }
      }

      if (bestIdx === -1) {
        const myFid = communities[i].memberFileIds[0];
        const myDir = parentDir(pathMap.get(myFid) ?? '');
        const myPkg = packagePrefix(myDir);
        let bestScore = -1;
        for (let j = 0; j < communities.length; j++) {
          if (j === i || merged.has(j)) continue;
          if (communities[j].memberFileIds.length + communities[i].memberFileIds.length > MAX_CLUSTER_FILES) continue;
          const otherFid = communities[j].memberFileIds[0];
          const otherDir = parentDir(pathMap.get(otherFid) ?? '');
          if (packagePrefix(otherDir) !== myPkg) continue;
          const myParts = myDir.split('/');
          const otherParts = otherDir.split('/');
          let common = 0;
          while (common < myParts.length && common < otherParts.length && myParts[common] === otherParts[common]) common++;
          if (common > bestScore) { bestScore = common; bestIdx = j; }
        }
      }

      if (bestIdx === -1) continue;

      communities[bestIdx].memberEntityIds.push(...communities[i].memberEntityIds);
      for (const eid of communities[i].memberEntityIds) entityToCIdx.set(eid, bestIdx);
      communities[i].memberEntityIds = [];
      syncFileIds(communities[bestIdx], ctx);
      syncFileIds(communities[i], ctx);
      merged.add(i);
      changed = true;
    }
  }

  return communities
    .filter((_, i) => !merged.has(i))
    .map((c, i) => ({ ...c, id: `community-${i}` }));
}

// ── Oversized community splitting ───────────────────────────────────────

/**
/**
 * Directory-based splitting fallback: when Louvain can't split an oversized
 * community, group entities by their directory within the package.
 * Uses adaptive depth — tries depth-2 first, then depth-3 if largest group
 * is still too big.
 */
function splitByDirectory(
  community: Community,
  ctx: EntityCtx,
): string[][] {
  const tryDepth = (depth: number): Map<string, string[]> => {
    const byDir = new Map<string, string[]>();
    for (const eid of community.memberEntityIds) {
      const path = (ctx.entityToPath.get(eid) ?? '').replace(/\\/g, '/');
      const parts = path.split('/');
      const dir = parts.slice(2, 2 + depth).join('/') || 'root';
      const list = byDir.get(dir) ?? [];
      list.push(eid);
      byDir.set(dir, list);
    }
    return byDir;
  };

  let byDir = tryDepth(2);
  if (byDir.size <= 1) return [community.memberEntityIds];

  // If the largest bucket has >75% of entities, try depth 3
  const totalEntities = community.memberEntityIds.length;
  const largestSize = Math.max(...[...byDir.values()].map(g => g.length));
  if (largestSize > totalEntities * 0.75) {
    const deeper = tryDepth(3);
    if (deeper.size > byDir.size) byDir = deeper;
  }

  if (byDir.size <= 1) return [community.memberEntityIds];

  return [...byDir.values()].filter(g => g.length > 0).sort((a, b) => b.length - a.length);
}

/**
 * Recursively split communities that exceed context-window thresholds.
 * Uses sub-graph Louvain on entity graph with progressively higher resolution.
 */
function splitOversizedCommunities(
  communities: Community[],
  locMap: Map<string, number>,
  graph: InstanceType<typeof Graph>,
  ctx: EntityCtx,
): Community[] {
  let nextId = communities.length;
  const work = [...communities];
  const result: Community[] = [];

  // Iterative: keep splitting oversized communities until all fit or can't split
  while (work.length > 0) {
    const community = work.pop()!;
    const loc = community.memberFileIds.reduce((s, fid) => s + (locMap.get(fid) ?? 0), 0);
    if (loc <= MAX_CLUSTER_LOC && community.memberFileIds.length <= MAX_CLUSTER_FILES) {
      result.push(community);
      continue;
    }

    // Build entity subgraph
    const subGraph = new UndirectedGraph();
    const members = new Set(community.memberEntityIds);
    for (const eid of members) {
      if (graph.hasNode(eid)) subGraph.addNode(eid);
    }
    graph.forEachEdge((_edge, attrs, src, tgt) => {
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
        resolution: LOUVAIN_RESOLUTION * 1.5,
      });

      const subMap = new Map<number, string[]>();
      for (const [node, cid] of Object.entries(sub.communities)) {
        const list = subMap.get(cid) ?? [];
        list.push(node);
        subMap.set(cid, list);
      }

      if (subMap.size <= 1) {
        // Louvain couldn't split — try directory-based split as fallback
        const dirSplit = splitByDirectory(community, ctx);
        if (dirSplit.length > 1) {
          for (const sc of dirSplit) work.push(makeCommunity(`community-${nextId++}`, sc, ctx));
        } else {
          result.push(community);
        }
      } else {
        const subComms = [...subMap.values()].sort((a, b) => b.length - a.length);
        const realSubComms: string[][] = [];
        const singletons: string[] = [];
        for (const sc of subComms) {
          if (sc.length === 1) singletons.push(sc[0]);
          else realSubComms.push(sc);
        }
        // Redistribute singletons by edge/file proximity
        for (const eid of singletons) {
          let bestIdx = 0;
          let bestScore = 0;
          for (let j = 0; j < realSubComms.length; j++) {
            const nbrs = new Set(realSubComms[j]);
            let score = 0;
            if (subGraph.hasNode(eid)) {
              subGraph.forEachNeighbor(eid, (nb) => { if (nbrs.has(nb)) score++; });
            }
            const eidFile = ctx.entityToFileId.get(eid);
            if (eidFile) {
              for (const m of realSubComms[j]) {
                if (ctx.entityToFileId.get(m) === eidFile) score += 0.5;
              }
            }
            if (score > bestScore) { bestScore = score; bestIdx = j; }
          }
          realSubComms[bestIdx].push(eid);
        }
        // Isolated entities go to same-file community or largest
        for (const eid of members) {
          if (subGraph.hasNode(eid)) continue;
          const eidFile = ctx.entityToFileId.get(eid);
          let bestIdx = 0;
          let bestScore = 0;
          for (let j = 0; j < realSubComms.length; j++) {
            let score = 0;
            if (eidFile) {
              for (const m of realSubComms[j]) {
                if (ctx.entityToFileId.get(m) === eidFile) score++;
              }
            }
            if (score > bestScore) { bestScore = score; bestIdx = j; }
          }
          realSubComms[bestIdx].push(eid);
        }
        // Push sub-communities back to work queue for potential further splitting
        for (const sc of realSubComms) {
          work.push(makeCommunity(`community-${nextId++}`, sc, ctx));
        }
      }
    } catch {
      result.push(community);
    }
  }

  return result.map((c, i) => ({ ...c, id: `community-${i}` }));
}

// ── Shared-type extraction ──────────────────────────────────────────────

/** Minimum number of consuming communities before a contract file is extracted. */
const SHARED_TYPE_MIN_CONSUMERS = 2;

/**
 * Extract contract/type entities consumed by multiple communities into
 * dedicated "shared types" clusters.
 */
function extractSharedTypes(
  communities: Community[],
  edges: WeightedEdge[],
  roleMap: Map<string, CodeContentRole | undefined>,
  ctx: EntityCtx,
): Community[] {
  const fileToCommunity = new Map<string, string>();
  for (const c of communities) {
    for (const fid of c.memberFileIds) fileToCommunity.set(fid, c.id);
  }

  const targetConsumers = new Map<string, Set<string>>();
  for (const edge of edges) {
    const srcCommunity = fileToCommunity.get(edge.sourceFileId);
    const tgtCommunity = fileToCommunity.get(edge.targetFileId);
    if (!srcCommunity || !tgtCommunity) continue;
    if (srcCommunity === tgtCommunity) continue;

    let consumers = targetConsumers.get(edge.targetFileId);
    if (!consumers) {
      consumers = new Set();
      targetConsumers.set(edge.targetFileId, consumers);
    }
    consumers.add(srcCommunity);
  }

  const sharedFiles = new Set<string>();
  for (const [fileId, consumers] of targetConsumers) {
    if (consumers.size < SHARED_TYPE_MIN_CONSUMERS) continue;
    const role = roleMap.get(fileId);
    if (role === 'contract' || role === 'infrastructure') {
      sharedFiles.add(fileId);
    }
  }

  if (sharedFiles.size === 0) return communities;

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
  }

  if (actuallyExtracted.size === 0) return communities;

  // Remove extracted entities from their original communities
  const remaining = communities
    .map((c) => {
      const kept = c.memberEntityIds.filter((eid) => !actuallyExtracted.has(ctx.entityToFileId.get(eid)!));
      return { ...c, memberEntityIds: kept, memberFileIds: deriveFileIds(kept, ctx) };
    })
    .filter((c) => c.memberEntityIds.length > 0);

  // Create new shared-type communities from extracted files' entities
  let nextId = remaining.length;
  const sharedCommunities: Community[] = [];
  for (const fileIds of viableGroups) {
    const entityIds: string[] = [];
    for (const fid of fileIds) entityIds.push(...(ctx.fileEntities.get(fid) ?? []));
    sharedCommunities.push(makeCommunity(`community-${nextId++}`, entityIds, ctx));
  }

  return [...remaining, ...sharedCommunities].map((c, i) => ({
    ...c,
    id: `community-${i}`,
  }));
}

function splitMixedConcernCommunities(
  communities: Community[],
  roleMap: Map<string, CodeContentRole | undefined>,
  ctx: EntityCtx,
): Community[] {
  const next: Community[] = [];
  for (const community of communities) {
    // Group entities by their file's role
    const byRole = new Map<string, string[]>();
    for (const eid of community.memberEntityIds) {
      const fid = ctx.entityToFileId.get(eid);
      const role = (fid ? roleMap.get(fid) : undefined) ?? 'unknown';
      const list = byRole.get(role) ?? [];
      list.push(eid);
      byRole.set(role, list);
    }
    const dominant = [...byRole.values()].sort((a, b) => b.length - a.length)[0]?.length ?? 0;
    if (byRole.size <= 1 || dominant / Math.max(community.memberEntityIds.length, 1) >= ROLE_FOCUS_RATIO) {
      next.push(community);
      continue;
    }
    for (const members of byRole.values()) {
      if (members.length === 0) continue;
      next.push(makeCommunity('', members, ctx));
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
  ctx: EntityCtx,
): Community[] {
  const work = communities.map((c) => ({
    ...c,
    memberEntityIds: [...c.memberEntityIds],
    memberFileIds: [...c.memberFileIds],
  }));
  const entityToIdx = new Map<string, number>();
  for (let i = 0; i < work.length; i++) {
    for (const eid of work[i].memberEntityIds) entityToIdx.set(eid, i);
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

      for (const eid of work[i].memberEntityIds) {
        if (!graph.hasNode(eid)) continue;
        graph.forEachNeighbor(eid, (neighbor) => {
          const idx = entityToIdx.get(neighbor);
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

      work[bestIdx].memberEntityIds.push(...work[i].memberEntityIds);
      for (const eid of work[i].memberEntityIds) entityToIdx.set(eid, bestIdx);
      work[i].memberEntityIds = [];
      syncFileIds(work[bestIdx], ctx);
      syncFileIds(work[i], ctx);
      merged.add(i);
      changed = true;
    }
  }

  return work
    .filter((_, idx) => !merged.has(idx))
    .map((c, i) => ({ ...c, id: `community-${i}` }));
}

// ── Cycle elimination ────────────────────────────────────────────────────

/**
 * Merge communities that have bidirectional (cyclic) dependencies.
 * Cross-cluster edges must be unidirectional. If A → B and B → A both exist,
 * those communities are too tightly coupled and must become one cluster.
 *
 * Uses union-find to transitively merge all communities in the same cycle,
 * then collapses strongly-connected components into single communities.
 */
function mergeCyclicCommunities(
  communities: Community[],
  edges: WeightedEdge[],
  ctx: EntityCtx,
): Community[] {
  if (communities.length < 2) return communities;

  const fileToCommunity = new Map<string, string>();
  for (const c of communities) {
    for (const fid of c.memberFileIds) fileToCommunity.set(fid, c.id);
  }

  const directedEdges = new Set<string>();
  for (const edge of edges) {
    const src = fileToCommunity.get(edge.sourceFileId);
    const tgt = fileToCommunity.get(edge.targetFileId);
    if (!src || !tgt || src === tgt) continue;
    directedEdges.add(`${src}\0${tgt}`);
  }

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

  let hasCycles = false;
  for (const key of directedEdges) {
    const [a, b] = key.split('\0');
    if (directedEdges.has(`${b}\0${a}`)) {
      union(a, b);
      hasCycles = true;
    }
  }

  if (!hasCycles) return communities;

  const groups = new Map<string, Community[]>();
  for (const c of communities) {
    const root = find(c.id);
    const list = groups.get(root) ?? [];
    list.push(c);
    groups.set(root, list);
  }

  const result: Community[] = [];
  for (const members of groups.values()) {
    if (members.length === 1) {
      result.push(members[0]);
    } else {
      const merged: string[] = [];
      for (const c of members) merged.push(...c.memberEntityIds);
      result.push(makeCommunity('', merged, ctx));
    }
  }

  return result.map((c, i) => ({ ...c, id: `community-${i}` }));
}

// ── Split file detection ────────────────────────────────────────────────

/**
 * Find files whose entities are spread across multiple communities.
 * These are candidates for restructuring — the file contains concerns
 * that belong to different architectural clusters.
 */
function detectSplitFiles(
  communities: Community[],
  ctx: EntityCtx,
): SplitFileCandidate[] {
  // Build entity → community mapping from final community assignments
  const entityToCommunity = new Map<string, string>();
  for (const c of communities) {
    for (const eid of c.memberEntityIds) entityToCommunity.set(eid, c.id);
  }

  // For each file, check if its entities are in multiple communities
  const candidates: SplitFileCandidate[] = [];
  for (const [fileId, entityIds] of ctx.fileEntities) {
    if (entityIds.length < 2) continue;

    const communityBreakdown = new Map<string, { count: number; loc: number }>();
    for (const eid of entityIds) {
      const cid = entityToCommunity.get(eid);
      if (!cid) continue;
      const entry = communityBreakdown.get(cid) ?? { count: 0, loc: 0 };
      entry.count++;
      entry.loc += ctx.entityLoc.get(eid) ?? 0;
      communityBreakdown.set(cid, entry);
    }

    if (communityBreakdown.size < 2) continue;

    const totalEntityLoc = entityIds.reduce((s, eid) => s + (ctx.entityLoc.get(eid) ?? 0), 0);
    candidates.push({
      fileId,
      filePath: ctx.filePath.get(fileId) ?? fileId,
      communityCount: communityBreakdown.size,
      communityBreakdown: [...communityBreakdown.entries()]
        .map(([communityId, { count, loc }]) => ({ communityId, entityCount: count, entityLoc: loc }))
        .sort((a, b) => b.entityLoc - a.entityLoc),
      totalEntityLoc,
    });
  }

  return candidates.sort((a, b) => b.communityCount - a.communityCount || b.totalEntityLoc - a.totalEntityLoc);
}

// ── Cross-package splitting ─────────────────────────────────────────────

/**
 * Split communities that span multiple packages into per-package
 * sub-communities. This ensures CommunityGroups stay package-aligned.
 */
function splitCrossPackageCommunities(
  communities: Community[],
  ctx: EntityCtx,
): Community[] {
  const result: Community[] = [];
  let nextId = communities.length;

  for (const community of communities) {
    // Group entities by package
    const byPkg = new Map<string, string[]>();
    for (const eid of community.memberEntityIds) {
      const path = ctx.entityToPath.get(eid) ?? '';
      const pkg = path.replace(/\\/g, '/').split('/')[1] ?? '';
      const list = byPkg.get(pkg) ?? [];
      list.push(eid);
      byPkg.set(pkg, list);
    }

    if (byPkg.size <= 1) {
      result.push(community);
      continue;
    }

    // Split into per-package sub-communities
    for (const [, entities] of byPkg) {
      if (entities.length === 0) continue;
      result.push(makeCommunity(`community-${nextId++}`, entities, ctx));
    }
  }

  return result.map((c, i) => ({ ...c, id: `community-${i}` }));
}

function annotateCommunities(
  communities: Community[],
  pathMap: Map<string, string>,
  locMap: Map<string, number>,
  roleMap: Map<string, CodeContentRole | undefined>,
): Community[] {
  const annotated = communities.map((community) => {
    const totalLoc = communityLoc(community, locMap);
    const tech = dominantTech(community, pathMap);
    const role = dominantRole(community, roleMap);
    return { ...community, totalLoc, dominantTechnology: tech, dominantRole: role };
  });

  // Build unique labels: tech-short · role · distinguishing subfolder
  const labels = annotated.map((c) => buildCommunityLabel(c, pathMap));

  // Disambiguate duplicates by appending a counter
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (let i = 0; i < annotated.length; i++) {
    const base = labels[i];
    if (counts.get(base)! > 1) {
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      annotated[i].label = `${base} #${n}`;
    } else {
      annotated[i].label = base;
    }
  }

  return annotated;
}

/** Build a human-readable label for a community from its files. */
function buildCommunityLabel(
  community: Community & { dominantTechnology?: string; dominantRole?: CodeContentRole },
  pathMap: Map<string, string>,
): string {
  const tech = community.dominantTechnology ?? '';
  const role = community.dominantRole;

  // Short tech: "packages/core" → "core", "analysis/structural" → "structural"
  const techShort = tech.split('/').pop() ?? tech;

  // Find the most common subfolder beyond the package root (e.g. "hooks", "components")
  const subfolderCounts = new Map<string, number>();
  for (const fid of community.memberFileIds) {
    const fp = (pathMap.get(fid) ?? fid).replace(/\\/g, '/');
    const parts = fp.split('/');
    // Look for the first meaningful subfolder after "src/"
    const srcIdx = parts.indexOf('src');
    const subIdx = srcIdx >= 0 ? srcIdx + 1 : 3;
    if (parts.length > subIdx + 1) {
      const sub = parts[subIdx];
      subfolderCounts.set(sub, (subfolderCounts.get(sub) ?? 0) + 1);
    }
  }
  const topSub = [...subfolderCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  const segments = [techShort];
  if (role && role !== 'unknown') segments.push(role);
  if (topSub) segments.push(topSub);

  return segments.join(' · ') || 'group';
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

function computeCommunityGroupExposure(
  communityGroups: CommunityGroup[],
  communities: Community[],
  edges: WeightedEdge[],
  locMap: Map<string, number>,
): ClusterExposure[] {
  const communityById = new Map(communities.map((c) => [c.id, c]));
  const fileToCommunity = new Map<string, string>();
  for (const c of communities) for (const fid of c.memberFileIds) fileToCommunity.set(fid, c.id);

  const results: ClusterExposure[] = [];
  const walk = (cluster: CommunityGroup) => {
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
      if (child.kind === 'communityGroup') walk(child.cluster);
    }
  };
  for (const cluster of communityGroups) walk(cluster);
  return results;
}

function applyExposureToCommunities(communities: Community[], exposure: ClusterExposure[]): void {
  const map = new Map(exposure.map((e) => [e.clusterId, e.exposureRatio]));
  for (const c of communities) c.exposureRatio = map.get(c.id) ?? 0;
}

function applyExposureToCommunityGroups(communityGroups: CommunityGroup[], exposure: ClusterExposure[]): void {
  const map = new Map(exposure.map((e) => [e.clusterId, e.exposureRatio]));
  const visit = (s: CommunityGroup) => {
    s.exposureRatio = map.get(s.id) ?? 0;
    for (const child of s.children) {
      if (child.kind === 'communityGroup') visit(child.cluster);
    }
  };
  for (const s of communityGroups) visit(s);
}

function collectCommunityIds(group: CommunityGroup): string[] {
  const ids: string[] = [];
  const walk = (s: CommunityGroup) => {
    for (const child of s.children) {
      if (child.kind === 'community') ids.push(child.communityId);
      else walk(child.cluster);
    }
  };
  walk(group);
  return ids;
}

// ── CommunityGroup detection ──────────────────────────────────────────────

function buildCommunityGroups(
  communities: Community[],
  edges: WeightedEdge[],
  roleMap: Map<string, CodeContentRole | undefined>,
  pathMap: Map<string, string>,
  locMap: Map<string, number>,
): CommunityGroup[] {
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

  // Phase 1: shared package scope — merge communities from the same package
  // directory. Contracts are meant to be shared across CommunityGroups, so we
  // do NOT merge on contract edges. Instead, same-package communities form
  // natural CommunityGroup seeds.
  const communityPkg = new Map<string, string>();
  for (const c of communities) {
    // Use the dominant package (top-level dir) of the community's files
    const pkgCounts = new Map<string, number>();
    for (const fid of c.memberFileIds) {
      const p = pathMap.get(fid)?.replace(/\\/g, '/').split('/')[1] ?? '';
      if (p) pkgCounts.set(p, (pkgCounts.get(p) ?? 0) + 1);
    }
    const dominant = [...pkgCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    communityPkg.set(c.id, dominant);
  }
  // Merge communities that share the same package
  for (const c of communities) {
    const pkg = communityPkg.get(c.id);
    if (!pkg) continue;
    for (const other of communities) {
      if (other.id === c.id) continue;
      if (communityPkg.get(other.id) === pkg) {
        union(c.id, other.id);
      }
    }
  }

  // Phase 2: minimize critical cross-CommunityGroup dependencies.
  // Aggregate edge weights between each community pair, separating contract
  // weight (cheap — shared contracts are OK) from critical weight (logic,
  // presentation, etc. — these should live inside the same CommunityGroup).
  const pairWeight = new Map<string, { contract: number; critical: number }>();
  for (const edge of edges) {
    const src = fileToCommunity.get(edge.sourceFileId);
    const tgt = fileToCommunity.get(edge.targetFileId);
    if (!src || !tgt || src === tgt) continue;
    if (find(src) === find(tgt)) continue; // already in the same group

    const key = src < tgt ? `${src}\0${tgt}` : `${tgt}\0${src}`;
    let pw = pairWeight.get(key);
    if (!pw) { pw = { contract: 0, critical: 0 }; pairWeight.set(key, pw); }

    const tgtRole = roleMap.get(edge.targetFileId);
    if (tgtRole === 'contract' || tgtRole === 'infrastructure' || tgtRole === 'barrel') {
      pw.contract += edge.weight;
    } else {
      pw.critical += edge.weight;
    }
  }

  // Merge pairs with significant critical coupling — only when the critical
  // weight exceeds a threshold. This prevents trivial cross-package imports
  // from merging unrelated CommunityGroups.
  const MIN_CRITICAL_WEIGHT_FOR_MERGE = 5;
  const sortedPairs = [...pairWeight.entries()]
    .filter(([, pw]) => pw.critical >= MIN_CRITICAL_WEIGHT_FOR_MERGE)
    .sort((a, b) => b[1].critical - a[1].critical);

  for (const [key, pw] of sortedPairs) {
    const [a, b] = key.split('\0');
    if (find(a) === find(b)) continue;
    // Only merge if they are in the same package already (from Phase 1)
    // or have very strong critical coupling
    const pkgA = communityPkg.get(a);
    const pkgB = communityPkg.get(b);
    if (pkgA === pkgB || pw.critical >= MIN_CRITICAL_WEIGHT_FOR_MERGE * 3) {
      union(a, b);
    }
  }

  // Phase 3: absorb remaining singletons.
  // After phases 1-2, singletons are communities with zero coupling to any
  // other community (or only contract-only coupling). Absorb non-contract
  // ones into the nearest group by total edge weight.
  let groups = new Map<string, string[]>();
  for (const c of communities) {
    const root = find(c.id);
    const list = groups.get(root) ?? [];
    list.push(c.id);
    groups.set(root, list);
  }

  const singletonIds = new Set<string>();
  const multiGroupRoots = new Set<string>();
  for (const [root, members] of groups) {
    if (members.length === 1) singletonIds.add(members[0]);
    else multiGroupRoots.add(root);
  }

  if (singletonIds.size > 0 && multiGroupRoots.size > 0) {
    // Compute total edge weight from each singleton to each multi-member group
    const weightToGroup = new Map<string, Map<string, number>>();
    for (const sid of singletonIds) weightToGroup.set(sid, new Map());

    for (const edge of edges) {
      const src = fileToCommunity.get(edge.sourceFileId);
      const tgt = fileToCommunity.get(edge.targetFileId);
      if (!src || !tgt || src === tgt) continue;

      let singleton: string | undefined;
      let other: string | undefined;
      if (singletonIds.has(src) && !singletonIds.has(tgt)) {
        singleton = src; other = tgt;
      } else if (singletonIds.has(tgt) && !singletonIds.has(src)) {
        singleton = tgt; other = src;
      }
      if (!singleton || !other) continue;

      const otherRoot = find(other);
      if (!multiGroupRoots.has(otherRoot)) continue;

      const wMap = weightToGroup.get(singleton)!;
      wMap.set(otherRoot, (wMap.get(otherRoot) ?? 0) + edge.weight);
    }

    for (const sid of [...singletonIds]) {
      const wMap = weightToGroup.get(sid)!;
      if (wMap.size === 0) continue;

      // Pick the group with the strongest total coupling
      let bestRoot: string | undefined;
      let bestWeight = 0;
      for (const [groupRoot, weight] of wMap) {
        if (weight > bestWeight) {
          bestWeight = weight;
          bestRoot = groupRoot;
        }
      }

      if (bestRoot) {
        groups.get(bestRoot)!.push(sid);
        const singletonRoot = find(sid);
        groups.delete(singletonRoot);
        union(sid, bestRoot);
        singletonIds.delete(sid);
      }
    }

    // Merge remaining connected singletons with each other
    if (singletonIds.size >= 2) {
      for (const edge of edges) {
        const src = fileToCommunity.get(edge.sourceFileId);
        const tgt = fileToCommunity.get(edge.targetFileId);
        if (!src || !tgt || src === tgt) continue;
        if (!singletonIds.has(src) || !singletonIds.has(tgt)) continue;
        if (communityById.get(src)?.dominantRole === 'contract'
          && communityById.get(tgt)?.dominantRole === 'contract') continue;
        union(src, tgt);
      }
      groups = new Map();
      for (const c of communities) {
        const root = find(c.id);
        const list = groups.get(root) ?? [];
        list.push(c.id);
        groups.set(root, list);
      }
    }
  }

  // Phase 4: merge undersized groups.
  // Singleton or tiny CommunityGroup groups are merged with the closest match
  // by technology and dominant-role affinity. This prevents dozens of tiny
  // CommunityGroups. Barrel/zero-LOC groups always merge into something.
  // Merging is NOT allowed to create new cross-boundary dependencies between
  // groups that had no coupling at all.
  groups = new Map();
  for (const c of communities) {
    const root = find(c.id);
    const list = groups.get(root) ?? [];
    list.push(c.id);
    groups.set(root, list);
  }

  const undersized = new Map<string, string[]>();  // root → communityIds
  const adequate = new Map<string, string[]>();
  for (const [root, members] of groups) {
    if (members.length < MIN_CommunityGroup_COMMUNITIES) undersized.set(root, members);
    else adequate.set(root, members);
  }

  if (undersized.size > 1) {
    // Compute the "technology prefix" for each group (most common top-level dir)
    // After cross-package splitting, each community belongs to exactly one package.
    // Phase 4 must NEVER merge communities from different packages.
    const groupPkg = (cids: string[]): string => {
      const counts = new Map<string, number>();
      for (const cid of cids) {
        const c = communityById.get(cid);
        if (!c) continue;
        for (const fid of c.memberFileIds) {
          const p = (pathMap.get(fid) ?? '').replace(/\\/g, '/').split('/')[1] ?? '';
          counts.set(p, (counts.get(p) ?? 0) + 1);
        }
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    };
    const groupTech = (cids: string[]): string => {
      const counts = new Map<string, number>();
      for (const cid of cids) {
        const tech = communityById.get(cid)?.dominantTechnology ?? '';
        // Normalize to top 2 directory segments for grouping affinity
        const prefix = tech.split('/').slice(0, 2).join('/');
        counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    };

    const groupRole = (cids: string[]): CodeContentRole | undefined => {
      const counts = new Map<string, number>();
      for (const cid of cids) {
        const role = communityById.get(cid)?.dominantRole;
        if (role) counts.set(role, (counts.get(role) ?? 0) + 1);
      }
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as CodeContentRole | undefined;
    };

    // Check if any edges exist between two groups
    const groupFileSets = new Map<string, Set<string>>();
    for (const [root, cids] of [...undersized, ...adequate]) {
      const files = new Set<string>();
      for (const cid of cids) {
        const c = communityById.get(cid);
        if (c) for (const fid of c.memberFileIds) files.add(fid);
      }
      groupFileSets.set(root, files);
    }

    const hasEdgeBetween = (rootA: string, rootB: string): boolean => {
      const filesA = groupFileSets.get(rootA);
      const filesB = groupFileSets.get(rootB);
      if (!filesA || !filesB) return false;
      for (const edge of edges) {
        if ((filesA.has(edge.sourceFileId) && filesB.has(edge.targetFileId)) ||
            (filesB.has(edge.sourceFileId) && filesA.has(edge.targetFileId))) {
          return true;
        }
      }
      return false;
    };

    // 1. Try to merge each undersized group into an adequate group with
    //    matching tech AND existing edge coupling.
    const mergedRoots = new Set<string>();
    for (const [uRoot, uMembers] of [...undersized]) {
      if (mergedRoots.has(uRoot)) continue;
      const uTech = groupTech(uMembers);
      const uRole = groupRole(uMembers);
      const uPkg = groupPkg(uMembers);

      let bestTarget: string | undefined;
      let bestScore = -1;

      // Prefer adequate groups first, then other undersized
      const candidates = [...adequate, ...undersized].filter(([r]) => r !== uRoot && !mergedRoots.has(r));
      for (const [cRoot, cMembers] of candidates) {
        // Never merge communities from different packages
        const cPkg = groupPkg(cMembers);
        if (uPkg && cPkg && uPkg !== cPkg) continue;

        const cTech = groupTech(cMembers);
        const cRole = groupRole(cMembers);

        // Technology affinity: same tech prefix = strong signal
        let score = 0;
        if (uTech && cTech && uTech === cTech) score += 10;
        // Role affinity: same dominant role = secondary signal
        if (uRole && cRole && uRole === cRole) score += 3;
        // Barrel/infrastructure singletons can merge into same tech even without edges
        const isBarrelLike = uRole === 'barrel' || uRole === 'infrastructure';
        // Edge coupling: required unless barrel-like merging into same tech
        const hasEdge = hasEdgeBetween(uRoot, cRoot);
        if (hasEdge) score += 5;
        else if (!isBarrelLike || uTech !== cTech) continue; // no coupling and not barrel → skip

        if (score > bestScore) {
          bestScore = score;
          bestTarget = cRoot;
        }
      }

      if (bestTarget) {
        // Merge undersized into target
        const targetMembers = adequate.get(bestTarget) ?? undersized.get(bestTarget) ?? [];
        for (const cid of uMembers) {
          targetMembers.push(cid);
          union(cid, bestTarget);
        }
        if (adequate.has(bestTarget)) adequate.set(bestTarget, targetMembers);
        else {
          // Two undersized merged → might now be adequate
          undersized.delete(bestTarget);
          adequate.set(bestTarget, targetMembers);
        }
        undersized.delete(uRoot);
        mergedRoots.add(uRoot);
        // Update file set for the merged group
        const uFiles = groupFileSets.get(uRoot)!;
        const tFiles = groupFileSets.get(bestTarget)!;
        for (const f of uFiles) tFiles.add(f);
      }
    }

    // 2. Any remaining undersized groups: merge by technology prefix alone
    //    (no edge required — these are isolated utilities/barrels).
    //    Constrained to same package.
    const remainingUndersized = [...undersized].filter(([r]) => !mergedRoots.has(r));
    if (remainingUndersized.length >= 2) {
      const byTechPkg = new Map<string, string[]>();
      for (const [root, members] of remainingUndersized) {
        const tech = groupTech(members);
        const pkg = groupPkg(members);
        const key = `${pkg}:${tech}`;
        const list = byTechPkg.get(key) ?? [];
        list.push(root);
        byTechPkg.set(key, list);
      }

      for (const roots of byTechPkg.values()) {
        if (roots.length < 2) continue;
        const target = roots[0];
        for (let i = 1; i < roots.length; i++) {
          const members = undersized.get(roots[i]) ?? [];
          for (const cid of members) union(cid, target);
          mergedRoots.add(roots[i]);
        }
      }
    }

    // 3. Group remaining isolated singletons by dominant role.
    //    Barrel-only or contract-only singletons with different tech prefixes
    //    are still safe to group IF they belong to the same package.
    const stillUndersized = [...undersized].filter(([r]) => !mergedRoots.has(r));
    if (stillUndersized.length >= 2) {
      const byRolePkg = new Map<string, string[]>();
      for (const [root, members] of stillUndersized) {
        const role = groupRole(members) ?? 'unknown';
        const pkg = groupPkg(members);
        const key = `${pkg}:${role}`;
        const list = byRolePkg.get(key) ?? [];
        list.push(root);
        byRolePkg.set(key, list);
      }

      for (const roots of byRolePkg.values()) {
        if (roots.length < 2) continue;
        const target = roots[0];
        for (let i = 1; i < roots.length; i++) {
          const members = undersized.get(roots[i]) ?? [];
          for (const cid of members) union(cid, target);
          mergedRoots.add(roots[i]);
        }
      }
    }

    // Rebuild groups after Phase 4
    groups = new Map();
    for (const c of communities) {
      const root = find(c.id);
      const list = groups.get(root) ?? [];
      list.push(c.id);
      groups.set(root, list);
    }
  }
  let nextId = 0;
  const nextSuperId = () => `CommunityGroup-${nextId++}`;

  const roots: CommunityGroup[] = [...groups.values()]
    .map((cids) => buildCommunityGroupRecursive(cids.sort(), 0))
    .filter((s): s is CommunityGroup => s != null);

  return roots;

  function buildCommunityGroupRecursive(communityIds: string[], depth: number): CommunityGroup | null {
    if (communityIds.length === 0) return null;
    const sharedContractFileIds = findSharedContractFiles(communityIds);
    const sharedContractLoc = sumLoc(sharedContractFileIds);
    const totalFiles = communityIds.reduce((s, id) => s + (communityById.get(id)?.memberFileIds.length ?? 0), 0);
    const dominantTechnology = dominantTech(communityIds);
    const dominantRole = dominantSharedRole(sharedContractFileIds);

    const withinCaps = communityIds.length <= MAX_CommunityGroup_CHILDREN && sharedContractLoc <= MAX_CommunityGroup_SHARED_LOC;
    let children: CommunityGroupChild[] = [];

    if (withinCaps || depth >= 5) {
      children = communityIds.map((communityId) => ({ kind: 'community', communityId }));
    } else {
      const partitions = splitCommunityIds(communityIds, sharedContractLoc);
      for (const part of partitions) {
        if (part.length === 1) {
          children.push({ kind: 'community', communityId: part[0] });
          continue;
        }
        const child = buildCommunityGroupRecursive(part, depth + 1);
        if (child) children.push({ kind: 'communityGroup', cluster: child });
      }
      if (children.length === 1 && children[0].kind === 'communityGroup') {
        return children[0].cluster;
      }
    }

    return {
      id: nextSuperId(),
      label: buildGroupLabel(communityIds),
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
      Math.ceil(sorted.length / MAX_CommunityGroup_CHILDREN),
      Math.ceil(sharedLoc / MAX_CommunityGroup_SHARED_LOC),
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

  /** Folder-based label for a community group — same logic as community labels. */
  function buildGroupLabel(communityIds: string[]): string {
    // Collect all member files across communities
    const allFileIds: string[] = [];
    for (const cid of communityIds) {
      const c = communityById.get(cid);
      if (c) allFileIds.push(...c.memberFileIds);
    }
    if (allFileIds.length === 0) return 'group';

    // Package prefix (most common top-level dir)
    const pkgCounts = new Map<string, number>();
    for (const fid of allFileIds) {
      const p = pathMap.get(fid)?.replace(/\\/g, '/');
      if (!p) continue;
      const pkg = packagePrefix(p);
      if (pkg) pkgCounts.set(pkg, (pkgCounts.get(pkg) ?? 0) + 1);
    }
    const topPkg = [...pkgCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
    const pkgShort = topPkg.split('/').pop() ?? topPkg;

    // Most common subfolder after src/
    const subCounts = new Map<string, number>();
    for (const fid of allFileIds) {
      const fp = (pathMap.get(fid) ?? fid).replace(/\\/g, '/');
      const parts = fp.split('/');
      const srcIdx = parts.indexOf('src');
      const subIdx = srcIdx >= 0 ? srcIdx + 1 : 3;
      if (parts.length > subIdx + 1) {
        subCounts.set(parts[subIdx], (subCounts.get(parts[subIdx]) ?? 0) + 1);
      }
    }
    const topSub = [...subCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    // Dominant role across all files
    const roleCounts = new Map<string, number>();
    for (const fid of allFileIds) {
      const r = roleMap.get(fid);
      if (r && r !== 'unknown') roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
    }
    const topRole = [...roleCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    const segments = [pkgShort];
    if (topRole) segments.push(topRole);
    if (topSub) segments.push(topSub);
    return segments.join(' · ') || 'group';
  }
}

// ── CommunityGroup cycle elimination ──────────────────────────────────────

/**
 * Detect and eliminate cycles between CommunityGroups.
 * Uses Tarjan's SCC algorithm on the directed inter-CommunityGroup dependency
 * graph. CommunityGroups in the same SCC are merged.
 */
function mergeCyclicCommunityGroups(
  communityGroups: CommunityGroup[],
  communities: Community[],
  edges: WeightedEdge[],
  roleMap: Map<string, CodeContentRole | undefined>,
): CommunityGroup[] {
  if (communityGroups.length < 2) return communityGroups;

  // Build file → CommunityGroup id mapping
  const fileToSc = new Map<string, string>();
  const collectFiles = (sc: CommunityGroup) => {
    for (const child of sc.children) {
      if (child.kind === 'community') {
        const comm = communities.find((c) => c.id === child.communityId);
        if (comm) for (const fid of comm.memberFileIds) fileToSc.set(fid, sc.id);
      } else {
        // Nested CommunityGroups map to the root CommunityGroup for cycle purposes
        const collectNested = (nested: CommunityGroup) => {
          for (const nc of nested.children) {
            if (nc.kind === 'community') {
              const comm = communities.find((c) => c.id === nc.communityId);
              if (comm) for (const fid of comm.memberFileIds) fileToSc.set(fid, sc.id);
            } else {
              collectNested(nc.cluster);
            }
          }
        };
        collectNested(child.cluster);
      }
    }
  };
  for (const sc of communityGroups) collectFiles(sc);

  // Build directed adjacency between CommunityGroups.
  // Only consider non-contract, non-type-only edges — contract imports across
  // CommunityGroups are expected and should not trigger cycle merging.
  const scIds = communityGroups.map((sc) => sc.id);
  const adj = new Map<string, Set<string>>();
  for (const id of scIds) adj.set(id, new Set());
  for (const edge of edges) {
    if (edge.isTypeOnly) continue;
    const src = fileToSc.get(edge.sourceFileId);
    const tgt = fileToSc.get(edge.targetFileId);
    if (!src || !tgt || src === tgt) continue;
    const tgtRole = roleMap.get(edge.targetFileId);
    if (tgtRole === 'contract' || tgtRole === 'infrastructure' || tgtRole === 'barrel') continue;
    adj.get(src)!.add(tgt);
  }

  // Tarjan's SCC
  let index = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strongconnect = (v: string) => {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      sccs.push(component);
    }
  };

  for (const id of scIds) {
    if (!indices.has(id)) strongconnect(id);
  }

  // Check if any SCC has more than one CommunityGroup (i.e., cycle exists)
  const hasCycle = sccs.some((scc) => scc.length > 1);
  if (!hasCycle) return communityGroups;

  // Merge CommunityGroups in the same SCC
  const scById = new Map<string, CommunityGroup>();
  for (const sc of communityGroups) scById.set(sc.id, sc);

  const result: CommunityGroup[] = [];
  for (const scc of sccs) {
    if (scc.length === 1) {
      result.push(scById.get(scc[0])!);
    } else {
      // Merge all children into a single CommunityGroup
      const children: CommunityGroupChild[] = [];
      let sharedContractLoc = 0;
      const sharedContractFileIds: string[] = [];
      let totalFiles = 0;
      for (const id of scc) {
        const sc = scById.get(id)!;
        children.push(...sc.children);
        sharedContractLoc += sc.sharedContractLoc;
        sharedContractFileIds.push(...sc.sharedContractFileIds);
        totalFiles += sc.totalFiles;
      }
      result.push({
        id: scc.sort().join('+'),
        label: `merged (cycle eliminated)`,
        sharedContractLoc,
        sharedContractFileIds: [...new Set(sharedContractFileIds)].sort(),
        totalFiles,
        dominantTechnology: scById.get(scc[0])!.dominantTechnology,
        dominantRole: scById.get(scc[0])!.dominantRole,
        coordinatorScope: 'merged scope (cyclic dependency eliminated)',
        children,
      });
    }
  }

  return result;
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
