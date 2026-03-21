import { Parser, Language, Tree } from 'web-tree-sitter';

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
export class TreeSitterManager {
  private static instance: TreeSitterManager | null = null;
  private parser: Parser | null = null;
  private readonly languages: Map<string, Language> = new Map();
  private readonly languageConfigs: Map<string, LanguageConfig> = new Map();
  private initialized = false;

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): TreeSitterManager {
    TreeSitterManager.instance ??= new TreeSitterManager();
    return TreeSitterManager.instance;
  }

  /**
   * Initialize the tree-sitter WASM module
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await Parser.init();
    this.parser = new Parser();
    this.initialized = true;
  }

  /**
   * Register a language configuration
   */
  registerLanguage(config: LanguageConfig): void {
    this.languageConfigs.set(config.name, config);
  }

  /**
   * Load a language grammar
   */
  async loadLanguage(languageName: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('TreeSitterManager not initialized. Call initialize() first.');
    }

    if (this.languages.has(languageName)) {
      return; // Already loaded
    }

    const config = this.languageConfigs.get(languageName);
    if (!config) {
      throw new Error(`Language '${languageName}' not registered. Call registerLanguage() first.`);
    }

    const language = await Language.load(config.wasmPath);
    this.languages.set(languageName, language);
  }

  /**
   * Get a parser configured for a specific language
   */
  async getParser(languageName: string): Promise<Parser> {
    if (!this.initialized || !this.parser) {
      throw new Error('TreeSitterManager not initialized. Call initialize() first.');
    }

    // Load language if not already loaded
    if (!this.languages.has(languageName)) {
      await this.loadLanguage(languageName);
    }

    const language = this.languages.get(languageName);
    if (!language) {
      throw new Error(`Language '${languageName}' not available.`);
    }

    this.parser.setLanguage(language);
    return this.parser;
  }

  /**
   * Parse source code and return the syntax tree
   */
  async parse(sourceCode: string, languageName: string): Promise<Tree> {
    const parser = await this.getParser(languageName);
    const tree = parser.parse(sourceCode);
    if (!tree) {
      throw new Error('Tree-sitter failed to parse source code. Ensure a language is loaded.');
    }

    return tree;
  }

  /**
   * Get language name from file extension
   */
  getLanguageForFile(filePath: string): string | null {
    const ext = filePath.split('.').pop()?.toLowerCase();
    if (!ext) {
      return null;
    }

    for (const [name, config] of this.languageConfigs) {
      if (config.extensions.includes(ext)) {
        return name;
      }
    }

    return null;
  }

  /**
   * Check if a language is loaded
   */
  isLanguageLoaded(languageName: string): boolean {
    return this.languages.has(languageName);
  }

  /**
   * Get all registered language names
   */
  getRegisteredLanguages(): string[] {
    return Array.from(this.languageConfigs.keys());
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.parser = null;
    this.languages.clear();
    this.languageConfigs.clear();
    this.initialized = false;
  }
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
