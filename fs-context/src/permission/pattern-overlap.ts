import type { PermissionRule, Right } from './types.js';
import { ALL_RIGHTS } from './types.js';
import { normalizeRelativePosixPath } from '../paths.js';

export type AgentRuleMap = Map<string, readonly PermissionRule[]>;

export interface SharedPatternOverlap {
  pattern: string;
  agentIds: string[];
  agentCount: number;
}

export interface AgentRightSummary {
  agentId: string;
  explicitAllowCount: number;
  explicitDenyCount: number;
  effectiveAllowCount: number;
  sharedAllowCount: number;
  sharedDenyCount: number;
}

export interface PairwiseAgentOverlap {
  agentA: string;
  agentB: string;
  sharedAllowPatterns: string[];
  sharedDenyPatterns: string[];
  agentAEffectiveAllowCount: number;
  agentBEffectiveAllowCount: number;
  unionAllowCount: number;
  overlapRatio: number;
}

export interface RightOverlapSummary {
  right: Right;
  totalDistinctAllowPatterns: number;
  totalDistinctDenyPatterns: number;
  sharedAllowPatterns: SharedPatternOverlap[];
  sharedDenyPatterns: SharedPatternOverlap[];
  agents: AgentRightSummary[];
  pairs: PairwiseAgentOverlap[];
}

export interface PermissionOverlapReport {
  generatedAt: string;
  agentIds: string[];
  rights: Record<Right, RightOverlapSummary>;
}

interface AgentPatternSets {
  explicitAllow: Record<Right, Set<string>>;
  explicitDeny: Record<Right, Set<string>>;
  effectiveAllow: Record<Right, Set<string>>;
}

function createRightRecord<T>(factory: () => T): Record<Right, T> {
  return {
    read: factory(),
    write: factory(),
    list: factory(),
  };
}

function normalizePattern(pattern: string): string {
  return normalizeRelativePosixPath(pattern.trim());
}

function collectAgentPatternSets(rules: readonly PermissionRule[]): AgentPatternSets {
  const explicitAllow = createRightRecord(() => new Set<string>());
  const explicitDeny = createRightRecord(() => new Set<string>());
  const effectiveAllow = createRightRecord(() => new Set<string>());

  for (const rule of rules) {
    const pattern = normalizePattern(rule.pathPattern);
    if (!pattern) {
      continue;
    }

    if (rule.effect === 'allow') {
      explicitAllow[rule.right].add(pattern);
      effectiveAllow[rule.right].add(pattern);

      if (rule.right === 'read') {
        effectiveAllow.list.add(pattern);
      }

      if (rule.right === 'write') {
        effectiveAllow.read.add(pattern);
        effectiveAllow.list.add(pattern);
      }
      continue;
    }

    explicitDeny[rule.right].add(pattern);
  }

  return { explicitAllow, explicitDeny, effectiveAllow };
}

function buildOwnershipMap(
  agentIds: readonly string[],
  setsByAgent: Map<string, AgentPatternSets>,
  right: Right,
  kind: 'effectiveAllow' | 'explicitDeny',
): Map<string, string[]> {
  const ownership = new Map<string, string[]>();

  for (const agentId of agentIds) {
    const sets = setsByAgent.get(agentId);
    if (!sets) {
      continue;
    }

    const patterns = sets[kind][right];
    for (const pattern of patterns) {
      const owners = ownership.get(pattern) ?? [];
      owners.push(agentId);
      ownership.set(pattern, owners);
    }
  }

  for (const owners of ownership.values()) {
    owners.sort((a, b) => a.localeCompare(b));
  }

  return ownership;
}

function toSharedPatternOverlaps(ownership: Map<string, string[]>): SharedPatternOverlap[] {
  return [...ownership.entries()]
    .filter(([, agentIds]) => agentIds.length > 1)
    .map(([pattern, agentIds]) => ({
      pattern,
      agentIds,
      agentCount: agentIds.length,
    }))
    .sort((a, b) =>
      b.agentCount - a.agentCount
      || a.pattern.localeCompare(b.pattern)
    );
}

function intersect(left: Set<string>, right: Set<string>): string[] {
  const shared = [...left].filter((pattern) => right.has(pattern));
  shared.sort((a, b) => a.localeCompare(b));
  return shared;
}

function unionSize(left: Set<string>, right: Set<string>): number {
  return new Set([...left, ...right]).size;
}

export function analyzePermOverlap(agentRules: AgentRuleMap): PermissionOverlapReport {
  const agentIds = [...agentRules.keys()].sort((a, b) => a.localeCompare(b));
  const setsByAgent = new Map<string, AgentPatternSets>();

  for (const [agentId, rules] of agentRules.entries()) {
    setsByAgent.set(agentId, collectAgentPatternSets(rules));
  }

  const rights = createRightRecord<RightOverlapSummary>(() => ({
    right: 'read',
    totalDistinctAllowPatterns: 0,
    totalDistinctDenyPatterns: 0,
    sharedAllowPatterns: [],
    sharedDenyPatterns: [],
    agents: [],
    pairs: [],
  }));

  for (const right of ALL_RIGHTS) {
    const allowOwnership = buildOwnershipMap(agentIds, setsByAgent, right, 'effectiveAllow');
    const denyOwnership = buildOwnershipMap(agentIds, setsByAgent, right, 'explicitDeny');
    const sharedAllowPatterns = toSharedPatternOverlaps(allowOwnership);
    const sharedDenyPatterns = toSharedPatternOverlaps(denyOwnership);

    const agents: AgentRightSummary[] = agentIds.map((agentId) => {
      const sets = setsByAgent.get(agentId)!;
      const effectiveAllow = sets.effectiveAllow[right];
      const explicitDeny = sets.explicitDeny[right];

      const sharedAllowCount = [...effectiveAllow].filter((pattern) => (allowOwnership.get(pattern)?.length ?? 0) > 1).length;
      const sharedDenyCount = [...explicitDeny].filter((pattern) => (denyOwnership.get(pattern)?.length ?? 0) > 1).length;

      return {
        agentId,
        explicitAllowCount: sets.explicitAllow[right].size,
        explicitDenyCount: explicitDeny.size,
        effectiveAllowCount: effectiveAllow.size,
        sharedAllowCount,
        sharedDenyCount,
      };
    });

    const pairs: PairwiseAgentOverlap[] = [];
    for (let index = 0; index < agentIds.length; index += 1) {
      const agentA = agentIds[index];
      const left = setsByAgent.get(agentA)!;

      for (let inner = index + 1; inner < agentIds.length; inner += 1) {
        const agentB = agentIds[inner];
        const rightSets = setsByAgent.get(agentB)!;
        const sharedAllowPatternsForPair = intersect(left.effectiveAllow[right], rightSets.effectiveAllow[right]);
        const sharedDenyPatternsForPair = intersect(left.explicitDeny[right], rightSets.explicitDeny[right]);

        const unionAllowCount = unionSize(left.effectiveAllow[right], rightSets.effectiveAllow[right]);
        const overlapRatio = unionAllowCount === 0
          ? 0
          : sharedAllowPatternsForPair.length / unionAllowCount;

        pairs.push({
          agentA,
          agentB,
          sharedAllowPatterns: sharedAllowPatternsForPair,
          sharedDenyPatterns: sharedDenyPatternsForPair,
          agentAEffectiveAllowCount: left.effectiveAllow[right].size,
          agentBEffectiveAllowCount: rightSets.effectiveAllow[right].size,
          unionAllowCount,
          overlapRatio,
        });
      }
    }

    pairs.sort((a, b) =>
      b.sharedAllowPatterns.length - a.sharedAllowPatterns.length
      || b.sharedDenyPatterns.length - a.sharedDenyPatterns.length
      || b.overlapRatio - a.overlapRatio
      || a.agentA.localeCompare(b.agentA)
      || a.agentB.localeCompare(b.agentB)
    );

    rights[right] = {
      right,
      totalDistinctAllowPatterns: allowOwnership.size,
      totalDistinctDenyPatterns: denyOwnership.size,
      sharedAllowPatterns,
      sharedDenyPatterns,
      agents,
      pairs,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    agentIds,
    rights,
  };
}
