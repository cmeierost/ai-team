import { Parser, Language, Node as SyntaxNode } from 'web-tree-sitter';
import { readFile } from 'fs/promises';

/**
 * Symbol information found in code
 */
export interface SymbolLocation {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'variable' | 'constant' | 'method' | 'property';
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn: number;
  endColumn: number;
  /** Context information (e.g., parent class for methods) */
  context?: string;
}

/**
 * Tree-sitter based symbol finder for locating definitions in code
 */
export class SymbolFinder {
  private parser: Parser | null = null;
  private languages: Map<string, Language> = new Map();

  /**
   * Initialize tree-sitter parser with language support
   */
  async initialize(): Promise<void> {
    await Parser.init();
    this.parser = new Parser();
  }

  /**
   * Load a language grammar (e.g., 'typescript', 'python', 'javascript')
   */
  async loadLanguage(languageName: string, wasmPath: string): Promise<void> {
    if (!this.parser) {
      throw new Error('Parser not initialized. Call initialize() first.');
    }

    const language = await Language.load(wasmPath);
    this.languages.set(languageName, language);
  }

  /**
   * Find all symbols in a file
   */
  async findSymbolsInFile(filePath: string, languageName: string): Promise<SymbolLocation[]> {
    if (!this.parser) {
      throw new Error('Parser not initialized. Call initialize() first.');
    }

    const language = this.languages.get(languageName);
    if (!language) {
      throw new Error(`Language '${languageName}' not loaded. Call loadLanguage() first.`);
    }

    this.parser.setLanguage(language);

    const sourceCode = await readFile(filePath, 'utf-8');
    const tree = this.parser.parse(sourceCode);
    if (!tree) {
      throw new Error('Tree-sitter failed to parse source code. Ensure a language is loaded.');
    }

    const symbols: SymbolLocation[] = [];
    const lines = sourceCode.split('\n');

    this.traverseTree(tree.rootNode, filePath, lines, symbols);

    return symbols;
  }

  /**
   * Find a specific symbol by name
   */
  async findSymbol(
    filePath: string,
    symbolName: string,
    languageName: string
  ): Promise<SymbolLocation | null> {
    const symbols = await this.findSymbolsInFile(filePath, languageName);
    return symbols.find((s) => s.name === symbolName) || null;
  }

  /**
   * Find symbols matching a pattern across multiple files
   */
  async findSymbolsByPattern(
    filePaths: string[],
    pattern: RegExp,
    languageName: string
  ): Promise<SymbolLocation[]> {
    const allSymbols: SymbolLocation[] = [];

    for (const filePath of filePaths) {
      try {
        const symbols = await this.findSymbolsInFile(filePath, languageName);
        const matching = symbols.filter((s) => pattern.test(s.name));
        allSymbols.push(...matching);
      } catch (error) {
        // Skip files that can't be parsed
        console.warn(`Failed to parse ${filePath}:`, error);
      }
    }

    return allSymbols;
  }

  /**
   * Traverse the syntax tree and extract symbol information
   */
  private traverseTree(
    node: SyntaxNode,
    filePath: string,
    lines: string[],
    symbols: SymbolLocation[],
    context?: string
  ): void {
    // TypeScript/JavaScript symbol extraction
    if (node.type === 'function_declaration' || node.type === 'generator_function_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push(this.createSymbolLocation(nameNode, 'function', filePath, lines, context));
      }
    } else if (node.type === 'class_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        const className = nameNode.text;
        symbols.push(this.createSymbolLocation(nameNode, 'class', filePath, lines, context));
        // Recursively process class members with class name as context
        for (let i = 0; i < node.childCount; i++) {
          this.traverseTree(node.child(i)!, filePath, lines, symbols, className);
        }
        return; // Don't process children again
      }
    } else if (node.type === 'interface_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push(this.createSymbolLocation(nameNode, 'interface', filePath, lines, context));
      }
    } else if (node.type === 'type_alias_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push(this.createSymbolLocation(nameNode, 'type', filePath, lines, context));
      }
    } else if (node.type === 'method_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push(this.createSymbolLocation(nameNode, 'method', filePath, lines, context));
      }
    } else if (node.type === 'lexical_declaration') {
      // const/let declarations
      const declarators = node.childrenForFieldName('declarator');
      for (const declarator of declarators) {
        const nameNode = declarator.childForFieldName('name');
        if (nameNode) {
          // Determine if it's a constant or variable
          const kind = node.text.trim().startsWith('const') ? 'constant' : 'variable';
          symbols.push(this.createSymbolLocation(nameNode, kind, filePath, lines, context));
        }
      }
    } else if (node.type === 'variable_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        symbols.push(this.createSymbolLocation(nameNode, 'variable', filePath, lines, context));
      }
    }

    // Recursively process children
    for (let i = 0; i < node.childCount; i++) {
      this.traverseTree(node.child(i)!, filePath, lines, symbols, context);
    }
  }

  /**
   * Create a SymbolLocation from a tree-sitter node
   */
  private createSymbolLocation(
    node: SyntaxNode,
    kind: SymbolLocation['kind'],
    filePath: string,
    lines: string[],
    context?: string
  ): SymbolLocation {
    return {
      name: node.text,
      kind,
      filePath,
      startLine: node.startPosition.row + 1, // Convert to 1-based
      endLine: node.endPosition.row + 1,
      startColumn: node.startPosition.column,
      endColumn: node.endPosition.column,
      context,
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.parser = null;
    this.languages.clear();
  }
}
