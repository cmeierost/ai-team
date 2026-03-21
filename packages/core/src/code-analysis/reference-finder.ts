import { Parser, Language, Node as SyntaxNode } from 'web-tree-sitter';
import { readFile } from 'node:fs/promises';

/**
 * Reference information for a symbol usage
 */
export interface SymbolReference {
  filePath: string;
  line: number;
  column: number;
  /** The line of code containing the reference */
  lineText: string;
  /** Type of reference */
  referenceType: 'usage' | 'import' | 'call' | 'property_access' | 'type_reference';
}

/**
 * Tree-sitter based reference finder for locating symbol usages
 */
export class ReferenceFinder {
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
   * Find all references to a symbol in a file
   */
  async findReferencesInFile(
    filePath: string,
    symbolName: string,
    languageName: string
  ): Promise<SymbolReference[]> {
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

    const references: SymbolReference[] = [];
    this.traverseForReferences(tree.rootNode, symbolName, filePath, lines, references);

    return references;
  }

  /**
   * Find all references across multiple files
   */
  async findReferencesAcrossFiles(
    filePaths: string[],
    symbolName: string,
    languageName: string
  ): Promise<SymbolReference[]> {
    const allReferences: SymbolReference[] = [];

    for (const filePath of filePaths) {
      try {
        const references = await this.findReferencesInFile(filePath, symbolName, languageName);
        allReferences.push(...references);
      } catch (error) {
        console.warn(`Failed to parse ${filePath}:`, error);
      }
    }

    return allReferences;
  }

  /**
   * Traverse tree and find identifier nodes matching the symbol name
   */
  private traverseForReferences(
    node: SyntaxNode,
    symbolName: string,
    filePath: string,
    lines: string[],
    references: SymbolReference[]
  ): void {
    // Check if this is an identifier node matching our symbol
    if (node.type === 'identifier' && node.text === symbolName) {
      const referenceType = this.determineReferenceType(node);
      references.push({
        filePath,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        lineText: lines[node.startPosition.row]?.trim() || '',
        referenceType,
      });
    }

    // Also check for property identifiers (e.g., obj.symbolName)
    if (node.type === 'property_identifier' && node.text === symbolName) {
      references.push({
        filePath,
        line: node.startPosition.row + 1,
        column: node.startPosition.column,
        lineText: lines[node.startPosition.row]?.trim() || '',
        referenceType: 'property_access',
      });
    }

    // Recursively traverse children
    for (let i = 0; i < node.childCount; i++) {
      this.traverseForReferences(node.child(i)!, symbolName, filePath, lines, references);
    }
  }

  /**
   * Determine the type of reference based on the node's context
   */
  private determineReferenceType(node: SyntaxNode): SymbolReference['referenceType'] {
    let parent = node.parent;

    while (parent) {
      // Import statement
      if (parent.type === 'import_statement' || parent.type === 'import_specifier') {
        return 'import';
      }

      // Function call
      if (parent.type === 'call_expression') {
        const calleeNode = parent.childForFieldName('function');
        if (calleeNode && calleeNode.id === node.id) {
          return 'call';
        }
      }

      // Member expression (property access)
      if (parent.type === 'member_expression') {
        const propertyNode = parent.childForFieldName('property');
        if (propertyNode && propertyNode.id === node.id) {
          return 'property_access';
        }
      }

      // Type reference/annotation
      if (
        parent.type === 'type_annotation' ||
        parent.type === 'type_reference' ||
        parent.type === 'generic_type'
      ) {
        return 'type_reference';
      }

      parent = parent.parent;
    }

    return 'usage';
  }

  dispose(): void {
    this.parser = null;
    this.languages.clear();
  }
}
