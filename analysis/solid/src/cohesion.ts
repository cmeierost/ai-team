// @aspect/solid — Cohesion calculator (LCOM4)
// Derives class cohesion metrics from method-field access data.
// Pure math — no source code access or I/O.

// ── Shared types ──

export interface SourceLocation {
  filePath: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface Lcom4Result {
  entityId: string;
  location?: SourceLocation;
  /** Number of connected components in the method-field graph. */
  lcom4: number;
  cohesionGroups: Array<{
    methods: string[];
    /** Fields accessed by ≥ 2 methods in this group. */
    sharedFields: string[];
  }>;
}

// ── Core calculator ──

export function calculateLcom4(
  entityId: string,
  methodFieldAccessMatrix: Array<{ methodName: string; accessedFields: string[] }>,
  location?: SourceLocation,
): Lcom4Result {
  if (methodFieldAccessMatrix.length === 0) {
    return { entityId, location, lcom4: 0, cohesionGroups: [] };
  }

  const methods = methodFieldAccessMatrix.map(m => m.methodName);
  const fieldSets = new Map<string, Set<string>>();
  for (const m of methodFieldAccessMatrix) {
    fieldSets.set(m.methodName, new Set(m.accessedFields));
  }

  // Build adjacency: edge between two methods if they share ≥ 1 field
  const adjacency = new Map<string, Set<string>>();
  for (const m of methods) adjacency.set(m, new Set());

  for (let i = 0; i < methods.length; i++) {
    const fieldsI = fieldSets.get(methods[i])!;
    for (let j = i + 1; j < methods.length; j++) {
      const fieldsJ = fieldSets.get(methods[j])!;
      let shared = false;
      for (const f of fieldsI) {
        if (fieldsJ.has(f)) {
          shared = true;
          break;
        }
      }
      if (shared) {
        adjacency.get(methods[i])!.add(methods[j]);
        adjacency.get(methods[j])!.add(methods[i]);
      }
    }
  }

  // BFS to find connected components
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const method of methods) {
    if (visited.has(method)) continue;
    const component: string[] = [];
    const queue = [method];
    visited.add(method);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency.get(current)!) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    components.push(component);
  }

  // For each component, collect fields shared by ≥ 2 methods
  const cohesionGroups = components.map(component => {
    const allFields = new Set<string>();
    for (const m of component) {
      for (const f of fieldSets.get(m)!) allFields.add(f);
    }

    const sharedFields: string[] = [];
    for (const field of allFields) {
      let count = 0;
      for (const m of component) {
        if (fieldSets.get(m)!.has(field)) count++;
        if (count >= 2) {
          sharedFields.push(field);
          break;
        }
      }
    }

    return {
      methods: [...component].sort(),
      sharedFields: sharedFields.sort(),
    };
  });

  return {
    entityId,
    location,
    lcom4: components.length,
    cohesionGroups,
  };
}
