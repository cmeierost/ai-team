/* eslint-disable */
/* This file is auto-generated from JSON Schema. Do not edit manually. */

/**
 * Duplication signals from clone-detection tools such as jscpd. Represents a single collection run with detected code clones and summary statistics.
 */
export interface DuplicationSignal {
  /**
   * Metadata about the tool that produced these duplication signals.
   */
  source: {
    /**
     * Name of the duplication-detection tool (e.g. "jscpd").
     */
    tool: string;
    /**
     * Version of the tool that produced the output.
     */
    version: string;
  };
  /**
   * Array of detected code clones.
   */
  clones: Clone[];
  /**
   * Aggregate duplication statistics for the analysed scope.
   */
  statistics: {
    /**
     * Total number of lines in all analysed sources.
     */
    totalLines: number;
    /**
     * Total number of tokens in all analysed sources.
     */
    totalTokens: number;
    /**
     * Total number of source files analysed.
     */
    totalSources: number;
    /**
     * Number of lines involved in at least one clone.
     */
    duplicatedLines: number;
    /**
     * Number of tokens involved in at least one clone.
     */
    duplicatedTokens: number;
  };
}
/**
 * A single detected code clone between two file regions.
 */
export interface Clone {
  /**
   * Unique identifier for this clone entry.
   */
  id: string;
  /**
   * Language or format of the duplicated code (e.g. "javascript", "typescript").
   */
  format: string;
  /**
   * Number of tokens in the duplicated fragment.
   */
  tokenCount: number;
  /**
   * Number of lines in the duplicated fragment.
   */
  lineCount: number;
  /**
   * Actual duplicated code text, if available.
   */
  fragment?: string | null;
  firstFile: FileLocation;
  secondFile: FileLocation1;
}
/**
 * Location of the clone in the first file.
 */
export interface FileLocation {
  /**
   * Path to the source file, relative to the repository root.
   */
  filePath: string;
  /**
   * One-based start line of the region.
   */
  startLine: number;
  /**
   * One-based end line of the region (inclusive).
   */
  endLine: number;
  /**
   * Zero-based start column, if available.
   */
  startColumn?: number | null;
  /**
   * Zero-based end column, if available.
   */
  endColumn?: number | null;
}
/**
 * Location of the clone in the second file.
 */
export interface FileLocation1 {
  /**
   * Path to the source file, relative to the repository root.
   */
  filePath: string;
  /**
   * One-based start line of the region.
   */
  startLine: number;
  /**
   * One-based end line of the region (inclusive).
   */
  endLine: number;
  /**
   * Zero-based start column, if available.
   */
  startColumn?: number | null;
  /**
   * Zero-based end column, if available.
   */
  endColumn?: number | null;
}
