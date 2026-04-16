/**
 * Symbol information found in code
 */
export interface SymbolLocation {
  name: string;
  kind:
    | 'function'
    | 'class'
    | 'interface'
    | 'type'
    | 'variable'
    | 'constant'
    | 'method'
    | 'property';
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
export interface ISymbolFinder {
  loadLanguage(languageName: string, wasmPath: string): Promise<void>;
  findSymbolsInFile(filePath: string, languageName: string): Promise<SymbolLocation[]>;
  findSymbol(
    filePath: string,
    symbolName: string,
    languageName: string
  ): Promise<SymbolLocation | null>;
  findSymbolsByPattern(
    filePaths: string[],
    pattern: RegExp,
    languageName: string
  ): Promise<SymbolLocation[]>;
  dispose(): void;
}
