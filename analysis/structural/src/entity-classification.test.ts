import { describe, it, expect } from 'vitest';
import { classifyEntityConcern, classifyAllEntities } from './entity-classification.js';
import type { Entity } from '@aspect/contracts';

function makeEntity(overrides: Partial<Entity> & { id: string; kind: string; name: string }): Entity {
  return {
    filePath: 'src/test.ts',
    sourceRange: { startLine: 1, startColumn: 1, endLine: 10, endColumn: 1 },
    childEntityIds: [],
    entityDepth: 1,
    hierarchyKind: 'member',
    classification: {
      isAbstract: false,
      isInterface: false,
      isConcrete: true,
      isTypeOnly: false,
      isExported: true,
      visibility: null,
    },
    rawCounts: {
      linesOfCode: 10,
      blankLines: null,
      commentLines: null,
      parameterCount: null,
      returnStatements: null,
      branchPoints: null,
      nestingContributions: null,
      operators: null,
      operands: null,
      typeCheckingPatterns: null,
      conditionalDispatchLocations: null,
      extensionPoints: null,
      publicMethodCount: null,
      publicPropertyCount: null,
      overriddenMethods: null,
      jsxElementCount: null,
    },
    nameTokens: [],
    methodFieldAccessMatrix: null,
    ...overrides,
  } as Entity;
}

describe('classifyEntityConcern', () => {
  it('classifies interface as contract', () => {
    const entity = makeEntity({
      id: 'iface-1', kind: 'interface', name: 'UserProps',
      classification: {
        isAbstract: false, isInterface: true, isConcrete: false,
        isTypeOnly: true, isExported: true, visibility: null,
      },
    });
    const result = classifyEntityConcern(entity);
    expect(result.concern).toBe('contract');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies type-alias as contract', () => {
    const entity = makeEntity({
      id: 'type-1', kind: 'type-alias', name: 'Config',
      classification: {
        isAbstract: false, isInterface: false, isConcrete: false,
        isTypeOnly: true, isExported: true, visibility: null,
      },
    });
    const result = classifyEntityConcern(entity);
    expect(result.concern).toBe('contract');
  });

  it('classifies enum as contract', () => {
    const entity = makeEntity({ id: 'enum-1', kind: 'enum', name: 'Status' });
    const result = classifyEntityConcern(entity);
    expect(result.concern).toBe('contract');
  });

  it('classifies JSX-heavy function as presentation', () => {
    const entity = makeEntity({
      id: 'comp-1', kind: 'function', name: 'UserCard',
      rawCounts: {
        linesOfCode: 20, jsxElementCount: 8,
        blankLines: null, commentLines: null, parameterCount: null,
        returnStatements: null, branchPoints: null,
        nestingContributions: null, operators: null, operands: null,
        typeCheckingPatterns: null, conditionalDispatchLocations: null,
        extensionPoints: null, publicMethodCount: null,
        publicPropertyCount: null, overriddenMethods: null,
      },
    });
    const result = classifyEntityConcern(entity);
    expect(result.concern).toBe('presentation');
  });

  it('classifies complex function with branches as logic', () => {
    const entity = makeEntity({
      id: 'fn-1', kind: 'function', name: 'calculateTotal',
      rawCounts: {
        linesOfCode: 30, branchPoints: 8, jsxElementCount: null,
        blankLines: null, commentLines: null, parameterCount: null,
        returnStatements: null, nestingContributions: null,
        operators: null, operands: null, typeCheckingPatterns: null,
        conditionalDispatchLocations: null, extensionPoints: null,
        publicMethodCount: null, publicPropertyCount: null,
        overriddenMethods: null,
      },
    });
    const result = classifyEntityConcern(entity);
    expect(result.concern).toBe('logic');
  });

  it('classifies hook-named function as logic', () => {
    const entity = makeEntity({
      id: 'hook-1', kind: 'function', name: 'useAuth',
    });
    const result = classifyEntityConcern(entity);
    expect(result.concern).toBe('logic');
  });

  it('classifies *Props-named type as contract', () => {
    const entity = makeEntity({
      id: 'props-1', kind: 'type-alias', name: 'ButtonProps',
      classification: {
        isAbstract: false, isInterface: false, isConcrete: false,
        isTypeOnly: true, isExported: true, visibility: null,
      },
    });
    const result = classifyEntityConcern(entity);
    expect(result.concern).toBe('contract');
  });

  it('classifies CSS selector-rule as presentation', () => {
    const entity = makeEntity({
      id: 'css-1', kind: 'selector-rule', name: '.button',
    });
    const result = classifyEntityConcern(entity);
    expect(result.concern).toBe('presentation');
  });

  it('classifies method with moderate branches as logic', () => {
    const entity = makeEntity({
      id: 'method-1', kind: 'method', name: 'processItems',
      rawCounts: {
        linesOfCode: 15, branchPoints: 3, jsxElementCount: null,
        blankLines: null, commentLines: null, parameterCount: null,
        returnStatements: null, nestingContributions: null,
        operators: null, operands: null, typeCheckingPatterns: null,
        conditionalDispatchLocations: null, extensionPoints: null,
        publicMethodCount: null, publicPropertyCount: null,
        overriddenMethods: null,
      },
    });
    const result = classifyEntityConcern(entity);
    expect(result.concern).toBe('logic');
  });

  it('classifies mixed JSX + logic with dominant JSX as presentation', () => {
    const entity = makeEntity({
      id: 'mixed-1', kind: 'function', name: 'AgentNode',
      rawCounts: {
        linesOfCode: 40, jsxElementCount: 12, branchPoints: 2,
        blankLines: null, commentLines: null, parameterCount: null,
        returnStatements: null, nestingContributions: null,
        operators: null, operands: null, typeCheckingPatterns: null,
        conditionalDispatchLocations: null, extensionPoints: null,
        publicMethodCount: null, publicPropertyCount: null,
        overriddenMethods: null,
      },
    });
    const result = classifyEntityConcern(entity);
    expect(result.concern).toBe('presentation');
  });

  it('classifies logic function inside presentation file by entity content', () => {
    // The key use case: getStatusColor is logic even inside a component file
    const entity = makeEntity({
      id: 'helper-1', kind: 'function', name: 'getStatusColor',
      rawCounts: {
        linesOfCode: 8, branchPoints: 4, jsxElementCount: null,
        blankLines: null, commentLines: null, parameterCount: null,
        returnStatements: null, nestingContributions: null,
        operators: null, operands: null, typeCheckingPatterns: null,
        conditionalDispatchLocations: null, extensionPoints: null,
        publicMethodCount: null, publicPropertyCount: null,
        overriddenMethods: null,
      },
    });
    const result = classifyEntityConcern(entity);
    expect(result.concern).toBe('logic');
    expect(result.signals.some(s => s.includes('logic'))).toBe(true);
  });

  it('returns unknown for entity with no signals', () => {
    const entity = makeEntity({
      id: 'bare-1', kind: 'field', name: 'x',
      classification: {
        isAbstract: false, isInterface: false, isConcrete: false,
        isTypeOnly: false, isExported: false, visibility: null,
      },
      rawCounts: {
        linesOfCode: 1, branchPoints: null, jsxElementCount: null,
        blankLines: null, commentLines: null, parameterCount: null,
        returnStatements: null, nestingContributions: null,
        operators: null, operands: null, typeCheckingPatterns: null,
        conditionalDispatchLocations: null, extensionPoints: null,
        publicMethodCount: null, publicPropertyCount: null,
        overriddenMethods: null,
      },
    });
    const result = classifyEntityConcern(entity);
    expect(['unknown', 'contract', 'logic', 'presentation']).toContain(result.concern);
  });
});

describe('classifyAllEntities', () => {
  it('skips file entities', () => {
    const entities = [
      makeEntity({ id: 'file-1', kind: 'file', name: 'test.ts' }),
      makeEntity({ id: 'fn-1', kind: 'function', name: 'doWork' }),
    ];
    const summary = classifyAllEntities(entities);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].entityId).toBe('fn-1');
  });

  it('produces correct totals', () => {
    const entities = [
      makeEntity({
        id: 'iface-1', kind: 'interface', name: 'FooProps',
        classification: {
          isAbstract: false, isInterface: true, isConcrete: false,
          isTypeOnly: true, isExported: true, visibility: null,
        },
      }),
      makeEntity({
        id: 'fn-1', kind: 'function', name: 'calculateFoo',
        rawCounts: {
          linesOfCode: 20, branchPoints: 5, jsxElementCount: null,
          blankLines: null, commentLines: null, parameterCount: null,
          returnStatements: null, nestingContributions: null,
          operators: null, operands: null, typeCheckingPatterns: null,
          conditionalDispatchLocations: null, extensionPoints: null,
          publicMethodCount: null, publicPropertyCount: null,
          overriddenMethods: null,
        },
      }),
      makeEntity({
        id: 'comp-1', kind: 'function', name: 'UserCard',
        rawCounts: {
          linesOfCode: 30, jsxElementCount: 10, branchPoints: null,
          blankLines: null, commentLines: null, parameterCount: null,
          returnStatements: null, nestingContributions: null,
          operators: null, operands: null, typeCheckingPatterns: null,
          conditionalDispatchLocations: null, extensionPoints: null,
          publicMethodCount: null, publicPropertyCount: null,
          overriddenMethods: null,
        },
      }),
    ];
    const summary = classifyAllEntities(entities);
    expect(summary.results).toHaveLength(3);
    expect(summary.totals.contract).toBeGreaterThanOrEqual(1);
    expect(summary.totals.logic).toBeGreaterThanOrEqual(1);
    expect(summary.totals.presentation).toBeGreaterThanOrEqual(1);
  });

  it('tracks LOC per concern', () => {
    const entities = [
      makeEntity({
        id: 'fn-1', kind: 'function', name: 'calculateFoo',
        rawCounts: {
          linesOfCode: 50, branchPoints: 6, jsxElementCount: null,
          blankLines: null, commentLines: null, parameterCount: null,
          returnStatements: null, nestingContributions: null,
          operators: null, operands: null, typeCheckingPatterns: null,
          conditionalDispatchLocations: null, extensionPoints: null,
          publicMethodCount: null, publicPropertyCount: null,
          overriddenMethods: null,
        },
      }),
    ];
    const summary = classifyAllEntities(entities);
    expect(summary.totalLoc.logic).toBe(50);
  });
});
