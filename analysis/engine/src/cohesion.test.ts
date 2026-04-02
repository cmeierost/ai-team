import { describe, it, expect } from 'vitest';
import { calculateLcom4 } from './cohesion.js';

// ── LCOM4: Perfect cohesion ──

describe('calculateLcom4', () => {
  it('returns LCOM4 = 1 when all methods share fields (perfect cohesion)', () => {
    const result = calculateLcom4('class1', [
      { methodName: 'getX', accessedFields: ['x', 'y'] },
      { methodName: 'getY', accessedFields: ['y', 'z'] },
      { methodName: 'getZ', accessedFields: ['z', 'x'] },
    ]);

    expect(result.lcom4).toBe(1);
    expect(result.cohesionGroups).toHaveLength(1);
    expect(result.cohesionGroups[0].methods).toEqual(['getX', 'getY', 'getZ']);
  });

  it('returns LCOM4 = 2 when there are two responsibility groups', () => {
    const result = calculateLcom4('class2', [
      { methodName: 'readName', accessedFields: ['name'] },
      { methodName: 'writeName', accessedFields: ['name'] },
      { methodName: 'readAge', accessedFields: ['age'] },
      { methodName: 'writeAge', accessedFields: ['age'] },
    ]);

    expect(result.lcom4).toBe(2);
    expect(result.cohesionGroups).toHaveLength(2);

    const groupMethods = result.cohesionGroups.map(g => g.methods);
    expect(groupMethods).toContainEqual(['readName', 'writeName']);
    expect(groupMethods).toContainEqual(['readAge', 'writeAge']);
  });

  it('returns LCOM4 = methodCount when every method is isolated', () => {
    const result = calculateLcom4('class3', [
      { methodName: 'a', accessedFields: ['f1'] },
      { methodName: 'b', accessedFields: ['f2'] },
      { methodName: 'c', accessedFields: ['f3'] },
      { methodName: 'd', accessedFields: ['f4'] },
    ]);

    expect(result.lcom4).toBe(4);
    expect(result.cohesionGroups).toHaveLength(4);
  });

  it('returns LCOM4 = 0 for zero methods', () => {
    const result = calculateLcom4('empty', []);

    expect(result.lcom4).toBe(0);
    expect(result.cohesionGroups).toHaveLength(0);
  });

  it('returns LCOM4 = 1 for a single method', () => {
    const result = calculateLcom4('single', [
      { methodName: 'only', accessedFields: ['x'] },
    ]);

    expect(result.lcom4).toBe(1);
    expect(result.cohesionGroups).toHaveLength(1);
    expect(result.cohesionGroups[0].methods).toEqual(['only']);
  });

  it('treats a method accessing no fields as an isolated component', () => {
    const result = calculateLcom4('noFields', [
      { methodName: 'connected1', accessedFields: ['shared'] },
      { methodName: 'connected2', accessedFields: ['shared'] },
      { methodName: 'isolated', accessedFields: [] },
    ]);

    expect(result.lcom4).toBe(2);
    const groupMethods = result.cohesionGroups.map(g => g.methods);
    expect(groupMethods).toContainEqual(['connected1', 'connected2']);
    expect(groupMethods).toContainEqual(['isolated']);
  });

  it('handles transitive cohesion (A-B share f1, B-C share f2 → one group)', () => {
    const result = calculateLcom4('transitive', [
      { methodName: 'A', accessedFields: ['f1'] },
      { methodName: 'B', accessedFields: ['f1', 'f2'] },
      { methodName: 'C', accessedFields: ['f2'] },
    ]);

    expect(result.lcom4).toBe(1);
    expect(result.cohesionGroups).toHaveLength(1);
    expect(result.cohesionGroups[0].methods).toEqual(['A', 'B', 'C']);
  });

  it('reports correct group membership', () => {
    const result = calculateLcom4('groups', [
      { methodName: 'render', accessedFields: ['template', 'styles'] },
      { methodName: 'applyStyles', accessedFields: ['styles'] },
      { methodName: 'fetchData', accessedFields: ['url', 'cache'] },
      { methodName: 'invalidateCache', accessedFields: ['cache'] },
    ]);

    expect(result.lcom4).toBe(2);
    const groupMethods = result.cohesionGroups.map(g => g.methods);
    expect(groupMethods).toContainEqual(['applyStyles', 'render']);
    expect(groupMethods).toContainEqual(['fetchData', 'invalidateCache']);
  });

  it('reports correct sharedFields per group', () => {
    const result = calculateLcom4('fields', [
      { methodName: 'getX', accessedFields: ['x', 'y'] },
      { methodName: 'setX', accessedFields: ['x'] },
      { methodName: 'getY', accessedFields: ['y'] },
      { methodName: 'log', accessedFields: ['logger'] },
    ]);

    // getX-setX share x, getX-getY share y → all three connected
    expect(result.lcom4).toBe(2);

    const mainGroup = result.cohesionGroups.find(g => g.methods.length === 3)!;
    expect(mainGroup).toBeDefined();
    expect(mainGroup.sharedFields).toContain('x');
    expect(mainGroup.sharedFields).toContain('y');

    const logGroup = result.cohesionGroups.find(g =>
      g.methods.includes('log'),
    )!;
    expect(logGroup.sharedFields).toEqual([]); // single method, no sharing
  });
});
