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
   * Entry points declared in this module's package.json (bin, main, exports).
   * Only present for package-kind boundaries.
   */
  entryPoints?: ModuleBoundaryEntryPoint[];
  /**
   * True when package.json signals this is a runnable application (has bin,
   * scripts.start, engines.vscode, or a bundler without library exports).
   */
  isApp?: boolean;
  /**
   * Why this package is classified as an app. Only set when isApp is true.
   */
  appKind?: 'cli' | 'server' | 'extension' | 'web-app';
}

/** An entry point declared in a package manifest. */
export interface ModuleBoundaryEntryPoint {
  /** Source file path (relative to repo root) resolved from the manifest entry. */
  file: string;
  /** How this entry point was declared. */
  kind: 'bin' | 'main' | 'exports' | 'browser';
  /** True when this entry point is an app root (not a library export). */
  isAppEntry: boolean;
  /** Optional entry point name (e.g. the bin command name or exports subpath). */
  name?: string;
}
