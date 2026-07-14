 
/* This file is auto-generated from JSON Schema. Do not edit manually. */

/**
 * Metadata describing how the analysis data was collected, including timing information and details of each tool invocation.
 */
export interface Provenance {
  /**
   * Total wall-clock time for the collection run, in milliseconds.
   */
  collectionDuration: number;
  /**
   * Ordered list of tool invocations that contributed to this collection.
   */
  toolRuns: ToolRun[];
}
/**
 * Record of a single tool invocation during collection.
 */
export interface ToolRun {
  /**
   * Name or identifier of the tool that was executed (e.g. 'ts-morph-collector', 'eslint').
   */
  tool: string;
  /**
   * Semantic version of the tool.
   */
  version: string;
  /**
   * Which analysis aspect this tool served (e.g. 'structure', 'complexity', 'dependencies').
   */
  aspect: string;
  /**
   * Process exit code returned by the tool. 0 indicates success.
   */
  exitCode: number;
  /**
   * Wall-clock time for this tool run, in milliseconds.
   */
  duration: number;
  /**
   * Non-fatal warnings emitted by the tool during execution.
   */
  warnings: string[];
}
