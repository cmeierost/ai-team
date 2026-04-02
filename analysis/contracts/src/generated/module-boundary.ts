/* eslint-disable */
/* This file is auto-generated from JSON Schema. Do not edit manually. */

/**
 * Describes a logical module boundary for architectural analysis. Modules group files and can represent packages, layers, or other organisational units.
 */
export interface ModuleBoundary {
  /**
   * Stable unique identifier for this module boundary.
   */
  moduleId: string;
  /**
   * File-system path (relative to the repository root) that defines the module root.
   */
  modulePath: string;
  /**
   * List of file paths (relative to repository root) that belong to this module.
   */
  files: string[];
  /**
   * Numeric layer index when a layered architecture is configured. Lower numbers are lower layers (e.g. 0 = infrastructure, 1 = domain). Null when no layering is declared.
   */
  declaredLayer: number | null;
  /**
   * True if this module boundary corresponds to a discrete distributable package (e.g. an npm package or Maven module).
   */
  isPackage: boolean;
}
