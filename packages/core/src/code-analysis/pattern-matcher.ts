import { Parser, Language, Node as SyntaxNode, Query } from 'web-tree-sitter';
import { readFile } from 'fs/promises';

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

/**
 * Tree-sitter based pattern matcher for finding code patterns
 */
export class PatternMatcher {
  private parser: Parser | null = null;
  private languages: Map<string, Language> = new Map();

  async initialize(): Promise<void> {
    await Parser.init();
    this.parser = new Parser();
  }

  async loadLanguage(languageName: string, wasmPath: string): Promise<void> {
    if (!this.parser) {
      throw new Error('Parser not initialized. Call initialize() first.');
    }

    const language = await Language.load(wasmPath);
    this.languages.set(languageName, language);
  }

  /**
   * Find matches for a pattern in a file
   */
  async findPattern(
    filePath: string,
    patternType: PatternType,
    languageName: string,
    customQuery?: string
  ): Promise<PatternMatch[]> {
    if (!this.parser) {
      throw new Error('Parser not initialized. Call initialize() first.');
    }

    const language = this.languages.get(languageName);
    if (!language) {
      throw new Error(`Language '${languageName}' not loaded.`);
    }

    this.parser.setLanguage(language);

    const sourceCode = await readFile(filePath, 'utf-8');
    const tree = this.parser.parse(sourceCode);
    if (!tree) {
      throw new Error('Tree-sitter failed to parse source code. Ensure a language is loaded.');
    }
    const lines = sourceCode.split('\n');

    const matches: PatternMatch[] = [];

    switch (patternType) {
      case 'async-without-await':
        this.findAsyncWithoutAwait(tree.rootNode, filePath, lines, matches);
        break;
      case 'console-log':
        this.findConsoleLogs(tree.rootNode, filePath, lines, matches);
        break;
      case 'todo-comment':
        this.findTodoComments(tree.rootNode, filePath, lines, matches);
        break;
      case 'empty-catch':
        this.findEmptyCatchBlocks(tree.rootNode, filePath, lines, matches);
        break;
      case 'custom':
        if (customQuery) {
          this.findCustomPattern(tree.rootNode, customQuery, filePath, lines, matches, language);
        }
        break;
    }

    return matches;
  }

  /**
   * Find patterns across multiple files
   */
  async findPatternAcrossFiles(
    filePaths: string[],
    patternType: PatternType,
    languageName: string,
    customQuery?: string
  ): Promise<PatternMatch[]> {
    const allMatches: PatternMatch[] = [];

    for (const filePath of filePaths) {
      try {
        const matches = await this.findPattern(filePath, patternType, languageName, customQuery);
        allMatches.push(...matches);
      } catch (error) {
        console.warn(`Failed to parse ${filePath}:`, error);
      }
    }

    return allMatches;
  }

  /**
   * Find async functions that don't use await
   */
  private findAsyncWithoutAwait(
    node: SyntaxNode,
    filePath: string,
    lines: string[],
    matches: PatternMatch[]
  ): void {
    if (
      (node.type === 'function_declaration' || node.type === 'arrow_function') &&
      node.text.includes('async')
    ) {
      const hasAwait = this.containsAwait(node);
      if (!hasAwait) {
        matches.push(this.createMatch(node, filePath, lines));
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.findAsyncWithoutAwait(node.child(i)!, filePath, lines, matches);
    }
  }

  /**
   * Check if a node contains an await expression
   */
  private containsAwait(node: SyntaxNode): boolean {
    if (node.type === 'await_expression') {
      return true;
    }

    for (let i = 0; i < node.childCount; i++) {
      if (this.containsAwait(node.child(i)!)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Find console.log statements
   */
  private findConsoleLogs(
    node: SyntaxNode,
    filePath: string,
    lines: string[],
    matches: PatternMatch[]
  ): void {
    if (node.type === 'call_expression') {
      const functionNode = node.childForFieldName('function');
      if (functionNode && functionNode.type === 'member_expression') {
        const objectNode = functionNode.childForFieldName('object');
        const propertyNode = functionNode.childForFieldName('property');
        if (
          objectNode &&
          objectNode.text === 'console' &&
          propertyNode &&
          propertyNode.text === 'log'
        ) {
          matches.push(this.createMatch(node, filePath, lines));
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.findConsoleLogs(node.child(i)!, filePath, lines, matches);
    }
  }

  /**
   * Find TODO/FIXME comments
   */
  private findTodoComments(
    node: SyntaxNode,
    filePath: string,
    lines: string[],
    matches: PatternMatch[]
  ): void {
    if (node.type === 'comment') {
      const text = node.text.toLowerCase();
      if (text.includes('todo') || text.includes('fixme')) {
        matches.push(this.createMatch(node, filePath, lines));
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.findTodoComments(node.child(i)!, filePath, lines, matches);
    }
  }

  /**
   * Find empty catch blocks
   */
  private findEmptyCatchBlocks(
    node: SyntaxNode,
    filePath: string,
    lines: string[],
    matches: PatternMatch[]
  ): void {
    if (node.type === 'catch_clause') {
      const bodyNode = node.childForFieldName('body');
      if (bodyNode && bodyNode.type === 'statement_block') {
        // Check if block is empty (only contains braces)
        const bodyText = bodyNode.text.trim();
        if (bodyText === '{}' || bodyText.replace(/\s/g, '') === '{}') {
          matches.push(this.createMatch(node, filePath, lines));
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      this.findEmptyCatchBlocks(node.child(i)!, filePath, lines, matches);
    }
  }

  /**
   * Find custom pattern using tree-sitter query syntax
   */
  private findCustomPattern(
    node: SyntaxNode,
    queryString: string,
    filePath: string,
    lines: string[],
    matches: PatternMatch[],
    language: Language
  ): void {
    try {
      const query = new Query(language, queryString);
      const captures = query.captures(node);

      for (const capture of captures) {
        matches.push(this.createMatch(capture.node, filePath, lines));
      }

      query.delete();
    } catch (error) {
      console.warn(`Failed to execute custom query: ${error}`);
    }
  }

  /**
   * Create a PatternMatch from a tree-sitter node
   */
  private createMatch(
    node: SyntaxNode,
    filePath: string,
    lines: string[]
  ): PatternMatch {
    return {
      filePath,
      line: node.startPosition.row + 1,
      column: node.startPosition.column,
      matchedText: node.text,
      lineText: lines[node.startPosition.row]?.trim() || '',
      nodeType: node.type,
    };
  }

  dispose(): void {
    this.parser = null;
    this.languages.clear();
  }
}
