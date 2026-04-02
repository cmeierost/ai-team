import { describe, it, expect } from 'vitest';
import type { Entity, Relationship } from '@aspect/contracts';
import type { Grouping } from './grouping.js';
import type { CodeRoleClassification } from './code-roles.js';
import { calculateGroupCoupling } from './group-coupling.js';

// ── Test helpers ────────────────────────────────────────────────────────

function entity(id: string, filePath: string): Entity {
  return {
    id,
    kind: 'file',
    name: filePath.split('/').pop()!,
    filePath,
    sourceRange: { startLine: 1, startColumn: 0, endLine: 50, endColumn: 0 },
    classification: {
      isAbstract: false,
      isInterface: false,
      isConcrete: true,
      isTypeOnly: false,
      isExported: true,
      visibility: 'public',
    },
  } as Entity;
}

function rel(
  source: string,
  target: string,
  overrides?: Partial<Relationship>,
): Relationship {
  return {
    sourceEntityId: source,
    targetEntityId: target,
    kind: 'import',
    sourceRange: { startLine: 1, startColumn: 0, endLine: 1, endColumn: 20 },
    targetClassification: 'concrete',
    targetIsAbstraction: false,
    crossModule: false,
    crossPackage: false,
    thirdParty: false,
    typeOnly: false,
    dynamic: false,
    ...overrides,
  } as Relationship;
}

function grouping(
  groups: Array<{ id: string; label: string; memberEntityIds: string[] }>,
): Grouping {
  return {
    id: 'test-grouping',
    label: 'Test Grouping',
    kind: 'custom',
    groups,
  };
}

function roleClassification(
  entityId: string,
  role: CodeRoleClassification['role'],
): CodeRoleClassification {
  return {
    entityId,
    filePath: `${entityId}.ts`,
    role,
    confidence: 0.9,
    signals: [],
  };
}

// ── Fixtures ────────────────────────────────────────────────────────────

/**
 * 3 groups with clear coupling patterns:
 *   A (utility): a1, a2
 *   B (business_logic): b1, b2, b3
 *   C (contracts): c1, c2
 *
 * Edges:
 *   B→C type-only (b1→c1, b2→c2)
 *   B→A value     (b1→a1, b3→a2)
 *   A→C mixed     (a1→c1 type-only, a2→c2 value)
 *   Internal B    (b1→b2, b2→b3)
 */
function threeGroupFixture() {
  const entities = [
    entity('a1', 'lib/helpers.ts'),
    entity('a2', 'lib/format.ts'),
    entity('b1', 'app/service.ts'),
    entity('b2', 'app/handler.ts'),
    entity('b3', 'app/worker.ts'),
    entity('c1', 'types/models.ts'),
    entity('c2', 'types/events.ts'),
  ];

  const g = grouping([
    { id: 'grpA', label: 'Utility', memberEntityIds: ['a1', 'a2'] },
    { id: 'grpB', label: 'Business', memberEntityIds: ['b1', 'b2', 'b3'] },
    { id: 'grpC', label: 'Contracts', memberEntityIds: ['c1', 'c2'] },
  ]);

  const relationships = [
    // B→C type-only
    rel('b1', 'c1', { typeOnly: true }),
    rel('b2', 'c2', { typeOnly: true }),
    // B→A value
    rel('b1', 'a1'),
    rel('b3', 'a2'),
    // A→C mixed
    rel('a1', 'c1', { typeOnly: true }),
    rel('a2', 'c2'),
    // Internal B
    rel('b1', 'b2'),
    rel('b2', 'b3'),
  ];

  const codeRoles: CodeRoleClassification[] = [
    roleClassification('a1', 'utility'),
    roleClassification('a2', 'utility'),
    roleClassification('b1', 'business_logic'),
    roleClassification('b2', 'business_logic'),
    roleClassification('b3', 'business_logic'),
    roleClassification('c1', 'contract'),
    roleClassification('c2', 'contract'),
  ];

  return { entities, grouping: g, relationships, codeRoles };
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('calculateGroupCoupling', () => {
  // ── Pair coupling tests ─────────────────────────────────────────────

  describe('pair couplings', () => {
    it('counts edges between groups correctly', () => {
      const { entities, grouping: g, relationships, codeRoles } = threeGroupFixture();
      const result = calculateGroupCoupling(g, entities, relationships, { codeRoles });

      const bc = result.pairCouplings.find(
        (p) => p.sourceGroupId === 'grpB' && p.targetGroupId === 'grpC',
      );
      expect(bc).toBeDefined();
      expect(bc!.totalEdges).toBe(2);
      expect(bc!.typeOnlyEdges).toBe(2);
      expect(bc!.valueEdges).toBe(0);
    });

    it('detects contract-mediated edges using code roles', () => {
      const { entities, grouping: g, relationships, codeRoles } = threeGroupFixture();
      const result = calculateGroupCoupling(g, entities, relationships, { codeRoles });

      // B→C: targets c1 and c2 are contracts
      const bc = result.pairCouplings.find(
        (p) => p.sourceGroupId === 'grpB' && p.targetGroupId === 'grpC',
      );
      expect(bc!.contractMediatedEdges).toBe(2);
      expect(bc!.contractRatio).toBe(1);

      // B→A: targets a1 and a2 are utilities (not contracts)
      const ba = result.pairCouplings.find(
        (p) => p.sourceGroupId === 'grpB' && p.targetGroupId === 'grpA',
      );
      expect(ba!.contractMediatedEdges).toBe(0);
      expect(ba!.contractRatio).toBe(0);
    });

    it('classifies mixed type-only and value edges for A→C', () => {
      const { entities, grouping: g, relationships, codeRoles } = threeGroupFixture();
      const result = calculateGroupCoupling(g, entities, relationships, { codeRoles });

      const ac = result.pairCouplings.find(
        (p) => p.sourceGroupId === 'grpA' && p.targetGroupId === 'grpC',
      );
      expect(ac).toBeDefined();
      expect(ac!.totalEdges).toBe(2);
      expect(ac!.typeOnlyEdges).toBe(1);
      expect(ac!.valueEdges).toBe(1);
      expect(ac!.contractRatio).toBe(1); // both targets are contracts
    });

    it('records individual edge details for traceability', () => {
      const { entities, grouping: g, relationships, codeRoles } = threeGroupFixture();
      const result = calculateGroupCoupling(g, entities, relationships, { codeRoles });

      const ba = result.pairCouplings.find(
        (p) => p.sourceGroupId === 'grpB' && p.targetGroupId === 'grpA',
      );
      expect(ba!.edges).toHaveLength(2);
      expect(ba!.edges.map((e) => e.sourceEntityId).sort()).toEqual(['b1', 'b3']);
      expect(ba!.edges.every((e) => e.targetRole === 'utility')).toBe(true);
    });
  });

  // ── Profile tests ───────────────────────────────────────────────────

  describe('profiles', () => {
    it('computes internal cohesion for group B', () => {
      const { entities, grouping: g, relationships, codeRoles } = threeGroupFixture();
      const result = calculateGroupCoupling(g, entities, relationships, { codeRoles });

      const profileB = result.profiles.find((p) => p.groupId === 'grpB')!;
      // B has 2 internal edges, 4 outbound (2→C, 2→A), 0 inbound
      expect(profileB.internalEdges).toBe(2);
      expect(profileB.outboundEdges).toBe(4);
      expect(profileB.inboundEdges).toBe(0);
      expect(profileB.internalCohesion).toBeCloseTo(2 / 6);
    });

    it('computes outbound/inbound group counts', () => {
      const { entities, grouping: g, relationships, codeRoles } = threeGroupFixture();
      const result = calculateGroupCoupling(g, entities, relationships, { codeRoles });

      const profileB = result.profiles.find((p) => p.groupId === 'grpB')!;
      expect(profileB.outboundGroupCount).toBe(2); // depends on A and C
      expect(profileB.inboundGroupCount).toBe(0);

      const profileC = result.profiles.find((p) => p.groupId === 'grpC')!;
      expect(profileC.inboundGroupCount).toBe(2); // B and A depend on C
      expect(profileC.outboundGroupCount).toBe(0);
    });

    it('computes API surface from inbound cross-group edges', () => {
      const { entities, grouping: g, relationships, codeRoles } = threeGroupFixture();
      const result = calculateGroupCoupling(g, entities, relationships, { codeRoles });

      const profileA = result.profiles.find((p) => p.groupId === 'grpA')!;
      // a1 imported by b1, a2 imported by b3 → apiSurfaceSize = 2, members = 2
      expect(profileA.apiSurfaceSize).toBe(2);
      expect(profileA.apiSurfaceRatio).toBe(1);

      const profileC = result.profiles.find((p) => p.groupId === 'grpC')!;
      // c1 imported by b1, a1; c2 imported by b2, a2 → apiSurfaceSize = 2
      expect(profileC.apiSurfaceSize).toBe(2);
      expect(profileC.apiSurfaceRatio).toBe(1);
    });

    it('computes type-only ratios for outbound and inbound edges', () => {
      const { entities, grouping: g, relationships, codeRoles } = threeGroupFixture();
      const result = calculateGroupCoupling(g, entities, relationships, { codeRoles });

      const profileB = result.profiles.find((p) => p.groupId === 'grpB')!;
      // B outbound: 2 type-only (→C) + 2 value (→A) = 4 total
      expect(profileB.outboundTypeOnlyRatio).toBeCloseTo(0.5);

      const profileC = result.profiles.find((p) => p.groupId === 'grpC')!;
      // C inbound: from B (2 type-only) + from A (1 type-only, 1 value) = 3 type-only / 4 total
      expect(profileC.inboundTypeOnlyRatio).toBeCloseTo(0.75);
    });

    it('computes separability index', () => {
      const { entities, grouping: g, relationships, codeRoles } = threeGroupFixture();
      const result = calculateGroupCoupling(g, entities, relationships, { codeRoles });

      // All groups should have separabilityIndex between 0 and 1
      for (const profile of result.profiles) {
        expect(profile.separabilityIndex).toBeGreaterThanOrEqual(0);
        expect(profile.separabilityIndex).toBeLessThanOrEqual(1);
      }
    });
  });

  // ── Isolated group (separabilityIndex ≈ 1.0) ───────────────────────

  describe('isolated group', () => {
    it('has separabilityIndex of 1.0 when there are no cross-group edges but has internal edges', () => {
      const entities = [
        entity('d1', 'isolated/a.ts'),
        entity('d2', 'isolated/b.ts'),
        entity('d3', 'isolated/c.ts'),
      ];
      const g = grouping([
        { id: 'grpD', label: 'Isolated', memberEntityIds: ['d1', 'd2', 'd3'] },
      ]);
      // Only internal edges
      const relationships = [rel('d1', 'd2'), rel('d2', 'd3')];

      const result = calculateGroupCoupling(g, entities, relationships);
      const profile = result.profiles.find((p) => p.groupId === 'grpD')!;

      expect(profile.internalEdges).toBe(2);
      expect(profile.outboundEdges).toBe(0);
      expect(profile.inboundEdges).toBe(0);
      // internalCohesion = 2/2 = 1, outboundDensity = 0, inboundContractRatio = 0
      // separability = 0.4 * 1 + 0.3 * (1 - 0) + 0.3 * 0 = 0.7
      expect(profile.separabilityIndex).toBeCloseTo(0.7);
    });

    it('has separabilityIndex of 0.3 with zero edges (no internal cohesion)', () => {
      const entities = [entity('d1', 'isolated/a.ts')];
      const g = grouping([
        { id: 'grpD', label: 'Isolated', memberEntityIds: ['d1'] },
      ]);

      const result = calculateGroupCoupling(g, entities, []);
      const profile = result.profiles.find((p) => p.groupId === 'grpD')!;

      // internalCohesion = 0, outboundDensity = 0, inboundContractRatio = 0
      // separability = 0.4 * 0 + 0.3 * 1 + 0.3 * 0 = 0.3
      expect(profile.separabilityIndex).toBeCloseTo(0.3);
    });
  });

  // ── Merge candidate tests ───────────────────────────────────────────

  describe('merge candidates', () => {
    it('flags tightly coupled groups as merge candidates', () => {
      const entities = [
        entity('e1', 'svc/auth.ts'),
        entity('e2', 'svc/session.ts'),
        entity('f1', 'svc/token.ts'),
        entity('f2', 'svc/crypto.ts'),
      ];
      const g = grouping([
        { id: 'grpE', label: 'Auth', memberEntityIds: ['e1', 'e2'] },
        { id: 'grpF', label: 'Token', memberEntityIds: ['f1', 'f2'] },
      ]);
      // Many cross-group edges, zero internal → high coupling density
      const relationships = [
        rel('e1', 'f1'),
        rel('e1', 'f2'),
        rel('e2', 'f1'),
        rel('f1', 'e1'),
        rel('f2', 'e2'),
      ];

      const result = calculateGroupCoupling(g, entities, relationships);

      expect(result.mergeCandidates).toHaveLength(1);
      const mc = result.mergeCandidates[0];
      expect(mc.groupIdA).toBe('grpE');
      expect(mc.groupIdB).toBe('grpF');
      expect(mc.bidirectionalEdges).toBe(5);
      expect(mc.combinedInternalEdges).toBe(0);
      // 5 / max(1, 0) = 5 > 0.5
      expect(mc.couplingDensity).toBe(5);
    });

    it('does not flag well-separated groups', () => {
      const entities = [
        entity('e1', 'svc/auth.ts'),
        entity('e2', 'svc/session.ts'),
        entity('f1', 'svc/token.ts'),
        entity('f2', 'svc/crypto.ts'),
      ];
      const g = grouping([
        { id: 'grpE', label: 'Auth', memberEntityIds: ['e1', 'e2'] },
        { id: 'grpF', label: 'Token', memberEntityIds: ['f1', 'f2'] },
      ]);
      // Many internal edges, few cross-group
      const relationships = [
        rel('e1', 'e2'),
        rel('e2', 'e1'),
        rel('e1', 'e2'),
        rel('f1', 'f2'),
        rel('f2', 'f1'),
        rel('f1', 'f2'),
        rel('e1', 'f1'), // only 1 cross-group
      ];

      const result = calculateGroupCoupling(g, entities, relationships);
      // 1 bidirectional edge / 6 combined internal = 0.167 < 0.5
      expect(result.mergeCandidates).toHaveLength(0);
    });

    it('respects custom merge threshold', () => {
      const entities = [
        entity('e1', 'svc/auth.ts'),
        entity('f1', 'svc/token.ts'),
      ];
      const g = grouping([
        { id: 'grpE', label: 'Auth', memberEntityIds: ['e1'] },
        { id: 'grpF', label: 'Token', memberEntityIds: ['f1'] },
      ]);
      // 1 cross-group edge, 0 internal → density = 1 / max(1,0) = 1
      const relationships = [rel('e1', 'f1')];

      // Default threshold (0.5) → should flag
      const result1 = calculateGroupCoupling(g, entities, relationships);
      expect(result1.mergeCandidates).toHaveLength(1);

      // Very high threshold → should not flag
      const result2 = calculateGroupCoupling(g, entities, relationships, {
        mergeCouplingThreshold: 2,
      });
      expect(result2.mergeCandidates).toHaveLength(0);
    });
  });

  // ── Matrix tests ────────────────────────────────────────────────────

  describe('coupling matrix', () => {
    it('builds correct total/typeOnly/value matrices', () => {
      const { entities, grouping: g, relationships, codeRoles } = threeGroupFixture();
      const result = calculateGroupCoupling(g, entities, relationships, { codeRoles });
      const { matrix } = result;

      expect(matrix.groupIds).toEqual(['grpA', 'grpB', 'grpC']);
      expect(matrix.groupLabels).toEqual(['Utility', 'Business', 'Contracts']);

      // A→C: 2 total (1 type-only, 1 value)
      const ai = 0;
      const ci = 2;
      expect(matrix.total[ai][ci]).toBe(2);
      expect(matrix.typeOnly[ai][ci]).toBe(1);
      expect(matrix.value[ai][ci]).toBe(1);

      // B→C: 2 total (2 type-only, 0 value)
      const bi = 1;
      expect(matrix.total[bi][ci]).toBe(2);
      expect(matrix.typeOnly[bi][ci]).toBe(2);
      expect(matrix.value[bi][ci]).toBe(0);

      // B→A: 2 total (0 type-only, 2 value)
      expect(matrix.total[bi][ai]).toBe(2);
      expect(matrix.typeOnly[bi][ai]).toBe(0);
      expect(matrix.value[bi][ai]).toBe(2);

      // No reverse edges (C→A, C→B, A→B)
      expect(matrix.total[ci][ai]).toBe(0);
      expect(matrix.total[ci][bi]).toBe(0);
      expect(matrix.total[ai][bi]).toBe(0);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns empty result for empty grouping', () => {
      const g = grouping([]);
      const result = calculateGroupCoupling(g, [], []);

      expect(result.pairCouplings).toEqual([]);
      expect(result.profiles).toEqual([]);
      expect(result.mergeCandidates).toEqual([]);
      expect(result.matrix.groupIds).toEqual([]);
      expect(result.matrix.total).toEqual([]);
    });

    it('handles single group with no cross-group edges', () => {
      const entities = [entity('x1', 'src/a.ts'), entity('x2', 'src/b.ts')];
      const g = grouping([
        { id: 'only', label: 'Only Group', memberEntityIds: ['x1', 'x2'] },
      ]);
      const relationships = [rel('x1', 'x2')];

      const result = calculateGroupCoupling(g, entities, relationships);

      expect(result.pairCouplings).toHaveLength(0);
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0].internalEdges).toBe(1);
      expect(result.profiles[0].outboundEdges).toBe(0);
      expect(result.mergeCandidates).toHaveLength(0);
    });

    it('handles no relationships', () => {
      const entities = [entity('x1', 'src/a.ts'), entity('x2', 'src/b.ts')];
      const g = grouping([
        { id: 'g1', label: 'G1', memberEntityIds: ['x1'] },
        { id: 'g2', label: 'G2', memberEntityIds: ['x2'] },
      ]);

      const result = calculateGroupCoupling(g, entities, []);

      expect(result.pairCouplings).toHaveLength(0);
      expect(result.profiles[0].internalCohesion).toBe(0);
      expect(result.profiles[1].internalCohesion).toBe(0);
      expect(result.mergeCandidates).toHaveLength(0);
    });

    it('skips relationships with entities not in any group', () => {
      const entities = [
        entity('x1', 'src/a.ts'),
        entity('x2', 'src/b.ts'),
        entity('orphan', 'src/orphan.ts'),
      ];
      const g = grouping([
        { id: 'g1', label: 'G1', memberEntityIds: ['x1'] },
        { id: 'g2', label: 'G2', memberEntityIds: ['x2'] },
      ]);
      const relationships = [
        rel('x1', 'x2'),
        rel('x1', 'orphan'), // orphan not in any group
        rel('orphan', 'x2'), // orphan not in any group
      ];

      const result = calculateGroupCoupling(g, entities, relationships);

      // Only x1→x2 should be counted
      expect(result.pairCouplings).toHaveLength(1);
      expect(result.pairCouplings[0].totalEdges).toBe(1);
    });

    it('works without code roles (all target roles default to unknown)', () => {
      const entities = [entity('x1', 'src/a.ts'), entity('x2', 'src/b.ts')];
      const g = grouping([
        { id: 'g1', label: 'G1', memberEntityIds: ['x1'] },
        { id: 'g2', label: 'G2', memberEntityIds: ['x2'] },
      ]);
      const relationships = [rel('x1', 'x2', { typeOnly: true })];

      const result = calculateGroupCoupling(g, entities, relationships);
      const pair = result.pairCouplings[0];

      expect(pair.contractMediatedEdges).toBe(0);
      expect(pair.edges[0].targetRole).toBe('unknown');
    });
  });

  // ── Integration: full three-group fixture ───────────────────────────

  describe('integration', () => {
    it('full three-group scenario produces consistent results', () => {
      const { entities, grouping: g, relationships, codeRoles } = threeGroupFixture();
      const result = calculateGroupCoupling(g, entities, relationships, { codeRoles });

      // Verify all groups have profiles
      expect(result.profiles).toHaveLength(3);

      // Verify matrix dimensions
      expect(result.matrix.groupIds).toHaveLength(3);
      expect(result.matrix.total).toHaveLength(3);
      expect(result.matrix.total[0]).toHaveLength(3);

      // Total cross-group edges from pairs should match matrix sums
      let matrixTotal = 0;
      for (const row of result.matrix.total) {
        for (const cell of row) matrixTotal += cell;
      }
      const pairTotal = result.pairCouplings.reduce((s, p) => s + p.totalEdges, 0);
      expect(matrixTotal).toBe(pairTotal);

      // typeOnly + value = total for every pair
      for (const pair of result.pairCouplings) {
        expect(pair.typeOnlyEdges + pair.valueEdges).toBe(pair.totalEdges);
      }

      // The three-group fixture has few internal edges relative to cross-group
      // edges, so merge candidates are expected. Verify they are consistent.
      for (const mc of result.mergeCandidates) {
        expect(mc.couplingDensity).toBeGreaterThan(0.5);
        expect(mc.bidirectionalEdges).toBeGreaterThan(0);
      }
    });
  });
});
