import { readFile } from 'node:fs/promises';

/**
 * Grep search result
 */
export interface GrepMatch {
  filePath: string;
  line: number;
  column: number;
  lineText: string;
  /** The matched portion of the line */
  matchedText: string;
}

/**
 * Options for grep search
 */
export interface GrepOptions {
  /** Case-insensitive search */
  caseInsensitive?: boolean;
  /** Match whole words only */
  wholeWord?: boolean;
  /** Return only the first N matches per file */
  maxMatchesPerFile?: number;
  /** Include context lines before/after each match */
  contextLines?: number;
}

/**
 * Fast regex-based grep search for finding text patterns in files
 * More efficient than tree-sitter for simple text searches
 */
export class GrepSearch {
  /**
   * Search for a pattern in a single file
   */
  async searchFile(
    filePath: string,
    pattern: string | RegExp,
    options: GrepOptions = {}
  ): Promise<GrepMatch[]> {
    const { caseInsensitive = false, wholeWord = false, maxMatchesPerFile = Infinity } = options;

    const sourceCode = await readFile(filePath, 'utf-8');
    const lines = sourceCode.split('\n');

    let regex: RegExp;
    if (typeof pattern === 'string') {
      // Escape special regex characters if pattern is a string
      let escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Add word boundaries if wholeWord is true
      if (wholeWord) {
        escapedPattern = `\\b${escapedPattern}\\b`;
      }

      const flags = caseInsensitive ? 'gi' : 'g';
      regex = new RegExp(escapedPattern, flags);
    } else {
      // If it's already a RegExp, use it directly (but add 'g' flag if missing)
      regex = new RegExp(
        pattern.source,
        pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'
      );
    }

    const matches: GrepMatch[] = [];
    let matchCount = 0;

    for (let i = 0; i < lines.length; i++) {
      if (matchCount >= maxMatchesPerFile) {
        break;
      }

      const line = lines[i];
      const lineMatches = Array.from(line.matchAll(regex));

      for (const match of lineMatches as RegExpMatchArray[]) {
        if (matchCount >= maxMatchesPerFile) {
          break;
        }

        matches.push({
          filePath,
          line: i + 1, // 1-based line numbers
          column: match.index || 0,
          lineText: line,
          matchedText: match[0],
        });

        matchCount++;
      }
    }

    return matches;
  }

  /**
   * Search for a pattern across multiple files
   */
  async searchFiles(
    filePaths: string[],
    pattern: string | RegExp,
    options: GrepOptions = {}
  ): Promise<GrepMatch[]> {
    const allMatches: GrepMatch[] = [];

    for (const filePath of filePaths) {
      try {
        const matches = await this.searchFile(filePath, pattern, options);
        allMatches.push(...matches);
      } catch (error) {
        console.warn(`Failed to search ${filePath}:`, error);
      }
    }

    return allMatches;
  }

  /**
   * Search for multiple patterns in parallel
   */
  async searchMultiplePatterns(
    filePaths: string[],
    patterns: (string | RegExp)[],
    options: GrepOptions = {}
  ): Promise<Map<string | RegExp, GrepMatch[]>> {
    const results = new Map<string | RegExp, GrepMatch[]>();

    for (const pattern of patterns) {
      const matches = await this.searchFiles(filePaths, pattern, options);
      results.set(pattern, matches);
    }

    return results;
  }

  /**
   * Count occurrences of a pattern
   */
  async countOccurrences(
    filePaths: string[],
    pattern: string | RegExp,
    options: GrepOptions = {}
  ): Promise<number> {
    const matches = await this.searchFiles(filePaths, pattern, options);
    return matches.length;
  }

  /**
   * Get files containing a pattern
   */
  async getFilesWithPattern(
    filePaths: string[],
    pattern: string | RegExp,
    options: GrepOptions = {}
  ): Promise<string[]> {
    const filesWithPattern = new Set<string>();

    for (const filePath of filePaths) {
      try {
        const matches = await this.searchFile(filePath, pattern, options);
        if (matches.length > 0) {
          filesWithPattern.add(filePath);
        }
      } catch (error) {
        console.warn(`Failed to search ${filePath}:`, error);
      }
    }

    return Array.from(filesWithPattern);
  }
}
