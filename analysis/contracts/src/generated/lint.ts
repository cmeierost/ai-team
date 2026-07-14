 
/* This file is auto-generated from JSON Schema. Do not edit manually. */

/**
 * Lint signals from static-analysis tools such as ESLint, Stylelint, or Biome. Represents a collection of rule violations found in source files.
 */
export interface LintSignal {
  /**
   * Metadata about the lint tool that produced these signals.
   */
  source: {
    /**
     * Name of the lint tool (e.g. "eslint", "biome").
     */
    tool: string;
    /**
     * Version of the lint tool.
     */
    version: string;
    /**
     * Rule set or configuration name used for the run (e.g. "recommended", "custom").
     */
    ruleSet: string;
  };
  /**
   * Array of individual lint violations.
   */
  results: LintResult[];
}
/**
 * A single lint rule violation at a specific location in a source file.
 */
export interface LintResult {
  /**
   * Path to the source file, relative to the repository root.
   */
  filePath: string;
  /**
   * Identifier of the lint rule that was violated (e.g. "no-unused-vars").
   */
  ruleId: string;
  /**
   * Severity level of the violation.
   */
  severity: 'error' | 'warning' | 'info';
  /**
   * Human-readable description of the violation.
   */
  message: string;
  /**
   * One-based line number where the violation starts.
   */
  line: number;
  /**
   * Zero-based column number where the violation starts.
   */
  column: number;
  /**
   * One-based line number where the violation ends, if available.
   */
  endLine?: number | null;
  /**
   * Zero-based column number where the violation ends, if available.
   */
  endColumn?: number | null;
}
