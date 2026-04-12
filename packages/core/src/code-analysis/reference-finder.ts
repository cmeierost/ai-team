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
export interface IReferenceFinder {
  loadLanguage(languageName: string, wasmPath: string): Promise<void>;
  findReferencesInFile(
    filePath: string,
    symbolName: string,
    languageName: string
  ): Promise<SymbolReference[]>;
  findReferencesAcrossFiles(
    filePaths: string[],
    symbolName: string,
    languageName: string
  ): Promise<SymbolReference[]>;
}
