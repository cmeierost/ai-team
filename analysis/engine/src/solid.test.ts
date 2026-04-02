import { describe, it, expect } from 'vitest';
import {
  calculateSolidIndicators,
  type Entity,
  type Relationship,
  type ModuleBoundary,
} from './solid.js';
import type { Lcom4Result } from './cohesion.js';

// ── Helpers ──

function entity(overrides: Partial<Entity> & { id: string }): Entity {
  return {
    kind: 'class',
    name: overrides.id,
    filePath: 'src/main.ts',
    ...overrides,
  };
}

// ── SRP Tests ──

describe('SRP indicator', () => {
  it('gives low SRP score for high LCOM class', () => {
    const entities: Entity[] = [entity({ id: 'cls1' })];
    const lcom4Results: Lcom4Result[] = [
      {
        entityId: 'cls1',
        lcom4: 5,
        cohesionGroups: [
          { methods: ['a'], sharedFields: [] },
          { methods: ['b'], sharedFields: [] },
          { methods: ['c'], sharedFields: [] },
          { methods: ['d'], sharedFields: [] },
          { methods: ['e'], sharedFields: [] },
        ],
      },
    ];

    const result = calculateSolidIndicators(entities, [], [], lcom4Results);

    expect(result.srp).toHaveLength(1);
    expect(result.srp[0].lcom4).toBe(5);
    expect(result.srp[0].srpScore).toBeLessThan(0.3);
  });

  it('gives high SRP score for cohesive class', () => {
    const entities: Entity[] = [entity({ id: 'cls1' })];
    const lcom4Results: Lcom4Result[] = [
      {
        entityId: 'cls1',
        lcom4: 1,
        cohesionGroups: [
          { methods: ['a', 'b', 'c'], sharedFields: ['field1'] },
        ],
      },
    ];

    const result = calculateSolidIndicators(entities, [], [], lcom4Results);

    expect(result.srp).toHaveLength(1);
    expect(result.srp[0].srpScore).toBe(1);
  });

  it('gives lower SRP score with high import diversity', () => {
    // Create entity and import targets in different files
    const entities: Entity[] = [
      entity({ id: 'cls1', filePath: 'src/main.ts' }),
      // Import targets in different files
      ...Array.from({ length: 20 }, (_, i) =>
        entity({ id: `dep${i}`, filePath: `src/dep${i}.ts` }),
      ),
    ];
    const relationships: Relationship[] = Array.from({ length: 20 }, (_, i) => ({
      sourceEntityId: 'cls1',
      targetEntityId: `dep${i}`,
      kind: 'import',
    }));
    const lcom4Results: Lcom4Result[] = [
      {
        entityId: 'cls1',
        lcom4: 1,
        cohesionGroups: [
          { methods: ['a'], sharedFields: ['x'] },
        ],
      },
    ];

    const result = calculateSolidIndicators(
      entities,
      relationships,
      [],
      lcom4Results,
    );

    expect(result.srp[0].importSourceDiversity).toBe(20);
    expect(result.srp[0].srpScore).toBeLessThan(1);
  });
});

// ── OCP Tests ──

describe('OCP indicator', () => {
  it('gives low OCP score for many type checks', () => {
    const entities: Entity[] = [
      entity({
        id: 'cls1',
        rawCounts: {
          linesOfCode: 100,
          typeCheckingPatterns: 20,
          conditionalDispatchLocations: [
            { line: 10, kind: 'instanceof', branchCount: 3 },
            { line: 20, kind: 'typeof', branchCount: 2 },
          ],
          extensionPoints: 0,
          publicMethodCount: 5,
        },
      }),
    ];
    const relationships: Relationship[] = [
      {
        sourceEntityId: 'cls1',
        targetEntityId: 'dep1',
        kind: 'use',
        targetIsAbstraction: false,
      },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], []);

    expect(result.ocp).toHaveLength(1);
    expect(result.ocp[0].typeCheckingDensity).toBe(0.2);
    expect(result.ocp[0].ocpScore).toBeLessThan(0.3);
  });

  it('gives high OCP score with good extension points', () => {
    const entities: Entity[] = [
      entity({
        id: 'cls1',
        rawCounts: {
          linesOfCode: 200,
          typeCheckingPatterns: 0,
          extensionPoints: 5,
          publicMethodCount: 5,
        },
      }),
    ];
    const relationships: Relationship[] = [
      {
        sourceEntityId: 'cls1',
        targetEntityId: 'iface1',
        kind: 'use',
        targetIsAbstraction: true,
      },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], []);

    expect(result.ocp[0].extensionPointRatio).toBe(1);
    expect(result.ocp[0].ocpScore).toBeGreaterThan(0.9);
  });

  it('gives OCP score = 1 when no type checking patterns and good defaults', () => {
    const entities: Entity[] = [
      entity({
        id: 'cls1',
        rawCounts: {
          linesOfCode: 100,
          typeCheckingPatterns: 0,
          extensionPoints: 4,
          publicMethodCount: 4,
        },
      }),
    ];

    const result = calculateSolidIndicators(entities, [], [], []);

    expect(result.ocp[0].typeCheckingDensity).toBe(0);
    expect(result.ocp[0].ocpScore).toBe(1);
  });
});

// ── ISP Tests ──

describe('ISP indicator', () => {
  it('gives low ISP score for fat interface', () => {
    const entities: Entity[] = [entity({ id: 'iface1', kind: 'interface' })];
    // 4 consumers each using only 3 of 15 methods
    const relationships: Relationship[] = Array.from({ length: 4 }, (_, i) => ({
      sourceEntityId: `consumer${i}`,
      targetEntityId: 'iface1',
      kind: 'use',
      consumedMembers: [`m${i * 3}`, `m${i * 3 + 1}`, `m${i * 3 + 2}`],
      targetTotalMembers: 15,
    }));

    const result = calculateSolidIndicators(entities, relationships, [], []);

    expect(result.isp).toHaveLength(1);
    expect(result.isp[0].avgUsageRatio).toBe(3 / 15);
    expect(result.isp[0].ispScore).toBeLessThan(0.3);
  });

  it('gives high ISP score for focused interface', () => {
    const entities: Entity[] = [entity({ id: 'iface1', kind: 'interface' })];
    const relationships: Relationship[] = [
      {
        sourceEntityId: 'consumer1',
        targetEntityId: 'iface1',
        kind: 'use',
        consumedMembers: ['read', 'write', 'close'],
        targetTotalMembers: 3,
      },
      {
        sourceEntityId: 'consumer2',
        targetEntityId: 'iface1',
        kind: 'use',
        consumedMembers: ['read', 'write', 'close'],
        targetTotalMembers: 3,
      },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], []);

    expect(result.isp[0].avgUsageRatio).toBe(1);
    expect(result.isp[0].ispScore).toBe(1);
  });

  it('produces correct suggested splits from member usage clusters', () => {
    const entities: Entity[] = [entity({ id: 'iface1', kind: 'interface' })];
    const relationships: Relationship[] = [
      {
        sourceEntityId: 'consumerA',
        targetEntityId: 'iface1',
        kind: 'use',
        consumedMembers: ['read', 'write'],
        targetTotalMembers: 4,
      },
      {
        sourceEntityId: 'consumerB',
        targetEntityId: 'iface1',
        kind: 'use',
        consumedMembers: ['read', 'write'],
        targetTotalMembers: 4,
      },
      {
        sourceEntityId: 'consumerC',
        targetEntityId: 'iface1',
        kind: 'use',
        consumedMembers: ['connect', 'disconnect'],
        targetTotalMembers: 4,
      },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], []);

    expect(result.isp[0].suggestedSplits).toHaveLength(2);
    const splitMembers = result.isp[0].suggestedSplits.map(s => s.members);
    expect(splitMembers).toContainEqual(['read', 'write']);
    expect(splitMembers).toContainEqual(['connect', 'disconnect']);

    const rwSplit = result.isp[0].suggestedSplits.find(
      s => s.members.includes('read'),
    )!;
    expect(rwSplit.consumers).toContainEqual('consumerA');
    expect(rwSplit.consumers).toContainEqual('consumerB');
  });
});

// ── DIP Tests ──

describe('DIP indicator', () => {
  it('gives low DIP score for all concrete dependencies', () => {
    const entities: Entity[] = [
      entity({ id: 'cls1' }),
      entity({ id: 'dep1' }),
      entity({ id: 'dep2' }),
    ];
    const relationships: Relationship[] = [
      {
        sourceEntityId: 'cls1',
        targetEntityId: 'dep1',
        kind: 'use',
        targetIsAbstraction: false,
      },
      {
        sourceEntityId: 'cls1',
        targetEntityId: 'dep2',
        kind: 'use',
        targetIsAbstraction: false,
      },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], []);

    const dip = result.dip.find(d => d.entityId === 'cls1')!;
    expect(dip.abstractionDependencyRatio).toBe(0);
    expect(dip.concreteDependencyCount).toBe(2);
    expect(dip.dipScore).toBe(0);
  });

  it('gives high DIP score for all abstract dependencies', () => {
    const entities: Entity[] = [
      entity({ id: 'cls1' }),
      entity({ id: 'iface1', kind: 'interface' }),
      entity({ id: 'iface2', kind: 'interface' }),
    ];
    const relationships: Relationship[] = [
      {
        sourceEntityId: 'cls1',
        targetEntityId: 'iface1',
        kind: 'use',
        targetIsAbstraction: true,
      },
      {
        sourceEntityId: 'cls1',
        targetEntityId: 'iface2',
        kind: 'use',
        targetIsAbstraction: true,
      },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], []);

    const dip = result.dip.find(d => d.entityId === 'cls1')!;
    expect(dip.abstractionDependencyRatio).toBe(1);
    expect(dip.concreteDependencyCount).toBe(0);
    expect(dip.dipScore).toBe(1);
  });

  it('detects layer violations', () => {
    const entities: Entity[] = [
      entity({ id: 'core', filePath: 'src/domain/core.ts' }),
      entity({ id: 'infra', filePath: 'src/infra/db.ts' }),
      entity({ id: 'outer', filePath: 'src/infra/api.ts' }),
    ];
    const relationships: Relationship[] = [
      // core → infra: violation (higher layer depends on lower)
      {
        sourceEntityId: 'core',
        targetEntityId: 'infra',
        kind: 'use',
        targetIsAbstraction: false,
      },
      // core → outer: violation
      {
        sourceEntityId: 'core',
        targetEntityId: 'outer',
        kind: 'use',
        targetIsAbstraction: false,
      },
    ];
    const moduleBoundaries: ModuleBoundary[] = [
      {
        moduleId: 'domain',
        modulePath: 'src/domain',
        files: ['src/domain/core.ts'],
        declaredLayer: 3, // core = highest
        isPackage: false,
        kind: 'manual',
      },
      {
        moduleId: 'infra',
        modulePath: 'src/infra',
        files: ['src/infra/db.ts', 'src/infra/api.ts'],
        declaredLayer: 1, // infra = lowest
        isPackage: false,
        kind: 'manual',
      },
    ];

    const result = calculateSolidIndicators(
      entities,
      relationships,
      moduleBoundaries,
      [],
    );

    const dip = result.dip.find(d => d.entityId === 'core')!;
    expect(dip.layerViolationCount).toBe(2);
  });
});

// ── LSP Tests ──

describe('LSP indicator', () => {
  it('gives LSP score = 1 for entity with no overrides', () => {
    const entities: Entity[] = [
      entity({ id: 'child', rawCounts: {} }),
      entity({ id: 'parent' }),
    ];
    const relationships: Relationship[] = [
      { sourceEntityId: 'child', targetEntityId: 'parent', kind: 'extend' },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], []);

    expect(result.lsp).toHaveLength(1);
    expect(result.lsp[0].overrideCount).toBe(0);
    expect(result.lsp[0].lspScore).toBe(1);
  });

  it('gives LSP score = 1 for matching override signatures', () => {
    const entities: Entity[] = [
      entity({
        id: 'child',
        rawCounts: {
          overriddenMethods: [
            { name: 'process', paramTypes: ['string', 'number'], returnType: 'void' },
          ],
        },
      }),
      entity({
        id: 'parent',
        rawCounts: {
          overriddenMethods: [
            { name: 'process', paramTypes: ['string', 'number'], returnType: 'void' },
          ],
        },
      }),
    ];
    const relationships: Relationship[] = [
      { sourceEntityId: 'child', targetEntityId: 'parent', kind: 'extend' },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], []);

    expect(result.lsp).toHaveLength(1);
    expect(result.lsp[0].overrideCount).toBe(1);
    expect(result.lsp[0].signatureMismatches).toHaveLength(0);
    expect(result.lsp[0].lspScore).toBe(1);
  });

  it('detects mismatched override signatures and gives LSP score < 1', () => {
    const entities: Entity[] = [
      entity({
        id: 'child',
        rawCounts: {
          overriddenMethods: [
            { name: 'process', paramTypes: ['number'], returnType: 'string' },
            { name: 'validate', paramTypes: ['boolean'], returnType: 'number' },
          ],
        },
      }),
      entity({
        id: 'parent',
        rawCounts: {
          overriddenMethods: [
            { name: 'process', paramTypes: ['string', 'number'], returnType: 'void' },
            { name: 'validate', paramTypes: ['string'], returnType: 'boolean' },
          ],
        },
      }),
    ];
    const relationships: Relationship[] = [
      { sourceEntityId: 'child', targetEntityId: 'parent', kind: 'extend' },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], []);

    expect(result.lsp).toHaveLength(1);
    expect(result.lsp[0].overrideCount).toBe(2);
    expect(result.lsp[0].signatureMismatches).toHaveLength(2);
    expect(result.lsp[0].lspScore).toBeLessThan(1);

    const processMismatch = result.lsp[0].signatureMismatches.find(
      m => m.methodName === 'process',
    )!;
    expect(processMismatch.baseParams).toEqual(['string', 'number']);
    expect(processMismatch.overrideParams).toEqual(['number']);
    expect(processMismatch.baseReturn).toBe('void');
    expect(processMismatch.overrideReturn).toBe('string');
  });
});

// ── SRP Name Clustering Tests (covers jaccard + clusterMethodsByNameTokens) ──

describe('SRP name semantic clustering', () => {
  it('clusters child methods by name token similarity', () => {
    const entities: Entity[] = [
      entity({ id: 'cls1' }),
      entity({ id: 'getUserData', kind: 'method', nameTokens: ['get', 'user', 'data'] }),
      entity({ id: 'setUserData', kind: 'method', nameTokens: ['set', 'user', 'data'] }),
      entity({ id: 'parseConfig', kind: 'method', nameTokens: ['parse', 'config'] }),
      entity({ id: 'loadConfig', kind: 'method', nameTokens: ['load', 'config'] }),
    ];
    const relationships: Relationship[] = [
      { sourceEntityId: 'cls1', targetEntityId: 'getUserData', kind: 'contain' },
      { sourceEntityId: 'cls1', targetEntityId: 'setUserData', kind: 'contain' },
      { sourceEntityId: 'cls1', targetEntityId: 'parseConfig', kind: 'contain' },
      { sourceEntityId: 'cls1', targetEntityId: 'loadConfig', kind: 'contain' },
    ];
    const lcom4Results: Lcom4Result[] = [
      {
        entityId: 'cls1',
        lcom4: 2,
        cohesionGroups: [
          { methods: ['getUserData', 'setUserData'], sharedFields: ['user'] },
          { methods: ['parseConfig', 'loadConfig'], sharedFields: ['config'] },
        ],
      },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], lcom4Results);

    expect(result.srp[0].nameSemanticClusters.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty clusters when entity has no child methods', () => {
    const entities: Entity[] = [entity({ id: 'cls1' })];
    const lcom4Results: Lcom4Result[] = [
      {
        entityId: 'cls1',
        lcom4: 1,
        cohesionGroups: [{ methods: ['a'], sharedFields: [] }],
      },
    ];

    const result = calculateSolidIndicators(entities, [], [], lcom4Results);

    expect(result.srp[0].nameSemanticClusters).toEqual([]);
  });

  it('puts all methods in one cluster when all share tokens', () => {
    const entities: Entity[] = [
      entity({ id: 'cls1' }),
      entity({ id: 'getUser', kind: 'method', nameTokens: ['get', 'user'] }),
      entity({ id: 'fetchUser', kind: 'method', nameTokens: ['fetch', 'user'] }),
      entity({ id: 'loadUser', kind: 'method', nameTokens: ['load', 'user'] }),
    ];
    const relationships: Relationship[] = [
      { sourceEntityId: 'cls1', targetEntityId: 'getUser', kind: 'contain' },
      { sourceEntityId: 'cls1', targetEntityId: 'fetchUser', kind: 'contain' },
      { sourceEntityId: 'cls1', targetEntityId: 'loadUser', kind: 'contain' },
    ];
    const lcom4Results: Lcom4Result[] = [
      {
        entityId: 'cls1',
        lcom4: 1,
        cohesionGroups: [{ methods: ['getUser', 'fetchUser', 'loadUser'], sharedFields: ['user'] }],
      },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], lcom4Results);

    // All methods share "user" token so jaccard > 0.3 → one cluster
    expect(result.srp[0].nameSemanticClusters).toHaveLength(1);
    expect(result.srp[0].nameSemanticClusters[0]).toHaveLength(3);
  });

  it('separates methods with no shared tokens into individual clusters', () => {
    const entities: Entity[] = [
      entity({ id: 'cls1' }),
      entity({ id: 'alpha', kind: 'method', nameTokens: ['alpha'] }),
      entity({ id: 'beta', kind: 'method', nameTokens: ['beta'] }),
      entity({ id: 'gamma', kind: 'method', nameTokens: ['gamma'] }),
    ];
    const relationships: Relationship[] = [
      { sourceEntityId: 'cls1', targetEntityId: 'alpha', kind: 'contain' },
      { sourceEntityId: 'cls1', targetEntityId: 'beta', kind: 'contain' },
      { sourceEntityId: 'cls1', targetEntityId: 'gamma', kind: 'contain' },
    ];
    const lcom4Results: Lcom4Result[] = [
      {
        entityId: 'cls1',
        lcom4: 3,
        cohesionGroups: [
          { methods: ['alpha'], sharedFields: [] },
          { methods: ['beta'], sharedFields: [] },
          { methods: ['gamma'], sharedFields: [] },
        ],
      },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], lcom4Results);

    // No shared tokens → each method is its own cluster
    expect(result.srp[0].nameSemanticClusters).toHaveLength(3);
  });
});

// ── OCP Edge Cases ──

describe('OCP edge cases', () => {
  it('handles zero LOC gracefully (no division by zero)', () => {
    const entities: Entity[] = [
      entity({
        id: 'cls1',
        rawCounts: {
          linesOfCode: 0,
          typeCheckingPatterns: 0,
          extensionPoints: 0,
          publicMethodCount: 0,
        },
      }),
    ];

    const result = calculateSolidIndicators(entities, [], [], []);

    expect(result.ocp).toHaveLength(1);
    expect(result.ocp[0].typeCheckingDensity).toBe(0);
    // extensionPointRatio = pubMethods > 0 ? extPoints/pubMethods : 1
    expect(result.ocp[0].extensionPointRatio).toBe(1);
  });

  it('skips entities without rawCounts', () => {
    const entities: Entity[] = [entity({ id: 'cls1' })]; // no rawCounts

    const result = calculateSolidIndicators(entities, [], [], []);

    expect(result.ocp).toHaveLength(0);
  });

  it('computes concreteTargetRatio as 0 when no outgoing deps', () => {
    const entities: Entity[] = [
      entity({
        id: 'cls1',
        rawCounts: { linesOfCode: 50, typeCheckingPatterns: 0, extensionPoints: 2, publicMethodCount: 4 },
      }),
    ];

    const result = calculateSolidIndicators(entities, [], [], []);

    expect(result.ocp[0].concreteTargetRatio).toBe(0);
  });
});

// ── DIP Edge Cases ──

describe('DIP edge cases', () => {
  it('gives dipScore 1 when all deps have unknown targetIsAbstraction', () => {
    const entities: Entity[] = [
      entity({ id: 'cls1' }),
      entity({ id: 'dep1' }),
    ];
    const relationships: Relationship[] = [
      {
        sourceEntityId: 'cls1',
        targetEntityId: 'dep1',
        kind: 'use',
        // targetIsAbstraction not set (undefined)
      },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], []);

    const dip = result.dip.find(d => d.entityId === 'cls1');
    expect(dip).toBeDefined();
    // No classified deps → abstractionDependencyRatio = 1
    expect(dip!.abstractionDependencyRatio).toBe(1);
    expect(dip!.dipScore).toBe(1);
  });

  it('skips entities with no outgoing relationships', () => {
    const entities: Entity[] = [entity({ id: 'cls1' })];

    const result = calculateSolidIndicators(entities, [], [], []);

    expect(result.dip).toHaveLength(0);
  });

  it('counts no layer violations when source has no declaredLayer', () => {
    const entities: Entity[] = [
      entity({ id: 'cls1', filePath: 'src/somewhere.ts' }),
      entity({ id: 'dep1', filePath: 'src/infra/db.ts' }),
    ];
    const relationships: Relationship[] = [
      { sourceEntityId: 'cls1', targetEntityId: 'dep1', kind: 'use', targetIsAbstraction: false },
    ];
    const moduleBoundaries: ModuleBoundary[] = [
      { moduleId: 'infra', modulePath: 'src/infra', files: ['src/infra/db.ts'], declaredLayer: 1, isPackage: false, kind: 'manual' },
    ];

    const result = calculateSolidIndicators(entities, relationships, moduleBoundaries, []);

    const dip = result.dip.find(d => d.entityId === 'cls1')!;
    expect(dip.layerViolationCount).toBe(0);
  });
});

// ── LSP Edge Cases ──

describe('LSP edge cases', () => {
  it('skips entities without an extend relationship', () => {
    const entities: Entity[] = [entity({ id: 'cls1' })];

    const result = calculateSolidIndicators(entities, [], [], []);

    expect(result.lsp).toHaveLength(0);
  });

  it('skips override comparison when base method not found', () => {
    const entities: Entity[] = [
      entity({
        id: 'child',
        rawCounts: {
          overriddenMethods: [
            { name: 'unknownMethod', paramTypes: ['string'], returnType: 'void' },
          ],
        },
      }),
      entity({ id: 'parent', rawCounts: {} }),
    ];
    const relationships: Relationship[] = [
      { sourceEntityId: 'child', targetEntityId: 'parent', kind: 'extend' },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], []);

    // unknownMethod not in parent → no mismatch detected
    expect(result.lsp[0].overrideCount).toBe(1);
    expect(result.lsp[0].signatureMismatches).toHaveLength(0);
    expect(result.lsp[0].lspScore).toBe(1);
  });

  it('clamps LSP score at 0 for many mismatches', () => {
    const overrides = Array.from({ length: 10 }, (_, i) => ({
      name: `method${i}`,
      paramTypes: ['number'],
      returnType: 'string',
    }));
    const baseMethods = Array.from({ length: 10 }, (_, i) => ({
      name: `method${i}`,
      paramTypes: ['string'],
      returnType: 'void',
    }));

    const entities: Entity[] = [
      entity({ id: 'child', rawCounts: { overriddenMethods: overrides } }),
      entity({ id: 'parent', rawCounts: { overriddenMethods: baseMethods } }),
    ];
    const relationships: Relationship[] = [
      { sourceEntityId: 'child', targetEntityId: 'parent', kind: 'extend' },
    ];

    const result = calculateSolidIndicators(entities, relationships, [], []);

    expect(result.lsp[0].signatureMismatches).toHaveLength(10);
    // 10 × 0.2 = 2.0 penalty → 1 - 2 = -1 → clamped to 0
    expect(result.lsp[0].lspScore).toBe(0);
  });
});
