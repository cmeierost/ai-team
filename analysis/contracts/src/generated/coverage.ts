/* eslint-disable */
/* This file is auto-generated from JSON Schema. Do not edit manually. */

/**
 * Code-coverage signals from tools such as LCOV, Istanbul, or Cobertura. Represents per-file line, branch, and function coverage data.
 */
export interface CoverageSignal {
  /**
   * Metadata about the coverage tool and format that produced these signals.
   */
  source: {
    /**
     * Name of the coverage tool (e.g. "istanbul", "llvm-cov").
     */
    tool: string;
    /**
     * Coverage report format used as input.
     */
    format: 'lcov' | 'cobertura' | 'istanbul' | 'clover' | 'other';
    /**
     * Version of the tool that produced the coverage data.
     */
    version: string;
  };
  /**
   * Per-file coverage data.
   */
  files: FileCoverage[];
}
/**
 * Coverage data for a single source file.
 */
export interface FileCoverage {
  /**
   * Path to the source file, relative to the repository root.
   */
  filePath: string;
  /**
   * Number of lines executed at least once.
   */
  linesCovered: number;
  /**
   * Total number of instrumentable lines in the file.
   */
  linesTotal: number;
  /**
   * Number of branches executed at least once, if available.
   */
  branchesCovered?: number | null;
  /**
   * Total number of branches in the file, if available.
   */
  branchesTotal?: number | null;
  /**
   * Per-function execution counts.
   */
  functions?: FunctionCoverage[];
}
/**
 * Execution data for a single function.
 */
export interface FunctionCoverage {
  /**
   * Name of the function as reported by the coverage tool.
   */
  name: string;
  /**
   * One-based line number where the function is defined.
   */
  line: number;
  /**
   * Number of times the function was executed during the test run.
   */
  executionCount: number;
}
