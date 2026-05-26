/* eslint-disable */
/* This file is auto-generated from JSON Schema. Do not edit manually. */

/**
 * A contiguous range of source code identified by start and end positions. Used to pinpoint where an entity or relationship originates in the source file.
 */
export interface SourceRange {
  /**
   * 1-based line number where the range begins.
   */
  startLine: number;
  /**
   * 0-based column offset where the range begins.
   */
  startColumn: number;
  /**
   * 1-based line number where the range ends.
   */
  endLine: number;
  /**
   * 0-based column offset where the range ends.
   */
  endColumn: number;
}
