 
/* This file is auto-generated from JSON Schema. Do not edit manually. */

/**
 * Metadata for a single file in the repository. Every file gets an inventory entry regardless of whether it contains analysable code. Non-code files (config, assets, docs) carry category and size but no line-level metrics.
 */
export interface FileInventoryEntry {
  /**
   * Repository-relative path to the file.
   */
  filePath: string;
  /**
   * High-level file category. Adapters map language-specific extensions and paths into these canonical categories.
   */
  fileCategory: 'source_code' | 'style' | 'config' | 'asset' | 'docs' | 'test' | 'generated' | 'other';
  /**
   * True if this file is in a language the current adapter can extract entities from (e.g. TS/TSX/CSS for the TypeScript adapter).
   */
  isAnalyzedLanguage: boolean;
  /**
   * File size in bytes on disk.
   */
  fileSizeBytes: number;
  /**
   * Total number of lines in the file. Null for binary or non-text files.
   */
  totalLines?: number | null;
  /**
   * Number of blank (whitespace-only) lines. Null for non-text files.
   */
  blankLines?: number | null;
  /**
   * Number of lines that are comments or documentation. Null for non-text files or when the adapter cannot identify comments.
   */
  commentLines?: number | null;
  /**
   * Number of lines that contain only import/re-export/export-forwarding statements. Null for non-code files.
   */
  importExportOnlyLines?: number | null;
}
