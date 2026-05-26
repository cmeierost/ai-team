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
  /**
   * How this boundary was detected. 'package' = from package.json or similar manifest, 'directory' = from folder structure at a given depth, 'facade' = from re-export index files (e.g. index.ts), 'namespace' = from language namespaces, 'manual' = user-supplied.
   */
  kind: 'package' | 'directory' | 'facade' | 'namespace' | 'manual';
  /**
   * Entry points declared in this module's package.json (bin, main, exports). Only present for package-kind boundaries.
   */
  entryPoints?: {
    /**
     * Source file path (relative to repo root) resolved from the manifest entry.
     */
    file: string;
    /**
     * How this entry point was declared.
     */
    kind: 'bin' | 'main' | 'exports' | 'browser';
    /**
     * Optional entry point name (e.g. the bin command name or exports subpath).
     */
    name?: string;
    /**
     * True if this entry point belongs to an app package (CLI, server, extension, web app) rather than a library.
     */
    isAppEntry?: boolean;
  }[];
  /**
   * True if this package is an application (has bin, start script, vscode engine, or is a pure frontend build). False for libraries. Only set for package-kind boundaries.
   */
  isApp?: boolean;
  /**
   * Why this package is classified as an app. Only set when isApp is true.
   */
  appKind?: 'cli' | 'server' | 'extension' | 'web-app';
}
