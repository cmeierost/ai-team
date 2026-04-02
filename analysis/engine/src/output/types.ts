/**
 * Shared types for output exporters.
 */

import type { Entity, Relationship, ModuleBoundary } from '@aspect/contracts';

/** Raw collected data fed into the analysis engine. */
export interface CollectedData {
  entities: Entity[];
  relationships: Relationship[];
  moduleBoundaries: ModuleBoundary[];
}

/** Build a lookup map from entity ID → Entity. */
export function buildEntityMap(entities: Entity[]): Map<string, Entity> {
  return new Map(entities.map((e) => [e.id, e]));
}
