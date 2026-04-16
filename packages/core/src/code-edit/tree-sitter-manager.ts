import { Parser, Tree } from 'web-tree-sitter';

/**
 * Language configuration for tree-sitter
 */
export interface LanguageConfig {
  name: string;
  /** Path to WASM grammar file */
  wasmPath: string;
  /** File extensions this language handles */
  extensions: string[];
}

/**
 * Manages tree-sitter parser initialization and language loading
 * Singleton to avoid multiple WASM initializations
 */
export interface ITreeSitterManager {
  /**
   * Register a language configuration
   */
  registerLanguage(config: LanguageConfig): void;

  /**
   * Load a language grammar
   */
  loadLanguage(languageName: string): Promise<void>;

  /**
   * Get a parser configured for a specific language
   */
  getParserForLanguage(languageName: string): Promise<Parser>;

  /**
   * Parse source code and return the syntax tree
   */
  parse(sourceCode: string, languageName: string): Promise<Tree>;

  /**
   * Get language name from file extension
   */
  getLanguageForFile(filePath: string): string | null;

  /**
   * Check if a language is loaded
   */
  isLanguageLoaded(languageName: string): boolean;
  /**
   * Get all registered language names
   */
  getRegisteredLanguages(): string[];

  /**
   * Clean up resources
   */
  dispose(): void;
}

/**
 * Default language configurations for common languages
 */
export const DEFAULT_LANGUAGE_CONFIGS: LanguageConfig[] = [
  {
    name: 'typescript',
    wasmPath: 'tree-sitter-typescript.wasm',
    extensions: ['ts', 'tsx'],
  },
  {
    name: 'javascript',
    wasmPath: 'tree-sitter-javascript.wasm',
    extensions: ['js', 'jsx', 'mjs', 'cjs'],
  },
  {
    name: 'python',
    wasmPath: 'tree-sitter-python.wasm',
    extensions: ['py'],
  },
  {
    name: 'rust',
    wasmPath: 'tree-sitter-rust.wasm',
    extensions: ['rs'],
  },
  {
    name: 'go',
    wasmPath: 'tree-sitter-go.wasm',
    extensions: ['go'],
  },
  {
    name: 'java',
    wasmPath: 'tree-sitter-java.wasm',
    extensions: ['java'],
  },
  {
    name: 'c',
    wasmPath: 'tree-sitter-c.wasm',
    extensions: ['c', 'h'],
  },
  {
    name: 'cpp',
    wasmPath: 'tree-sitter-cpp.wasm',
    extensions: ['cpp', 'hpp', 'cc', 'cxx'],
  },
];
