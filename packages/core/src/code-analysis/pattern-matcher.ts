/**
 * Pattern match result
 */
export interface PatternMatch {
  filePath: string;
  line: number;
  column: number;
  matchedText: string;
  /** The full line containing the match */
  lineText: string;
  /** Node type from the syntax tree */
  nodeType: string;
}

/**
 * Pattern types for common code analysis queries
 */
export type PatternType =
  | 'async-without-await' // Async functions that don't await anything
  | 'unused-import' // Imports that aren't referenced
  | 'console-log' // Console.log statements
  | 'todo-comment' // TODO/FIXME comments
  | 'empty-catch' // Empty catch blocks
  | 'custom'; // Custom tree-sitter query
